'use client';

/**
 * ZeissDigitalHandbook — StandardEye 4.0 Portal 重构版
 *
 * 架构要点
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 全屏层经由 createPortal 挂到 document.body，彻底脱离任何祖先 transform
 *    (framer-motion / 侧边栏动画)，fixed inset-0 必然对齐真实视口。
 * 2. 全屏缩放直接读 window.innerWidth / innerHeight（免疫祖先 containing block）。
 * 3. 预览书保持 visibility:hidden（不卸载），全屏关闭后无需重新初始化。
 * 4. isFsRef 同步 isFs 状态，防止 onFlip/onInit 等长寿回调拿到旧闭包值。
 * 5. 全屏：cover 缩放 + 100vw/100vh 皮面 + InteractionZone 禁手势缩放；页图 CSS fill 贴齐槽位。
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import { ZeissHandbookShortcutRail } from '@/components/catalog/ZeissHandbookShortcutRail';
import { HandbookFsInteractionZone } from '@/components/catalog/HandbookFsInteractionZone';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { getHandbookPageCount, getPageData } from '@/data/zeissHandbookPageMap';

/* ─── 物理常数 ────────────────────────────────────────────────────────────── */

const PAGE_RATIO = 1.4145;
const PAGE_W    = 450;
const PAGE_H    = Math.floor(PAGE_W * PAGE_RATIO); // 636
const RAIL_W    = 60;
const RAIL_GAP  = 5;
/** 翻页「速度感」：600–800ms 区间，固定 700，与价目册快节奏一致 */
const FLIP_MS   = 700;

const PHYS_W  = 2 * PAGE_W + RAIL_W + RAIL_GAP; // 965 — 书+间隙+栏
const PHYS_H  = PAGE_H;                          // 636
const SPREAD_W = 2 * PAGE_W;                     // 900 — 纯书宽

/* ─── 缩放策略 ────────────────────────────────────────────────────────────── */

/** StandardEye 4.0：预览「装入」容器；全屏另用 cover 缩放（见 calcFullscreenCoverScale） */
const FIT             = 1;
/** 预览上限：不超过物理像素（避免模糊） */
const MAX_PREV_SCALE  = 1.0;
/** 全屏 cover 缩放上限（防止极端大屏单点过大） */
const MAX_FULLSCREEN_COVER_SCALE = 4;

function calcScale(containerW: number, containerH: number, maxS: number): number {
  if (containerW < 4 || containerH < 4) return 0.45;
  const raw = Math.min(containerW / PHYS_W, containerH / PHYS_H) * FIT;
  return Math.max(0.15, Math.min(maxS, raw));
}

/**
 * 全屏沉浸：按视口 **cover** 书体物理尺寸（PHYS_W×PHYS_H），消除黑边「缩一圈」；
 * 外层 `overflow:hidden` 裁切溢出；页内图再用 CSS `object-fit:fill` 贴齐单页槽。
 */
function calcFullscreenCoverScale(containerW: number, containerH: number): number {
  if (containerW < 4 || containerH < 4) return 0.45;
  const raw = Math.max(containerW / PHYS_W, containerH / PHYS_H);
  return Math.max(0.15, Math.min(MAX_FULLSCREEN_COVER_SCALE, raw));
}

/* ─── 静态样式 ────────────────────────────────────────────────────────────── */

/**
 * BookStage = 双页书槽（不含 rail）。
 * Rail 在 BookStage 内以 `position:absolute; left:100%` 锚定到右缘，
 * 因此 BookStage 自身宽度仅取 `SPREAD_W`；rail 在 ScaledBlock 的 PHYS_W 容器内向右溢出展示。
 */
const STAGE_STYLE: CSSProperties = {
  position: 'relative',
  width: SPREAD_W, minWidth: SPREAD_W, maxWidth: SPREAD_W,
  height: PHYS_H, minHeight: PHYS_H, maxHeight: PHYS_H,
  overflow: 'visible', // ★ 切勿改 hidden — rail 依赖向右溢出
};

/* ─── 动态加载 react-pageflip ─────────────────────────────────────────────── */

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

