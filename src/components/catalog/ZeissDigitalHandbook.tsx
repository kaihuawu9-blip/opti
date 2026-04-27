'use client';

/**
 * ZeissDigitalHandbook — StandardEye 4.0 · 主权重构版
 *
 * 架构三定律
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 状态主权（State Sovereignty）
 *    currentPage 在全屏期间只受 ZeissFullscreenMirror 控制。
 *    isFsRef 屏蔽 page-flip onFlip / onChangeState 的反馈写入；
 *    全屏关闭后由 useEffect(isFs) 单次同步预览书页码。
 *
 * 2. 物理层隔离（Physical Decoupling）
 *    全屏组件 ZeissFullscreenMirror 完全独立：
 *    - 无 stf__ / flip 字样的 CSS 类名引用
 *    - 无 page-flip 引擎 API 调用
 *    - 双图直接撞边（左 0→50%，右 50%→100%，中缝焊死 50% 中轴）
 *
 * 3. 中央路由主权（Router Sovereignty）
 *    全屏仅经 {@link ZeissFsMirrorPortal} → ZeissFullscreenMirror；独立 CSS 与 DOM 变量，
 *    与 page-flip 样式链物理隔离。
 */

import dynamic from 'next/dynamic';
import {
  useCallback, useEffect, useLayoutEffect,
  useMemo, useRef, useState,
} from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import '@/styles/page-flip.css';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import { ZeissHandbookShortcutRail } from '@/components/catalog/ZeissHandbookShortcutRail';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { ZeissFsMirrorPortal } from '@/components/catalog/ZeissFsMirrorPortal';
import { getHandbookPageCount, getPageData } from '@/data/zeissHandbookPageMap';

/* ─── 物理常数 ────────────────────────────────────────────────────────────── */

const PAGE_RATIO = 1.4145;
const PAGE_W     = 450;
const PAGE_H     = Math.floor(PAGE_W * PAGE_RATIO); // 636
const RAIL_W     = 60;
const FLIP_MS    = 700;
const PHYS_H     = PAGE_H;
const SPREAD_W   = 2 * PAGE_W;

/* ─── 预览 Cover 缩放 ─────────────────────────────────────────────────────── */

function calcPreviewCoverScale(containerW: number, containerH: number): number {
  if (containerW < 4 || containerH < 4) return 0.45;
  return Math.max(0.15, Math.max(containerW / SPREAD_W, containerH / PHYS_H));
}

/* ─── ScaledBlock ─────────────────────────────────────────────────────────── */

function ScaledBlock({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div style={{ width: SPREAD_W * scale, height: PHYS_H * scale, flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: SPREAD_W, height: PHYS_H, transform: `scale(${scale})`, transformOrigin: 'top left', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}

/* ─── 静态样式 ────────────────────────────────────────────────────────────── */

const STAGE_STYLE: CSSProperties = {
  position: 'relative',
  width: SPREAD_W, minWidth: SPREAD_W, maxWidth: SPREAD_W,
  height: PHYS_H,  minHeight: PHYS_H,  maxHeight: PHYS_H,
  overflow: 'visible',
};

/* ─── 动态加载 react-pageflip（仅预览使用）─────────────────────────────────── */

function loadReactPageFlip(): Promise<ComponentType<ReactPageFlipProps>> {
  return import('react-pageflip').then((m) => m.default as ComponentType<ReactPageFlipProps>);
}

const HTMLFlipBook = dynamic(loadReactPageFlip, {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-white/60">
      加载 3D 书引擎…
    </div>
  ),
});

/* ─── 侧栏 Dock ───────────────────────────────────────────────────────────── */

function ZeissHandbookRailDockSpread({ currentPageIndex0, pageCount }: { currentPageIndex0: number; pageCount: number }) {
  return (
    <div
      className="zeiss-handbook-side-rail zeiss-series-nav-container pointer-events-auto"
      data-zeiss-preview-rail="1"
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: RAIL_W, zIndex: 50 }}
    >
      <ZeissHandbookShortcutRail currentPageIndex0={currentPageIndex0} pageCount={pageCount} />
    </div>
  );
}

/* ─── BookStage（仅预览书槽，与全屏物理层完全隔离）────────────────────────── */

interface BookStageProps {
  flipRef: React.RefObject<ReactPageFlipRef | null>;
  pages: ReactNode;
  startPage: number;
  onFlip: (e: { data?: unknown }) => void;
  onInit: () => void;
  onChangeState: (e: { data?: unknown }) => void;
  width?: number;
  height?: number;
  enginePageWidth?: number;
  enginePageHeight?: number;
  engineSize?: 'fixed' | 'stretch';
}

