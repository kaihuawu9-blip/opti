'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Monitor, X } from 'lucide-react';

function toStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  return String(v);
}

function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => toStr(x)).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function normalizeConcept(
  raw: unknown,
): { scene?: string; elements?: string[]; style?: string; colorTone?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const scene = toStr(o.scene) || undefined;
  const elements = toStrArray(o.elements);
  const style = toStr(o.style) || undefined;
  const colorTone = toStr(o.colorTone) || undefined;
  if (!scene && elements.length === 0 && !style && !colorTone) return undefined;
  return { scene, elements, style, colorTone };
}

function proxiedImageSrc(url: string): string {
  if (!url.trim()) return '';
  return `/api/proxy-image?url=${encodeURIComponent(url.trim())}`;
}

function posterDisplaySrc(
  dataUrl: string | undefined,
  webUrl: string | undefined,
  useProductFallback: boolean,
  fallbackUrl: string | undefined,
): string {
  if (dataUrl?.startsWith('data:')) return dataUrl;
  if (useProductFallback && fallbackUrl?.trim()) return proxiedImageSrc(fallbackUrl);
  if (webUrl?.trim()) return proxiedImageSrc(webUrl);
  if (fallbackUrl?.trim()) return proxiedImageSrc(fallbackUrl);
  return '';
}

async function posterNodeToPng(elementId: string): Promise<string | undefined> {
  const el = document.getElementById(elementId);
  if (!el) return undefined;
  const { toPng } = await import('html-to-image');
  return toPng(el, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
  });
}

async function saveToAlbum(elementId: string) {
  const dataUrl = await posterNodeToPng(elementId);
  if (!dataUrl) {
    window.alert('海报节点不存在，请刷新后重试');
    return;
  }
  const link = document.createElement('a');
  link.download = `镜售推荐_${new Date().toISOString().slice(0, 10)}.png`;
  link.href = dataUrl;
  link.click();
  return dataUrl;
}

type MarketingResult = {
  title: string;
  copywriting: string;
  posterText: string;
  hotspot: string;
  hashtags: string[];
  posterImageUrl?: string;
  posterImageDataUrl?: string;
  posterImageFallbackUrl?: string;
  imageConcept?: { scene?: string; elements?: string[]; style?: string; colorTone?: string };
};

type MarketingPayload = {
  ok?: boolean;
  error?: string;
  posterImageUrl?: string;
  posterImageDataUrl?: string;
  posterImageFallbackUrl?: string;
  data?: Record<string, unknown>;
};

