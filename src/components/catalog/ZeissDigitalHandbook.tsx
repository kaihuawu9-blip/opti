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
 *    HandbookFsInteractionZone 三区路由：
 *      左 15% → prev · 中心 70% → 指纹 dispatch → 收银 · 右 15% → next
 *    键盘路由由 ZeissFullscreenMirror 独立持有，不经任何父级中转。
 */

import dynamic from 'next/dynamic';
import {
  useCallback, useEffect, useLayoutEffect,
  useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import { ZeissHandbookShortcutRail } from '@/components/catalog/ZeissHandbookShortcutRail';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { HandbookFsInteractionZone } from '@/components/catalog/HandbookFsInteractionZone';
import { getHandbookPageCount, getPageData } from '@/data/zeissHandbookPageMap';

/* ─── 物理常数 ────────────────────────────────────────────────────────────── */

const PAGE_RATIO = 1.4145;
const PAGE_W     = 450;
const PAGE_H     = Math.floor(PAGE_W * PAGE_RATIO); // 636
const RAIL_W     = 60;
const FLIP_MS    = 700;
const ZEISS_FS_FORCE_IMG_SCALE_TEST = false;
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

function ZeissHandbookRailDockViewport({
  currentPageIndex0,
  pageCount,
  onNavigateToPageIndex0,
}: {
  currentPageIndex0: number;
  pageCount: number;
  onNavigateToPageIndex0?: (pageIndex0: number) => void;
}) {
  return (
    <div
      className="zeiss-handbook-side-rail zeiss-series-nav-container pointer-events-auto"
      data-zeiss-fs-rail-fixed="1"
      style={{ position: 'fixed', right: 0, top: 0, height: '100vh', width: RAIL_W, zIndex: 80 }}
    >
      <ZeissHandbookShortcutRail
        currentPageIndex0={currentPageIndex0}
        pageCount={pageCount}
        onNavigateToPageIndex0={onNavigateToPageIndex0}
      />
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

/* ─── ZeissFullscreenMirror — 纯净全屏镜像层 ────────────────────────────── */

interface ZeissFullscreenMirrorProps {
  /** 当前跨幅左页 0-based 索引（与父组件共享同一 state） */
  currentPage: number;
  total: number;
  /** 翻页主权回调：delta=+2 下翻，delta=-2 上翻 */
  onNavigate: (delta: number) => void;
  /** 侧栏绝对跳转回调 */
  onNavigateToPage: (page0: number) => void;
  onClose: () => void;
}

/**
 * ZeissFullscreenMirror — StandardEye 4.0 · 物理隔离全屏层
 *
 * 三大主权：
 *   - 键盘主权：Esc / Arrow* 由本组件独立持有，不经父级中转
 *   - 图像主权：双图直接撞边，无 page-flip 引用，无 stf__ 类名
 *   - 路由主权：HandbookFsInteractionZone 三区路由（15% / 70% / 15%）
 *
 * 翻页路径：用户操作 → onNavigate(delta) → 父级 setCurrentPage(clamp) →
 *   React re-render → img.src 更新（已缓存则秒显示）
 */
function ZeissFullscreenMirror({
  currentPage, total, onNavigate, onNavigateToPage, onClose,
}: ZeissFullscreenMirrorProps) {
  const fsSpreadsRef = useRef<HTMLDivElement>(null);

  /* 手势层变换同步到图像层（zoom/pan 视觉一致性） */
  const handleFsTransformChange = useCallback(
    (xform: { x: number; y: number; scale: number }) => {
      const el = fsSpreadsRef.current;
      if (!el) return;
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate3d(${xform.x}px, ${xform.y}px, 0) scale(${xform.scale})`;
    },
    [],
  );

  /* 键盘主权：Esc / Arrow 由本组件独立持有 */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onNavigate(2); return; }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); onNavigate(-2); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onNavigate, onClose]);

  /* 图像数据：仅依赖 currentPage + total，不依赖 page-flip 引擎 */
  const spread = useMemo(() => {
    const getImg = (p1: number) => {
      const pd = getPageData(p1, 'zeiss');
      const url = pd?.imageUrl?.trim();
      return {
        src: (url && url.length > 0 ? url : null) ?? pd?.imageData ?? '',
        alt: pd?.title ?? `第 ${p1} 页`,
      };
    };
    if (total <= 0) return { left: null, right: null };
    const leftP1  = Math.min(total, Math.max(1, currentPage + 1));
    const rightP1 = leftP1 + 1;
    return {
      left:  getImg(leftP1),
      right: rightP1 <= total ? getImg(rightP1) : null,
    };
  }, [currentPage, total]);

  /* 页槽公共样式 */
  const slotImgStyle: CSSProperties = {
    position: 'absolute', inset: 0,
    width: '100%', height: '100%',
    objectFit: 'fill', objectPosition: 'center',
    display: 'block', userSelect: 'none',
  };
  const slotFallbackStyle: CSSProperties = { position: 'absolute', inset: 0, background: '#111' };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="蔡司价目手册 · 全屏沉浸"
      data-zeiss-fs-mirror="1"
      data-zeiss-fs-img-scale-test={ZEISS_FS_FORCE_IMG_SCALE_TEST ? '1' : undefined}
      style={{
        position: 'fixed', left: 0, top: 0,
        width: '100vw', height: '100vh',
        maxWidth: 'none', maxHeight: 'none',
        zIndex: 1, padding: 0, margin: 0, borderRadius: 0,
        boxSizing: 'border-box', overflow: 'visible',
        background: '#000', touchAction: 'none', overscrollBehavior: 'none',
      }}
    >
      {/*
       * Layer 0 — 双图物理镜像
       * 左槽 [0, 50%)  右槽 [50%, 100%)，中缝焊死 50% 中轴。
       * 无 stf__ / flip 类名；翻页 = img.src 切换，无引擎调用。
       */}
      <div
        ref={fsSpreadsRef}
        data-zeiss-fs-image-layer="1"
        style={{
          position: 'fixed', top: 0, left: 0,
          width: '100vw', height: '100vh',
          maxWidth: 'none', maxHeight: 'none',
          margin: 0, zIndex: 1, transformOrigin: '0 0',
        }}
      >
        {/* 左页槽 */}
        <div
          data-zeiss-fs-page-slot="left"
          style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: '100%', boxSizing: 'border-box' }}
        >
          {spread.left?.src
            ? <img data-zeiss-fs-layer0-img="left" src={spread.left.src} alt={spread.left.alt} style={slotImgStyle} decoding="async" draggable={false} />
            : <div style={slotFallbackStyle} />
          }
        </div>
        {/* 右页槽 */}
        <div
          data-zeiss-fs-page-slot="right"
          style={{ position: 'absolute', top: 0, left: '50%', width: '50%', height: '100%', boxSizing: 'border-box' }}
        >
          {spread.right?.src
            ? <img data-zeiss-fs-layer0-img="right" src={spread.right.src} alt={spread.right.alt} style={slotImgStyle} decoding="async" draggable={false} />
            : <div style={slotFallbackStyle} />
          }
        </div>
      </div>

      {/*
       * Layer 1 — 透明手势雷达
       * 三区路由（15%/70%/15%）+ 双指 zoom/pan；onTransformChange 同步 Layer 0。
       */}
      <HandbookFsInteractionZone
        innerFill
        userZoomEnabled
        baseScale={1}
        onTransformChange={handleFsTransformChange}
        onNavigate={onNavigate}
        currentPage={currentPage}
        pageW={PAGE_W}
        pageH={PAGE_H}
        brand="zeiss"
        style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'transparent' }}
      >
        {/* anchor div：与 Layer0 同尺寸，供 buildPageCoord 边界参照（非必须，保留向后兼容） */}
        <div data-handbook-fs-spread-anchor="1" style={{ position: 'absolute', inset: 0 }} />
      </HandbookFsInteractionZone>

      {/* Layer 2 — fixed 侧栏（不占书宽） */}
      <ZeissHandbookRailDockViewport
        currentPageIndex0={currentPage}
        pageCount={total}
        onNavigateToPageIndex0={onNavigateToPage}
      />

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="退出全屏"
        style={{ position: 'absolute', right: 16, top: 16, zIndex: 100 }}
        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/70 text-white shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition hover:bg-slate-900/80"
      >
        <X className="h-6 w-6" strokeWidth={2.4} />
      </button>
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
  const [fsPortalHost, setFsPortalHost] = useState<HTMLElement | null>(null);

  /* isFsRef 随 isFs state 同步（layout effect 保证渲染帧内一致） */
  useLayoutEffect(() => { isFsRef.current = isFs; }, [isFs]);

  /* hydration 标志 */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  /* 全屏 portal 宿主（挂 body 末级，脱离祖先 transform / max-width 约束） */
  useLayoutEffect(() => {
    if (!mounted || !isFs) {
      setFsPortalHost((prev) => {
        if (prev?.isConnected) prev.remove();
        return null;
      });
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('data-zeiss-fs-portal-host', '1');
    host.style.cssText =
      'position:fixed;left:0;top:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:visible;z-index:2147483646;pointer-events:auto;box-sizing:border-box;';
    document.body.appendChild(host);
    setFsPortalHost(host);
    return () => { host.remove(); setFsPortalHost(null); };
  }, [mounted, isFs]);

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
            onClick={() => setIsFs(true)}
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

      {/*
       * 全屏镜像层：ZeissFullscreenMirror（完全独立，物理层纯净）
       * portal → body 末级宿主，脱离祖先 transform / max-width 约束。
       */}
      {mounted && isFs && fsPortalHost &&
        createPortal(
          <ZeissFullscreenMirror
            currentPage={currentPage}
            total={total}
            onNavigate={goToPageDelta}
            onNavigateToPage={goToPage}
            onClose={() => setIsFs(false)}
          />,
          fsPortalHost,
        )
      }

      {!isFs && (
        <p className="mt-2 text-center text-[10px] text-white/45">
          预览：拖拽书角翻页。全屏：左 15% 上翻 / 右 15% 下翻 / 中心区触发价目回填，双指缩放后点击回弹。
        </p>
      )}
    </section>
  );
}