function BookStage({
  flipRef, pages, startPage,
  onFlip, onInit, onChangeState,
  width: widthProp, height: heightProp,
  enginePageWidth, enginePageHeight,
  engineSize = 'stretch',
}: BookStageProps) {
  const pw = widthProp ?? enginePageWidth ?? PAGE_W;
  const ph = heightProp ?? enginePageHeight ?? PAGE_H;
  const bookTrackW = 2 * pw;
  const stageStyle: CSSProperties =
    widthProp != null || heightProp != null || enginePageWidth != null || enginePageHeight != null
      ? { position: 'relative', width: bookTrackW, minWidth: bookTrackW, maxWidth: bookTrackW, height: ph, minHeight: ph, maxHeight: ph, overflow: 'visible' }
      : STAGE_STYLE;
  const maxFlipW = Math.max(2000, Math.ceil(pw * 2));
  const maxFlipH = Math.max(2000, Math.ceil(ph * 2));
  return (
    <div data-handbook-stage="zeiss" style={stageStyle}>
      <HTMLFlipBook
        ref={flipRef}
        className="pointer-events-auto !overflow-visible"
        style={{ width: '100%', height: '100%', display: 'block', margin: 0 }}
        width={pw} height={ph}
        minWidth={200} minHeight={200}
        maxWidth={maxFlipW} maxHeight={maxFlipH}
        size={engineSize} autoSize
        startPage={startPage} flippingTime={FLIP_MS}
        drawShadow usePortrait={false} startZIndex={0}
        showCover={false} clickEventForward useMouseEvents disableFlipByClick={false}
        onFlip={onFlip} onInit={onInit} onChangeState={onChangeState}
      >
        {pages}
      </HTMLFlipBook>
    </div>
  );
}

/* ─── ZeissDigitalHandbook（主组件）────────────────────────────────────── */

