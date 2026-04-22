'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  computeTieredPollDelayMsFromElapsed,
  DEFAULT_MAX_POLL_ATTEMPTS,
  DEFAULT_POLL_FAST_MS,
  DEFAULT_POLL_SLOW_MS,
  DEFAULT_POLL_TIER_AFTER_MS,
} from '@/lib/modelTask/tieredPollDefaults';
import { FrameGlbPreview } from './FrameGlbPreview';
import { ModelTaskProgress, type ModelTaskUiPhase } from './ModelTaskProgress';
import { RapidModelBanner } from './RapidModelBanner';

type ApiTask = {
  id: string;
  taskId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAIL';
  imageUrl: string;
  imageContentMd5?: string | null;
  modelUrl: string | null;
  createdAt: string;
};

type LookupResponse = {
  ok?: boolean;
  hit?: 'SUCCESS' | 'PENDING' | 'NONE';
  data?: ApiTask | null;
  error?: string;
};

type CreateResponse = {
  ok?: boolean;
  data?: ApiTask;
  meta?: { source?: string; modelReady?: boolean; joinPending?: boolean };
  error?: string;
};

type CacheHint = 'none' | 'ready' | 'joined';

function derivePhase(
  serverStatus: ApiTask['status'] | null,
  isCreating: boolean,
  pollRound: number,
): ModelTaskUiPhase | null {
  if (isCreating) return 'PENDING';
  if (serverStatus === 'SUCCESS') return 'SUCCESS';
  if (serverStatus === 'FAIL') return 'FAIL';
  if (serverStatus === 'PENDING') {
    return pollRound <= 0 ? 'PENDING' : 'PROCESSING';
  }
  return null;
}

