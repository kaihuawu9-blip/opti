'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@/styles/page-flip.css';
import type { ZeissHandbookManifest, ZeissHandbookSection } from '@/lib/catalog/zeissHandbookTypes';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import { ZeissSideIndexTabs } from '@/components/catalog/ZeissSideIndexTabs';
import { playHandbookPaperRustle } from '@/lib/catalog/handbookPaperSound';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HTMLFlipBook = dynamic(() => import('react-pageflip'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[min(72vh,640px)] w-full items-center justify-center text-sm text-white/50">加载 3D 书引擎…</div>
  ),
}) as any;

type FlipBookRef = {
  pageFlip?: () =>
    | {
        flip: (page: number) => void;
        getCurrentPageIndex: () => number;
      }
    | undefined;
};

function activeSectionForPage(sections: ZeissHandbookSection[], pageIndex: number): string {
  const sorted = [...sections].sort((a, b) => a.startPage - b.startPage);
  let id = sorted[0]?.id ?? '';
  for (const s of sorted) {
    if (pageIndex >= s.startPage) id = s.id;
  }
  return id;
}

function preloadHandbookImages(urls: (string | null | undefined)[], max: number) {
  for (let i = 0; i < Math.min(max, urls.length); i++) {
    const u = urls[i];
    if (!u) continue;
    const im = new Image();
    im.decoding = 'async';
    im.src = u;
  }
}