export function ZeissDigitalHandbook() {
  /* ── refs ── */
  const previewRef      = useRef<ReactPageFlipRef>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);

  /**
   * 状态主权标志：全屏期间为 true，屏蔽 page-flip onFlip/onChangeState 的写入。
   * 使用 ref（非 state）避免引入额外渲染循环。
   */
  const isFsRef = useRef(false);

  /* ── state ── */
  const [previewSize,  setPreviewSize]  = useState({ w: 0, h: 0 });
  const [currentPage,  setCurrentPage]  = useState(0);
  const [isFs,         setIsFs]         = useState(false);
  const [mounted,      setMounted]      = useState(false);
  /** 每次进入全屏递增，与 currentPage 组成 Portal 子树 key，强制销毁旧 DOM（cache bust） */
  const [fsEpoch,      setFsEpoch]      = useState(0);

  /* isFsRef 随 isFs state 同步（layout effect 保证渲染帧内一致） */
  useLayoutEffect(() => { isFsRef.current = isFs; }, [isFs]);

  /* hydration 标志 */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const openFullscreen = useCallback(() => {
    setFsEpoch((e) => e + 1);
    setIsFs(true);
  }, []);

  /* 预览壳尺寸观察 */
  useLayoutEffect(() => {
    const el = previewShellRef.current;
    if (!el) return;
    setPreviewSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setPreviewSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const previewScale = useMemo(
    () => calcPreviewCoverScale(previewSize.w, previewSize.h),
    [previewSize.w, previewSize.h],
  );

  /* ── 数据 ── */
  const total = useMemo(() => getHandbookPageCount('zeiss'), []);

  /* ── 预览书页码同步（状态主权：全屏期间屏蔽 page-flip 写入）── */
  const syncPage = useCallback(() => {
    if (isFsRef.current) return; // 全屏期间：ZeissFullscreenMirror 独占 currentPage
    try {
      const idx = previewRef.current?.pageFlip?.()?.getCurrentPageIndex?.();
      if (Number.isFinite(idx)) setCurrentPage(idx as number);
    } catch { /* ignore */ }
  }, []);

  const exposeInstance = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.pageFlipInstance = previewRef.current?.pageFlip?.() as Window['pageFlipInstance'];
    } catch { window.pageFlipInstance = undefined; }
  }, []);

  useEffect(() => {
    exposeInstance();
    return () => { if (typeof window !== 'undefined') window.pageFlipInstance = undefined; };
  }, [exposeInstance, currentPage, isFs]);

  const onInit = useCallback(() => {
    queueMicrotask(() => { exposeInstance(); syncPage(); });
  }, [exposeInstance, syncPage]);

  const onChangeState = useCallback(
    (e: { data?: unknown }) => {
      if (e.data === 'read') requestAnimationFrame(() => { syncPage(); exposeInstance(); });
    },
    [syncPage, exposeInstance],
  );

  /* 状态主权：全屏期间 onFlip 不写 currentPage */
  const onFlip = useCallback(
    (e: { data?: unknown }) => {
      requestAnimationFrame(() => {
        if (isFsRef.current) return; // 全屏：page-flip 引擎不得干预 currentPage
        const raw = e?.data;
        if (raw !== undefined && raw !== null) {
          const n = Number(raw);
          if (Number.isFinite(n)) { setCurrentPage(Math.max(0, Math.floor(n))); exposeInstance(); return; }
        }
        syncPage(); exposeInstance();
      });
    },
    [exposeInstance, syncPage],
  );

  const pages = useMemo(
    () =>
      Array.from({ length: total }, (_, i) => {
        const p1 = i + 1;
        const pd = getPageData(p1, 'zeiss');
        return (
          <ZeissHandbookPage
            key={`zeiss-pdf-${p1}`}
            pageIndex={i}
            pageNumber={p1}
            title={pd?.title ?? `第 ${p1} 页`}
            imageData={pd?.imageData ?? null}
            imageUrl={pd?.imageUrl ?? null}
            physicalAnchorPage={pd?.physicalAnchorPage ?? false}
            anchorPreservationInsetPct={pd?.anchorPreservationInsetPct ?? null}
            isManualTrimmed={pd?.isManualTrimmed ?? false}
          />
        );
      }),
    [total],
  );

  /* ── 全屏关闭后：单次同步预览书页码 ── */
  const currentPageRef = useRef(currentPage);
  useLayoutEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  useEffect(() => {
    if (isFs) return;
    const id = setTimeout(() => {
      try {
        const pf = previewRef.current?.pageFlip?.();
        if (!pf) return;
        const target = currentPageRef.current;
        const cur = pf.getCurrentPageIndex?.() ?? 0;
        if (cur === target) return;
        if (typeof pf.turnToPage === 'function') pf.turnToPage(target);
        else pf.flip(target, 'top');
      } catch { /* ignore */ }
    }, 80);
    return () => clearTimeout(id);
  }, [isFs]);

  /* ── 翻页主权回调（纯 state 驱动，无 page-flip 引擎调用）── */

  /**
   * 全屏翻页：delta=+2 下翻，delta=-2 上翻。
   * 唯一数据流：setCurrentPage → fsMirrorSpread → img.src → 秒显示（浏览器缓存）。
   */
  const goToPageDelta = useCallback((delta: number) => {
    setCurrentPage((p) => Math.max(0, Math.min(total - 1, p + delta)));
  }, [total]);

  /**
   * 全屏侧栏绝对跳转（不调用 page-flip 引擎）。
   */
  const goToPage = useCallback((target0: number) => {
    setCurrentPage(Math.max(0, Math.min(total - 1, target0)));
  }, [total]);

  /* ── 空手册 ── */
  if (total <= 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-white/70">
        蔡司手册页尚未就绪
      </div>
    );
  }

  const sharedStageProps = { pages, onFlip, onInit, onChangeState } as const;

  return (
    <section
      className="zeiss-digital-handbook relative w-full min-w-0"
      data-handbook-flip-shell="1"
    >
      {/* 标题栏 */}
      {!isFs && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-white/85 sm:text-base">
            蔡司价目手册 · 沉浸式翻阅
          </h2>
          <button
            type="button"
            onClick={openFullscreen}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-md transition hover:bg-white/10"
            aria-label="全屏沉浸阅读"
          >
            <Maximize2 className="h-3.5 w-3.5 opacity-90" />
            全屏沉浸
          </button>
        </div>
      )}

      {/*
       * 预览壳（始终挂载，isFs 期间 visibility:hidden）
       *
       * 居中策略：ScaledBlock 绝对居中（left:50% translateX(-50%)），
       * 基于视觉宽度对齐，书中缝无偏移；overflow:hidden 对称裁切溢出。
       */}
      <div
        ref={previewShellRef}
        data-zeiss-preview-shell="1"
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 p-0 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        style={{
          aspectRatio: `${SPREAD_W} / ${PHYS_H}`,
          maxHeight: '78vh',
          visibility: isFs ? 'hidden' : 'visible',
        }}
        aria-hidden={isFs}
      >
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1 }}>
          <ScaledBlock scale={previewScale}>
            <div style={{ position: 'relative', width: SPREAD_W, height: PHYS_H, overflow: 'visible' }}>
              <BookStage flipRef={previewRef} startPage={0} {...sharedStageProps} />
            </div>
          </ScaledBlock>
        </div>
        <ZeissHandbookRailDockSpread currentPageIndex0={currentPage} pageCount={total} />
      </div>

      <ZeissFsMirrorPortal
        open={isFs}
        appMounted={mounted}
        portalReactKey={`${fsEpoch}-${currentPage}`}
        currentPage={currentPage}
        total={total}
        onNavigate={goToPageDelta}
        onNavigateToPage={goToPage}
        onClose={() => setIsFs(false)}
      />

      {!isFs && (
        <p className="mt-2 text-center text-[10px] text-white/45">
          预览：拖拽书角翻页。全屏：左 15% 上翻 / 右 15% 下翻 / 中心区触发价目回填，双指缩放后点击回弹。
        </p>
      )}
    </section>
  );
}