export default function AdminFramesUploadPage() {
  const { hasPermission } = useAuth();
  const [imageUrl, setImageUrl] = useState('');
  const [imageContentMd5, setImageContentMd5] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ModelTaskUiPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rapidBannerVisible, setRapidBannerVisible] = useState(false);
  const [cacheHint, setCacheHint] = useState<CacheHint>('none');
  const pipelineLocked = useRef(false);

  const reset = useCallback(() => {
    setPhase(null);
    setError(null);
    setModelUrl(null);
    setRapidBannerVisible(false);
    setCacheHint('none');
    setImageContentMd5('');
  }, []);

  const runPipeline = useCallback(async () => {
    if (pipelineLocked.current) return;
    pipelineLocked.current = true;
    setError(null);
    setModelUrl(null);
    setRapidBannerVisible(false);
    setCacheHint('none');
    setBusy(true);

    let url = imageUrl.trim();
    let md5ForRequest = imageContentMd5.trim().toLowerCase() || undefined;

    const pollByLocalId = async (localId: string) => {
      let serverStatus: ApiTask['status'] = 'PENDING';
      setPhase(derivePhase(serverStatus, false, 0));
      const pollStart = Date.now();
      for (let i = 0; i < DEFAULT_MAX_POLL_ATTEMPTS; i += 1) {
        const poll = await fetch(`/api/model-tasks/${localId}?poll=1`);
        const pollJson = (await poll.json()) as { ok?: boolean; data?: ApiTask; error?: string };
        if (!poll.ok || !pollJson.ok || !pollJson.data) {
          throw new Error(pollJson.error || '查询任务失败');
        }
        serverStatus = pollJson.data.status;
        setPhase(derivePhase(serverStatus, false, i + 1));

        if (serverStatus === 'SUCCESS') {
          setModelUrl(pollJson.data.modelUrl ?? null);
          setRapidBannerVisible(false);
          setPhase('SUCCESS');
          return;
        }
        if (serverStatus === 'FAIL') {
          setRapidBannerVisible(false);
          setPhase('FAIL');
          return;
        }

        const elapsed = Date.now() - pollStart;
        const delay = computeTieredPollDelayMsFromElapsed(
          elapsed,
          DEFAULT_POLL_FAST_MS,
          DEFAULT_POLL_SLOW_MS,
          DEFAULT_POLL_TIER_AFTER_MS,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
      setRapidBannerVisible(false);
      setPhase('FAIL');
      setError('轮询超时，请稍后在数据库中查看任务状态');
    };

    try {
      if (file) {
        setPhase('PROCESSING');
        const fd = new FormData();
        fd.set('file', file);
        const up = await fetch('/api/admin/frames/image', { method: 'POST', body: fd });
        const upJson = (await up.json()) as {
          ok?: boolean;
          data?: { imageUrl?: string; contentMd5?: string };
          error?: string;
        };
        if (!up.ok || !upJson.ok || !upJson.data?.imageUrl) {
          throw new Error(upJson.error || '图片上传失败');
        }
        url = upJson.data.imageUrl;
        setImageUrl(url);
        if (upJson.data.contentMd5) {
          md5ForRequest = upJson.data.contentMd5;
          setImageContentMd5(upJson.data.contentMd5);
        }

        const lu = await fetch('/api/model-tasks/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: url,
            imageContentMd5: md5ForRequest,
          }),
        });
        const luJson = (await lu.json()) as LookupResponse;
        if (!lu.ok || !luJson.ok) {
          throw new Error(luJson.error || '预查询失败');
        }
        if (luJson.hit === 'SUCCESS' && luJson.data?.modelUrl) {
          setCacheHint('ready');
          setModelUrl(luJson.data.modelUrl);
          setPhase('SUCCESS');
          setRapidBannerVisible(false);
          return;
        }
        if (luJson.hit === 'PENDING' && luJson.data?.id) {
          setCacheHint('joined');
          setRapidBannerVisible(false);
          await pollByLocalId(luJson.data.id);
          return;
        }

        setRapidBannerVisible(true);
      } else if (url) {
        const lu = await fetch('/api/model-tasks/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: url,
            ...(md5ForRequest ? { imageContentMd5: md5ForRequest } : {}),
          }),
        });
        const luJson = (await lu.json()) as LookupResponse;
        if (!lu.ok || !luJson.ok) {
          throw new Error(luJson.error || '预查询失败');
        }
        if (luJson.hit === 'SUCCESS' && luJson.data?.modelUrl) {
          setCacheHint('ready');
          setModelUrl(luJson.data.modelUrl);
          setPhase('SUCCESS');
          return;
        }
        if (luJson.hit === 'PENDING' && luJson.data?.id) {
          setCacheHint('joined');
          await pollByLocalId(luJson.data.id);
          return;
        }
        setRapidBannerVisible(true);
      }

      if (!url) {
        throw new Error('请填写图片 URL 或选择本地图片');
      }

      setPhase('PENDING');
      const create = await fetch('/api/model-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: url,
          ...(md5ForRequest ? { imageContentMd5: md5ForRequest } : {}),
        }),
      });
      const createJson = (await create.json()) as CreateResponse;
      if (create.status === 429) {
        throw new Error(createJson.error || '当前建模任务较多，请稍后再试');
      }
      if (!create.ok || !createJson.ok || !createJson.data?.id) {
        throw new Error(createJson.error || '创建 3D 任务失败');
      }

      if (createJson.meta?.modelReady && createJson.data.modelUrl) {
        setCacheHint('ready');
        setModelUrl(createJson.data.modelUrl);
        setPhase('SUCCESS');
        setRapidBannerVisible(false);
        return;
      }
      if (createJson.meta?.joinPending) {
        setCacheHint('joined');
      }

      const { id: localId } = createJson.data;
      let serverStatus: ApiTask['status'] = createJson.data.status;

      setPhase(derivePhase(serverStatus, false, 0));

      const pollStart = Date.now();
      for (let i = 0; i < DEFAULT_MAX_POLL_ATTEMPTS; i += 1) {
        const poll = await fetch(`/api/model-tasks/${localId}?poll=1`);
        const pollJson = (await poll.json()) as { ok?: boolean; data?: ApiTask; error?: string };
        if (!poll.ok || !pollJson.ok || !pollJson.data) {
          throw new Error(pollJson.error || '查询任务失败');
        }
        serverStatus = pollJson.data.status;
        setPhase(derivePhase(serverStatus, false, i + 1));

        if (serverStatus === 'SUCCESS') {
          const glb = pollJson.data.modelUrl ?? null;
          setModelUrl(glb);
          setRapidBannerVisible(false);
          setPhase('SUCCESS');
          return;
        }
        if (serverStatus === 'FAIL') {
          setRapidBannerVisible(false);
          setPhase('FAIL');
          return;
        }

        const elapsed = Date.now() - pollStart;
        const delay = computeTieredPollDelayMsFromElapsed(
          elapsed,
          DEFAULT_POLL_FAST_MS,
          DEFAULT_POLL_SLOW_MS,
          DEFAULT_POLL_TIER_AFTER_MS,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      setRapidBannerVisible(false);
      setPhase('FAIL');
      setError('轮询超时，请稍后在数据库中查看任务状态');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRapidBannerVisible(false);
      setPhase('FAIL');
    } finally {
      setBusy(false);
      pipelineLocked.current = false;
    }
  }, [file, imageUrl, imageContentMd5]);

  if (!hasPermission('admin.view')) {
    return <div className="p-6 text-gray-600">当前账号无权访问该页面。</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">镜架图 → 3D 模型</h1>
        <p className="mt-1 text-sm text-gray-500">
          上传后的 JPEG 会计算 MD5 并写入任务；创建前会按 MD5 / URL 预查库内记录。命中成功则直接返回 GLB，不重复调用混元。
        </p>
      </div>

      {cacheHint === 'ready' && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <span className="font-semibold">模型已就绪</span>
          ：已根据图片内容哈希命中历史生成结果，未再次调用腾讯云接口。
        </div>
      )}
      {cacheHint === 'joined' && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <span className="font-semibold">已接入进行中的任务</span>
          ：库内已有同源 PENDING 记录，将同步该任务的生成进度，未发起新的 CreateHunyuan3DTask。
        </div>
      )}

      <RapidModelBanner visible={rapidBannerVisible} />

      <ModelTaskProgress phase={phase} />

      {phase === 'SUCCESS' && modelUrl ? <FrameGlbPreview url={modelUrl} /> : null}

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">图片 URL</label>
          <input
            value={imageUrl}
            onChange={(e) => {
              setImageUrl(e.target.value);
              reset();
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="https://..."
            disabled={busy}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">或上传本地图片</label>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              reset();
            }}
            className="block w-full text-sm text-gray-600"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPipeline()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '处理中…' : '开始生成'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFile(null);
              setImageUrl('');
              reset();
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            清空
          </button>
        </div>
      </div>

      {modelUrl && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-medium">GLB 下载地址</div>
          <a href={modelUrl} className="mt-1 block break-all underline" target="_blank" rel="noreferrer">
            {modelUrl}
          </a>
        </div>
      )}
    </div>
  );
}