export function ZeissDigitalHandbook() {
  const [manifest, setManifest] = useState<ZeissHandbookManifest | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 520, h: 694 });
  const [currentPage, setCurrentPage] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState('');
  const bookRef = useRef<FlipBookRef>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog/zeiss-manifest/', { cache: 'no-store' });
        const j = (await res.json()) as {
          ok?: boolean;
          manifest?: ZeissHandbookManifest;
          error?: string;
          warnings?: string[];
        };
        if (cancelled) return;
        if (!res.ok || !j.manifest) {
          setLoadErr(j.error || '无法读取手册配置');
          return;
        }
        if (Array.isArray(j.warnings) && j.warnings.length && process.env.NODE_ENV === 'development') {
          for (const w of j.warnings) console.warn('[zeiss-manifest]', w);
        }
        setManifest(j.manifest);
        setActiveSectionId(j.manifest.sections[0]?.id ?? '');
        preloadHandbookImages(
          j.manifest.pages.map((p) => p.imageUrl),
          4,
        );
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : '网络错误');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ar = manifest?.pageAspect ?? { w: 3, h: 4 };
    const ratioHOverW = ar.h / ar.w;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr?.width) return;
      const isNarrow = cr.width < 1280;
      const leftBleed = isNarrow ? 36 : 24;
      const rightRail = isNarrow ? 28 : 200;
      const pad = isNarrow ? 8 : 40;
      const vw =
        typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : cr.width;
      const isLargeTablet = cr.width >= 900 && cr.width <= 1400;
      const wFromVw = vw * 0.85 - pad * 2 - leftBleed - rightRail;
      const wFromShell = cr.width - pad - leftBleed - rightRail;
      let w = isLargeTablet
        ? Math.min(1240, Math.max(300, Math.max(wFromVw, wFromShell * 0.92)))
        : Math.min(720, Math.max(300, wFromShell));
      let h = w * ratioHOverW;
      const vhCap =
        typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
          ? window.innerHeight * 0.82
          : 980;
      const maxBookH = Math.min(1320, vhCap);
      if (h > maxBookH) {
        h = maxBookH;
        w = h / ratioHOverW;
      }
      setDims({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [manifest?.pageAspect?.w, manifest?.pageAspect?.h]);

  const sections = manifest?.sections ?? [];

  const onFlip = useCallback(
    (e: { data?: unknown }) => {
      const next = typeof e?.data === 'number' ? e.data : Number(e?.data);
      if (!Number.isFinite(next)) return;
      setCurrentPage(next);
      setActiveSectionId(activeSectionForPage(sections, next));
    },
    [sections],
  );

  const onChangeState = useCallback((e: { data?: unknown }) => {
    if (e?.data === 'flipping') playHandbookPaperRustle();
  }, []);

  useEffect(() => {
    if (sections.length) setActiveSectionId((id) => id || sections[0].id);
  }, [sections]);

  const handleTab = useCallback((section: ZeissHandbookSection) => {
    const pf = bookRef.current?.pageFlip?.();
    if (!pf) return;
    try {
      pf.flip(section.startPage);
    } catch {
      /* ignore */
    }
  }, []);

  const bookKey = useMemo(
    () =>
      `${dims.w}x${dims.h}x${manifest?.pages.length ?? 0}x${manifest?.pageAspect?.w ?? 3}x${manifest?.pageAspect?.h ?? 4}`,
    [dims.w, dims.h, manifest?.pages.length, manifest?.pageAspect?.w, manifest?.pageAspect?.h],
  );

  if (loadErr) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-rose-200">
        {loadErr}
      </div>
    );
  }

  if (!manifest?.pages.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-white/60">
        未检测到 <code className="text-white/80">public/catalog/zeiss-handbook/</code> 下的高清图文件（
        <code className="text-white/80">.jpg</code> / <code className="text-white/80">.jpeg</code> /{' '}
        <code className="text-white/80">.png</code> / <code className="text-white/80">.webp</code> /{' '}
        <code className="text-white/80">.avif</code>）。放入资产后刷新本页即可 1:1 映射为翻页；文件名含「成长乐」的页将自动绑定右侧「成长乐」标签起点。
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative isolate mx-auto w-full max-w-[min(1400px,calc(100vw-1rem))]">
      <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-gradient-to-br from-[#0059A3]/12 via-transparent to-slate-900/45 blur-3xl" />

      <div className="relative flex flex-col items-center gap-8 xl:flex-row xl:items-start xl:justify-center xl:gap-10">
        <div
          className="origin-top transition-transform max-xl:scale-[0.9] max-xl:pb-1 xl:scale-100"
          style={{ perspective: '2200px' }}
        >
          <div
            className="pointer-events-none absolute -bottom-10 left-1/2 z-0 h-28 w-[min(92%,920px)] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55)_0%,transparent_70%)] opacity-80 blur-2xl motion-safe:animate-[pulse_4.5s_ease-in-out_infinite]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-4 left-1/2 z-[1] h-14 w-[min(88%,860px)] -translate-x-1/2 scale-y-[-1] opacity-[0.22]"
            style={{
              background:
                'linear-gradient(to top, rgba(255,255,255,0.12) 0%, rgba(0,89,163,0.08) 35%, transparent 72%)',
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
            }}
            aria-hidden
          />
          <div className="relative z-[15] mx-auto max-xl:ml-1 max-xl:mr-0 xl:mx-2 [filter:drop-shadow(0_26px_48px_rgba(0,0,0,0.5))_drop-shadow(0_8px_24px_rgba(0,89,163,0.12))]">
            {/* 双页中缝：铜版纸书脊深度（线性渐变） */}
            <div
              className="pointer-events-none absolute inset-y-1 left-1/2 z-[120] w-[min(18px,2.8%)] -translate-x-1/2"
              style={{
                background:
                  'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.14) 38%, rgba(0,0,0,0.28) 50%, rgba(255,255,255,0.07) 50.5%, rgba(0,0,0,0.22) 62%, rgba(0,0,0,0) 100%)',
              }}
              aria-hidden
            />
            <HTMLFlipBook
              key={bookKey}
              ref={bookRef}
              className="mx-auto"
              style={{ width: dims.w, minHeight: dims.h }}
              width={dims.w}
              height={dims.h}
              minWidth={280}
              maxWidth={1280}
              minHeight={400}
              maxHeight={1400}
              size="stretch"
              startPage={0}
              drawShadow
              maxShadowOpacity={0.58}
              showCover={false}
              mobileScrollSupport
              clickEventForward
              useMouseEvents
              swipeDistance={20}
              flippingTime={520}
              usePortrait
              startZIndex={0}
              autoSize
              showPageCorners
              disableFlipByClick={false}
              onFlip={onFlip}
              onChangeState={onChangeState}
            >
              {manifest.pages.map((p, idx) => (
                <ZeissHandbookPage
                  key={p.imageUrl ?? `${idx}`}
                  pageNumber={idx + 1}
                  title={p.title}
                  subtitle={p.subtitle}
                  imageUrl={p.imageUrl}
                  priorityLoad={idx < 4}
                />
              ))}
            </HTMLFlipBook>
          </div>
        </div>

        <div className="pointer-events-none sticky top-6 z-[45] flex w-full max-w-[min(100%,14rem)] flex-col items-end self-start max-xl:static max-xl:z-[45] max-xl:max-w-full max-xl:flex-row max-xl:justify-end xl:w-[11rem]">
          <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/55 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl max-xl:w-full max-xl:max-w-md">
            <p className="mb-2 hidden px-1 text-[10px] font-semibold uppercase tracking-widest text-white/45 xl:block">
              索引
            </p>
            <ZeissSideIndexTabs sections={sections} activeSectionId={activeSectionId} onSelectSection={handleTab} />
          </div>
          <p className="mt-2 hidden text-[10px] text-white/35 xl:block">当前页 {currentPage + 1}</p>
        </div>
      </div>
    </div>
  );
}