export default function OnlineOpsPage() {
  const [userContent, setUserContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingResult | null>(null);
  const [genTick, setGenTick] = useState(0);
  const [useProductFallback, setUseProductFallback] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /** 右下角：客户临时修改/追加要求，会并入接口 note 并触发重新生成 */
  const [clientRefine, setClientRefine] = useState('');

  const posterTitle = result?.title || '春季热卖防蓝光镜框';
  const posterText =
    result?.posterText || result?.copywriting || '轻量舒适，通勤久戴不压鼻，搭配潮流黑框设计，随手一拍就出片。';
  /** 热点与推荐已融入 posterText，页脚仅保留品牌短句 */
  const posterFootLine = '镜售AI · 智能选镜 · 门店同款';
  const tags = useMemo(() => (result?.hashtags || []).slice(0, 5), [result]);

  const imgSrc = result
    ? posterDisplaySrc(
        result.posterImageDataUrl,
        result.posterImageUrl,
        useProductFallback,
        result.posterImageFallbackUrl,
      )
    : '';

  useEffect(() => {
    setUseProductFallback(false);
  }, [genTick]);

  useEffect(() => {
    return () => {
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    };
  }, [videoObjectUrl]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen]);

  const busy = loading || videoLoading || fileLoading;

  function getCustomerNeedText(): string {
    const base = userContent.trim();
    const refine = clientRefine.trim();
    const parts: string[] = [];
    if (base) parts.push(`【店主主题】${base}`);
    if (refine && result) {
      parts.push(`【当前海报-标题】${result.title}`);
      parts.push(
        `【当前海报-文案】${result.posterText.slice(0, 200).replace(/\s+/g, ' ')}`,
      );
    }
    if (refine) {
      parts.push(
        `【客户修改/追加要求】${refine}（请按此整体调整插画与标题/短文案，可覆盖上一版。）`,
      );
    }
    return parts.join('\n');
  }

  function buildMarketingRequestBody(): Record<string, unknown> {
    const note = getCustomerNeedText();
    if (!note) {
      throw new Error('请先填写顾客需求（顶部主题或右下角客户修改）');
    }
    return {
      autoSelectPlatform: true,
      note,
    };
  }

  async function fetchMarketingJson() {
    const resp = await fetch('/api/ai/marketing-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMarketingRequestBody()),
    });
    const json = (await resp.json()) as MarketingPayload;
    if (!resp.ok || !json.ok || !json.data || typeof json.data !== 'object') {
      throw new Error(json.error || `生成失败（HTTP ${resp.status}）`);
    }
    return json;
  }

  function applyMarketingToState(json: {
    posterImageUrl?: string;
    posterImageDataUrl?: string;
    posterImageFallbackUrl?: string;
    data: Record<string, unknown>;
  }) {
    const d = json.data;
    setResult({
      title: toStr(d.title, '春季热卖防蓝光镜框'),
      copywriting: toStr(d.copywriting),
      posterText: toStr(d.posterText),
      hotspot: toStr(d.hotspot),
      hashtags: toStrArray(d.hashtags),
      posterImageUrl: toStr(json.posterImageUrl) || undefined,
      posterImageDataUrl:
        typeof json.posterImageDataUrl === 'string' ? json.posterImageDataUrl : undefined,
      posterImageFallbackUrl: toStr(json.posterImageFallbackUrl) || undefined,
      imageConcept: normalizeConcept(d.imageConcept),
    });
    setGenTick((n) => n + 1);
  }

  async function runAiCompose() {
    setLightboxOpen(false);
    setLoading(true);
    try {
      const json = await fetchMarketingJson();
      applyMarketingToState(json);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'AI 生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function runClientRefineApply() {
    if (!clientRefine.trim()) {
      window.alert('请填写客户希望修改或追加的内容');
      return;
    }
    await runAiCompose();
  }

  async function runVideoGenerate() {
    setVideoLoading(true);
    try {
      const json = await fetchMarketingJson();
      applyMarketingToState(json);

      const d = json.data;
      const title = toStr(d.title, '镜售推荐');
      const text = toStr(d.posterText, toStr(d.copywriting, ''));
      const copywrite = [title, text].filter(Boolean).join(' ').slice(0, 72);

      const payload: Record<string, string> = { copywrite };
      if (json.posterImageDataUrl?.startsWith('data:')) {
        payload.imageDataUrl = json.posterImageDataUrl;
      } else {
        const fallbackUrl = json.posterImageUrl?.trim() || json.posterImageFallbackUrl?.trim() || '';
        if (!fallbackUrl) throw new Error('没有可用的配图，无法合成视频');
        const proxied = proxiedImageSrc(fallbackUrl);
        const picResp = await fetch(proxied);
        if (!picResp.ok) throw new Error(`视频配图下载失败（HTTP ${picResp.status}）`);
        const blob = await picResp.blob();
        const b64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(new Error('视频配图转码失败'));
          fr.readAsDataURL(blob);
        });
        if (!b64.startsWith('data:image')) throw new Error('视频配图格式不支持');
        payload.imageDataUrl = b64;
      }

      const vResp = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!vResp.ok) {
        const errBody = (await vResp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `视频生成失败（HTTP ${vResp.status}）`);
      }
      const blob = await vResp.blob();
      setVideoObjectUrl(URL.createObjectURL(blob));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '视频生成失败');
    } finally {
      setVideoLoading(false);
    }
  }

  async function runFileGenerate() {
    setFileLoading(true);
    try {
      const json = await fetchMarketingJson();
      applyMarketingToState(json);
      const d = json.data;
      const concept = normalizeConcept(d.imageConcept);
      const text = [
        `标题：${toStr(d.title)}`,
        `短文案：${toStr(d.posterText, toStr(d.copywriting))}`,
        `热点：${toStr(d.hotspot)}`,
        `标签：${toStrArray(d.hashtags).join('、')}`,
        '',
        '构图建议',
        toStr(concept?.scene, '未返回'),
        '',
        `元素：${(concept?.elements || []).join('；') || '未返回'}`,
        `风格：${toStr(concept?.style, '未返回')}`,
        `色调：${toStr(concept?.colorTone, '未返回')}`,
      ].join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `营销内容_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '文件生成失败');
    } finally {
      setFileLoading(false);
    }
  }

  async function handleDownloadPoster() {
    try {
      await saveToAlbum('marketing-poster');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '图片导出失败');
    }
  }

  return (
    <>
    <div className="space-y-6 pb-40 sm:pb-8">
      <div className="flex items-center gap-2">
        <Monitor className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">线上运营</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
          <input
            type="text"
            value={userContent}
            onChange={(e) => setUserContent(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="主题关键词（可选）"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAiCompose()}
              disabled={busy}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? '生成中…' : '一键生成图片'}
            </button>
            <button
              type="button"
              onClick={() => void runVideoGenerate()}
              disabled={busy}
              className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {videoLoading ? '视频生成中…' : '一键生成视频'}
            </button>
            <button
              type="button"
              onClick={() => void runFileGenerate()}
              disabled={busy}
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {fileLoading ? '文件生成中…' : '一键生成文件'}
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-lg rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50 to-slate-100/90 p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800">图片预览</span>
            {loading ? <span className="text-xs text-indigo-600">配图与文案生成中…</span> : null}
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {result ? '点击海报任意处可放大查看配图' : null}
          </p>
          {!result && !loading ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white/80 px-4 text-center text-sm text-gray-500">
              点击「一键生成图片」后在此查看
            </div>
          ) : null}
          {result ? (
            <div className="flex justify-center">
              <div
                id="marketing-poster"
                role="button"
                tabIndex={0}
                className="relative flex h-[min(72vw,440px)] w-full max-w-sm cursor-zoom-in flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-lg ring-1 ring-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={() => imgSrc && setLightboxOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (imgSrc) setLightboxOpen(true);
                  }
                }}
              >
                <div className="relative min-h-0 flex-1">
                  {imgSrc ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={`${genTick}-${imgSrc.slice(0, 48)}`}
                        src={imgSrc}
                        alt=""
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                        onError={() => {
                          if (!useProductFallback && result?.posterImageFallbackUrl?.trim()) {
                            setUseProductFallback(true);
                          }
                        }}
                      />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-sky-700 to-indigo-900" />
                  )}
                </div>
                <div className="pointer-events-none relative z-10 flex max-h-[12%] min-h-[52px] shrink-0 flex-col justify-center gap-0.5 bg-gradient-to-t from-black/88 via-black/55 to-transparent px-2 py-1.5 text-center text-white">
                  <p className="text-[9px] tracking-[0.15em] text-white/75">镜售AI HOT</p>
                  <h2 className="line-clamp-1 text-sm font-bold leading-tight">{posterTitle}</h2>
                  <p className="line-clamp-2 text-[11px] leading-snug text-white/95">{posterText}</p>
                  <p className="line-clamp-1 text-[9px] text-white/65">{posterFootLine}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {lightboxOpen && imgSrc ? (
          <div
            role="presentation"
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/88 p-6 pt-14 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              aria-label="关闭预览"
              className="absolute right-4 top-4 z-10 inline-flex rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(false);
              }}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt="放大预览"
              className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="mt-3 text-center text-xs text-white/70">点击空白处或右上角关闭</p>
          </div>
        ) : null}

        {videoObjectUrl ? (
          <div className="mx-auto w-full max-w-lg">
            <div className="mb-2 text-sm font-medium text-gray-800">视频预览</div>
            <video
              src={videoObjectUrl}
              controls
              className="w-full max-w-md rounded-xl border border-gray-200 bg-black shadow-sm"
            />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleDownloadPoster()}
          disabled={!result}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          下载图片
        </button>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        {result?.imageConcept && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
            <div className="font-medium text-gray-800">构图建议</div>
            <div>{result.imageConcept.scene || '未返回'}</div>
            <div>元素：{(result.imageConcept.elements || []).join('；') || '未返回'}</div>
            <div>风格：{result.imageConcept.style || '未返回'}</div>
            <div>色调：{result.imageConcept.colorTone || '未返回'}</div>
          </div>
        )}
      </div>
    </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:bottom-4 sm:left-auto sm:right-4 sm:w-[min(100vw-2rem,22rem)] sm:rounded-xl sm:border sm:p-3">
        <div className="text-xs font-medium text-gray-800">客户修改 / 追加</div>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          已有一版时，会带上当前标题与文案供 AI 对照修改
        </p>
        <textarea
          value={clientRefine}
          onChange={(e) => setClientRefine(e.target.value)}
          rows={3}
          className="mt-2 w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-900 placeholder:text-gray-400"
          placeholder="例如：标题再短一点；背景改成晚宴厅；突出防蓝光…"
        />
        <button
          type="button"
          onClick={() => void runClientRefineApply()}
          disabled={busy || !clientRefine.trim()}
          className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '生成中…' : '按客户要求重新生成'}
        </button>
      </div>
    </>
  );
}