/* ─── ScaledBlock ─────────────────────────────────────────────────────────── */

/**
 * 外壳占 scale × 物理尺寸；内部以物理像素渲染后整体缩放。
 * overflow:visible 允许翻页纸角越界显示。
 */
function ScaledBlock({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: PHYS_W * scale,
        height: PHYS_H * scale,
        flexShrink: 0,
        overflow: 'visible',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: PHYS_W,
          height: PHYS_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── BookStage（书槽 + 章节快捷 rail） ────────────────────────────────── */

interface BookStageProps {
  flipRef: React.RefObject<ReactPageFlipRef | null>;
  pages: ReactNode;
  /** react-pageflip startPage；首次挂载时跳到指定页 */
  startPage: number;
  /** 当前 0-based 页码（驱动 rail 激活态；与引擎 onFlip e.data 一致） */
  currentPage: number;
  pageCount: number;
  onFlip: (e: { data?: unknown }) => void;
  onInit: () => void;
  onChangeState: (e: { data?: unknown }) => void;
}

/**
 * BookStage 物理结构（直接子元素）：
 *
 *   <div STAGE_STYLE>                     ← position:relative; width:SPREAD_W
 *     ├ <HTMLFlipBook>                    ← 占满 BookStage
 *     └ <ZeissHandbookShortcutRail>       ← position:absolute; left:100%
 *
 * - rail 与书槽**同处**一个 transform-scale 容器（ScaledBlock），同步缩放无偏差。
 * - BookStage `overflow: visible` 保证 rail 可向右溢出展示。
 */
function BookStage({
  flipRef, pages, startPage, currentPage, pageCount,
  onFlip, onInit, onChangeState,
}: BookStageProps) {
  return (
    <div data-handbook-stage="zeiss" style={STAGE_STYLE}>
      {/* 书槽：占满 BookStage（SPREAD_W × PHYS_H） */}
      <HTMLFlipBook
        ref={flipRef}
        className="pointer-events-auto !overflow-visible"
        style={{ width: '100%', height: '100%', display: 'block', margin: 0 }}
        width={PAGE_W}
        height={PAGE_H}
        minWidth={200}
        minHeight={200}
        maxWidth={2000}
        maxHeight={2000}
        size="stretch"
        autoSize
        startPage={startPage}
        flippingTime={FLIP_MS}
        drawShadow
        usePortrait={false}
        startZIndex={0}
        showCover={false}
        clickEventForward
        useMouseEvents
        disableFlipByClick={false}
        onFlip={onFlip}
        onInit={onInit}
        onChangeState={onChangeState}
      >
        {pages}
      </HTMLFlipBook>

      {/*
       * 章节快捷栏：BookStage 直接子元素
       * left:100% → 紧贴书右缘；marginLeft = RAIL_GAP；高度铺满书页
       */}
      <div
        className="zeiss-handbook-side-rail zeiss-series-nav-container pointer-events-auto z-50"
        style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          marginLeft: RAIL_GAP,
          width: RAIL_W,
          height: '100%',
        }}
      >
        <ZeissHandbookShortcutRail currentPageIndex0={currentPage} pageCount={pageCount} />
      </div>
    </div>
  );
}

/* ─── ZeissDigitalHandbook（导出主体） ───────────────────────────────────── */

export function ZeissDigitalHandbook() {
  /* ── refs ── */
  const previewRef     = useRef<ReactPageFlipRef>(null);
  const fsRef          = useRef<ReactPageFlipRef>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  /**
   * isFsRef：同步保存 isFs，供 onFlip/onInit 等长寿回调读取，
   * 避免因 React 状态异步批更而拿到过期闭包值。
   */
  const isFsRef = useRef(false);

  /* ── state ── */
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const [fsViewport,  setFsViewport]  = useState({ w: 0, h: 0 });
  const [currentPage, setCurrentPage] = useState(0);
  const [isFs,        setIsFs]        = useState(false);
  const [mounted,     setMounted]     = useState(false);

  /* hydration 标志（portal 需要 document）：SSR 下 false，CSR 首帧后 true */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  /* 同步 isFsRef（useLayoutEffect 先于 useEffect，在绘制前完成） */
  useLayoutEffect(() => { isFsRef.current = isFs; }, [isFs]);

  /* ── 预览 RO（观察预览壳 div，测量预览可用尺寸） ── */
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

  /* ── 全屏视口（直接读 window，免疫祖先 containing block） ── */
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isFs) { setFsViewport({ w: 0, h: 0 }); return; }
    const sync = () => setFsViewport({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync, { passive: true });
    return () => window.removeEventListener('resize', sync);
  }, [isFs]);

  /* ── 缩放 ── */
  const previewScale = useMemo(
    () => calcScale(previewSize.w, previewSize.h, MAX_PREV_SCALE),
    [previewSize.w, previewSize.h],
  );
  const fsScale = useMemo(
    () => calcFullscreenCoverScale(fsViewport.w, fsViewport.h),
    [fsViewport.w, fsViewport.h],
  );

  /* ── 数据 ── */
  const total = useMemo(() => getHandbookPageCount('zeiss'), []);

  /* ── 翻页回调（用 isFsRef 而非闭包 isFs） ── */
  const syncPage = useCallback(() => {
    const ref = isFsRef.current ? fsRef : previewRef;
    try {
      const idx = ref.current?.pageFlip?.()?.getCurrentPageIndex?.();
      if (Number.isFinite(idx)) setCurrentPage(idx as number);
    } catch { /* ignore */ }
  }, []);

  const exposeInstance = useCallback(() => {
    if (typeof window === 'undefined') return;
    const ref = isFsRef.current ? fsRef : previewRef;
    try {
      window.pageFlipInstance = ref.current?.pageFlip?.() as Window['pageFlipInstance'];
    } catch {
      window.pageFlipInstance = undefined;
    }
  }, []);

  useEffect(() => {
    exposeInstance();
    return () => { if (typeof window !== 'undefined') window.pageFlipInstance = undefined; };
  }, [exposeInstance, currentPage, isFs]);

  const onInit = useCallback(() => {
    queueMicrotask(() => { exposeInstance(); syncPage(); });
  }, [exposeInstance, syncPage]);

  /**
   * 翻页至「可读」态（`read`）再读 getCurrentPageIndex，作为 onFlip 的兜底。
   */
  const onChangeState = useCallback(
    (e: { data?: unknown }) => {
      if (e.data === 'read') {
        requestAnimationFrame(() => {
          syncPage();
          exposeInstance();
        });
      }
    },
    [syncPage, exposeInstance],
  );

  /**
   * 优先使用引擎 `onFlip` 的 `e.data`（0-based 左叶下标，与 StPageFlip 一致），rAF 后再 setState；否则回读 getCurrentPageIndex。
   */
  const onFlip = useCallback(
    (e: { data?: unknown }) => {
      requestAnimationFrame(() => {
        const raw = e?.data;
        if (raw !== undefined && raw !== null) {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            setCurrentPage(Math.max(0, Math.floor(n)));
            exposeInstance();
            return;
          }
        }
        syncPage();
        exposeInstance();
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

  /* ── 全屏关闭后：把预览书跳到 FS 最后阅读的页码 ── */
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
        if (typeof pf.turnToPage === 'function') {
          pf.turnToPage(target);
        } else {
          pf.flip(target, 'top');
        }
      } catch { /* ignore */ }
    }, 80);
    return () => clearTimeout(id);
  }, [isFs]);

  /* ── Esc 退出全屏 ── */
  useEffect(() => {
    if (!isFs) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFs(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isFs]);

  /* ── 空手册 ── */
  if (total <= 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-white/70">
        蔡司手册页尚未就绪
      </div>
    );
  }

  /** 共享给两个 BookStage 的 props（不含 flipRef / startPage） */
  const sharedStageProps = {
    pages, currentPage, pageCount: total,
    onFlip, onInit, onChangeState,
  } as const;

  /* ─────────────────────────────────────────────────────────────────────────
   * 渲染
   *
   * 预览壳（previewShellRef）：
   *   - 始终在 DOM 中（不卸载），ResizeObserver 始终有效
   *   - isFs 期间 visibility:hidden（不可见但书实例存活，关闭后同步页码）
   *   - startPage=0（预览书首次挂载在第 0 页，后续由 turnToPage 跳转）
   *
   * 全屏层（createPortal → document.body）：
   *   - position:fixed + 100vw×100vh，脱离任何祖先 transform
   *   - cover 缩放（calcFullscreenCoverScale）+ 页图 object-fit:fill，黑边不留缝
   *   - startPage=currentPage → FS 书初始化到当前页码
   *   - fsViewport.w > 0 防止首帧视口未读到时渲染出邮票大小的书
   * ───────────────────────────────────────────────────────────────────────── */
  return (
    <section
      className="zeiss-digital-handbook relative w-full min-w-0"
      data-handbook-flip-shell="1"
    >
      {/* 标题栏：全屏时收起 */}
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

      {/* ★ 预览壳（始终挂载，isFs 期间隐藏） ★ */}
      <div
        ref={previewShellRef}
        className="relative flex w-full items-center justify-center overflow-visible rounded-2xl border border-white/10 bg-slate-950/60 p-0 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        style={{
          height: 'clamp(280px, 55vh, 660px)',
          visibility: isFs ? 'hidden' : 'visible',
        }}
        aria-hidden={isFs}
      >
        <ScaledBlock scale={previewScale}>
          <BookStage
            flipRef={previewRef}
            startPage={0}
            {...sharedStageProps}
          />
        </ScaledBlock>
      </div>

      {/* ★ 全屏层：portal → document.body，绕开祖先 transform ★ */}
      {mounted && isFs &&
        createPortal(
          <div
            className="leather-field pointer-events-auto relative m-0 rounded-none p-0"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              maxWidth: '100vw',
              maxHeight: '100vh',
              zIndex: 999999,
              padding: 0,
              margin: 0,
              borderRadius: 0,
              boxSizing: 'border-box',
              overflow: 'hidden',
              /* 防止浏览器将双指合拢误判为"退出"或触发系统页面缩放 */
              touchAction: 'none',
              overscrollBehavior: 'none',
            }}
            role="dialog"
            aria-modal
            aria-label="蔡司价目手册 · 全屏沉浸"
            data-handbook-flip-shell="1"
            data-zeiss-fullscreen-overlay="1"
          >
            {/* 视口尺寸就绪后才渲染书，防止首帧 scale=0.45 的邮票闪现 */}
            {fsViewport.w > 0 && (
              /*
               * HandbookFsInteractionZone：铺满视口（absolute inset-0），inner transform 恒等，
               * 点击坐标与 getBoundingClientRect 视口像素一致；userZoomEnabled=false 禁手势缩放。
               */
              <div className="absolute inset-0 m-0 min-h-0 w-full overflow-hidden rounded-none p-0">
                <HandbookFsInteractionZone
                  userZoomEnabled={false}
                  currentPage={currentPage}
                  pageW={PAGE_W}
                  pageH={PAGE_H}
                  brand="zeiss"
                  className="h-full min-h-0 w-full"
                >
                  <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-none p-0 m-0">
                    <ScaledBlock scale={fsScale}>
                      <BookStage
                        flipRef={fsRef}
                        startPage={currentPage}
                        {...sharedStageProps}
                      />
                    </ScaledBlock>
                  </div>
                </HandbookFsInteractionZone>
              </div>
            )}

            {/* 关闭钮：z-100 > 感应层 z-75，确保放大态下仍可点击退出 */}
            <button
              type="button"
              onClick={() => setIsFs(false)}
              aria-label="退出全屏"
              style={{ position: 'absolute', right: 16, top: 16, zIndex: 100 }}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/70 text-white shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition hover:bg-slate-900/80"
            >
              <X className="h-6 w-6" strokeWidth={2.4} />
            </button>
          </div>,
          document.body,
        )}

      {!isFs && (
        <p className="mt-2 text-center text-[10px] text-white/45">
          翻页时单击书角或拖拽；右侧为系列标签；点标题旁「全屏沉浸」进入整屏阅读。
        </p>
      )}
    </section>
  );
}
