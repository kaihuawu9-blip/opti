'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import { ZeissSeriesNavList } from '@/components/catalog/ZeissSeriesNavList';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { playHandbookPaperRustle } from '@/lib/catalog/handbookPaperSound';
import {
  buildHandbookSeriesNavItemsForBrand,
  getHandbookPageCount,
  getPageData,
  type HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';

/**
 * 单页尺寸由「基宽 + 标准比例」唯一导出，不手写“猜”的像素高。
 * PAGE_RATIO = 高/宽，与 A4 纵向比例一致时约为 √2；若你 PDF 栅格与标准 A4 不一致，请按原图高÷宽替换此常数。
 */
const PAGE_RATIO = 1.4145;
const PAGE_W = 450;
const PAGE_H = Math.floor(PAGE_W * PAGE_RATIO);
/** 右侧系列栏宽 */
const RAIL_W = 60;
/** 凸标与书右缘间隙（`absolute; left: 100%` 后再加） */
const RAIL_GAP = 5;
/** 外沿总宽 = 书宽 + 间隙 + 栏，用于 `w-max` 占位与 `min(…, calc(100vw - 本值))` 行高 */
const RAIL_CHROME = RAIL_W + RAIL_GAP;
/**
 * 单页 高/宽 = PAGE_RATIO 时，双页展开 宽/高 = 2 / PAGE_RATIO（与 PDF 等效外接框一致，不含右栏 60px）。
 * @see `PAGE_W`、{@link PAGE_H}：引擎内部页尺寸仍用这两值，stretch 仅缩放 Canvas。
 */
const ASPECT_SPREAD = `2 / ${PAGE_RATIO}` as const;

const FLIP_MS = 1000;

/** 舞台行：高由视口+屏宽与侧栏反算共同约束，书槽+侧栏 总宽 100vw 内不溢出。 */
const STAGE_ROW_OUTER_STYLE: CSSProperties = {
  height: `min(85vh, 900px, calc((100vw - ${RAIL_CHROME}px) * ${PAGE_RATIO} / 2))`,
  maxHeight: 900,
  maxWidth: '100%',
  width: 'max-content',
  minWidth: 0,
};

/**
 * 双页书槽锚点层（2 : PAGE_RATIO）：`stretch` 吃满；侧栏与 `HTMLFlipBook` 同级、紧挨书右缘
 * `absolute; left: 100%` 叠出，不占本列流式宽度（同行右侧另见占位块）。
 * 行高在父级 {@link STAGE_ROW_OUTER_STYLE} 中给定。
 */
function HandbookAspectBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={['relative h-full min-h-0 min-w-0 shrink-0', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: ASPECT_SPREAD, maxWidth: '100%' }}
    >
      <div className="relative h-full w-full min-h-0 min-w-0">{children}</div>
    </div>
  );
}

function loadReactPageFlip(): Promise<ComponentType<ReactPageFlipProps>> {
  return import('react-pageflip').then((m) => m.default as ComponentType<ReactPageFlipProps>);
}

const HTMLFlipBook = dynamic(loadReactPageFlip, {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-white/60">加载 3D 书引擎…</div>
  ),
});

/**
 * 物理舞台：外层由 {@link HandbookAspectBox} 锁比例；`stretch` 吃满剩余宽，右栏高与锚点同高。
 */
function HandbookStage({
  flipRef,
  pages,
  currentPage,
  seriesNav,
  activeNavId,
  onSelectNavItem,
  onFlip,
  onBookInit,
  onChangeState,
}: {
  flipRef: React.RefObject<ReactPageFlipRef | null>;
  pages: React.ReactNode;
  currentPage: number;
  seriesNav: readonly HandbookSeriesNavItem[];
  activeNavId: string;
  onSelectNavItem: (item: HandbookSeriesNavItem) => void;
  onFlip: () => void;
  onBookInit: () => void;
  onChangeState: (e: { data?: unknown }) => void;
}) {
  return (
    <div
      className="relative box-border inline-flex min-h-0 w-max min-w-0 max-w-full flex-row items-stretch overflow-x-visible overflow-y-clip"
      data-handbook-stage="zeiss"
      style={STAGE_ROW_OUTER_STYLE}
    >
      <HandbookAspectBox>
        <HTMLFlipBook
          ref={flipRef}
          className="pointer-events-auto !h-full !w-full !min-h-0 !min-w-0 !overflow-visible"
          style={{ width: '100%', height: '100%', margin: 0, display: 'block' }}
          width={PAGE_W}
          height={PAGE_H}
          minWidth={200}
          minHeight={200}
          maxWidth={2000}
          maxHeight={2000}
          size="stretch"
          autoSize
          startPage={0}
          flippingTime={FLIP_MS}
          drawShadow
          usePortrait={false}
          startZIndex={0}
          showCover={false}
          clickEventForward
          useMouseEvents
          disableFlipByClick={false}
          onFlip={onFlip}
          onInit={onBookInit}
          onChangeState={onChangeState}
        >
          {pages}
        </HTMLFlipBook>

        <div
          className="pointer-events-auto absolute z-[60] flex flex-col"
          style={{
            left: '100%',
            top: 0,
            height: '100%',
            width: RAIL_W,
            marginLeft: RAIL_GAP,
          }}
        >
          <ZeissSeriesNavList
            items={seriesNav}
            pageIndex={0}
            activeId={activeNavId}
            onSelect={onSelectNavItem}
            brand="zeiss"
            navLayout="classic"
            compact
            useTwoColumn={false}
            viewerPdfPage1={currentPage + 1}
            className="!h-full !min-h-0 !rounded-l-none !rounded-r-md"
          />
        </div>
      </HandbookAspectBox>

      {/* 绝对定位侧栏不占流式宽，为 w-max 布局行与视口行高、与「书+65px」外沿对齐 */}
      <div
        aria-hidden
        className="h-full min-h-0 shrink-0"
        style={{ width: RAIL_CHROME, flexShrink: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

export function ZeissDigitalHandbook() {
  const previewFlipRef = useRef<ReactPageFlipRef>(null);
  const fsFlipRef = useRef<ReactPageFlipRef>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const total = useMemo(() => getHandbookPageCount('zeiss'), []);
  const seriesNav = useMemo(() => buildHandbookSeriesNavItemsForBrand('zeiss'), []);

  const activeFlipRef = fullscreenOpen ? fsFlipRef : previewFlipRef;

  const syncCurrentPage = useCallback(() => {
    try {
      const idx = activeFlipRef.current?.pageFlip?.()?.getCurrentPageIndex?.();
      if (Number.isFinite(idx)) setCurrentPage(idx as number);
    } catch {
      /* ignore */
    }
  }, [activeFlipRef]);

  const exposeWindowInstance = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.pageFlipInstance = activeFlipRef.current?.pageFlip?.() as Window['pageFlipInstance'];
    } catch {
      window.pageFlipInstance = undefined;
    }
  }, [activeFlipRef]);

  useEffect(() => {
    exposeWindowInstance();
    return () => {
      if (typeof window !== 'undefined') window.pageFlipInstance = undefined;
    };
  }, [exposeWindowInstance, currentPage, fullscreenOpen]);

  const onBookInit = useCallback(() => {
    queueMicrotask(() => {
      exposeWindowInstance();
      syncCurrentPage();
    });
  }, [exposeWindowInstance, syncCurrentPage]);

  const onChangeState = useCallback(
    (e: { data?: unknown }) => {
      if (e?.data === 'flipping') playHandbookPaperRustle();
      if (e?.data === 'read') syncCurrentPage();
    },
    [syncCurrentPage],
  );

  const onFlip = useCallback(() => {
    syncCurrentPage();
    exposeWindowInstance();
  }, [exposeWindowInstance, syncCurrentPage]);

  const onSelectNavItem = useCallback((item: HandbookSeriesNavItem) => {
    try {
      window.pageFlipInstance?.flip(item.startPage0, 'top');
    } catch {
      /* ignore */
    }
  }, []);

  const activeNavId = useMemo(() => {
    let active = '';
    for (const item of seriesNav) {
      if (item.startPage0 <= currentPage) active = item.id;
    }
    return active;
  }, [seriesNav, currentPage]);

  const pages = useMemo(
    () =>
      Array.from({ length: total }, (_, idx) => {
        const page1 = idx + 1;
        const pd = getPageData(page1, 'zeiss');
        return (
          <ZeissHandbookPage
            key={`zeiss-pdf-${page1}`}
            pageIndex={idx}
            pageNumber={page1}
            title={pd?.title ?? `第 ${page1} 页`}
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

  useEffect(() => {
    if (!fullscreenOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenOpen]);

  if (total <= 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-white/70">
        蔡司手册页尚未就绪
      </div>
    );
  }

  const previewBlock = (
    <section
      className="zeiss-digital-handbook relative w-full min-w-0"
      data-handbook-flip-shell="1"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-white/85 sm:text-base">
          蔡司价目手册 · 沉浸式翻阅
        </h2>
        <button
          type="button"
          onClick={() => setFullscreenOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-md transition hover:bg-white/10"
          aria-label="全屏沉浸阅读"
        >
          <Maximize2 className="h-3.5 w-3.5 opacity-90" />
          全屏沉浸
        </button>
      </div>

      <div
        className="relative w-full min-w-0 overflow-visible py-8 rounded-2xl border border-white/10 bg-slate-950/60 px-1 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        style={{ minHeight: 'calc(min(85vh, 900px) + 4rem)' }}
        aria-label="手册阅读区"
      >
        <div className="inline-block w-max min-w-0 max-w-none text-left align-middle">
          {!fullscreenOpen ? (
            <HandbookStage
              flipRef={previewFlipRef}
              pages={pages}
              currentPage={currentPage}
              seriesNav={seriesNav}
              activeNavId={activeNavId}
              onSelectNavItem={onSelectNavItem}
              onFlip={onFlip}
              onBookInit={onBookInit}
              onChangeState={onChangeState}
            />
          ) : (
            <div className="text-xs text-white/55">沉浸阅读已开启 · 当前在全屏模式</div>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] text-white/45">
        翻页时单击书角或拖拽；右侧标签可直接跳转到对应系列。
      </p>
    </section>
  );

  if (typeof window === 'undefined') return previewBlock;

  return (
    <>
      {previewBlock}
      {fullscreenOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal
              aria-label="蔡司价目手册 · 全屏沉浸"
              className="fixed inset-0 z-[300] flex h-full w-full items-center justify-center overflow-visible bg-[#1a1a1a] leather-field"
              data-handbook-flip-shell="1"
            >
              <button
                type="button"
                onClick={() => setFullscreenOpen(false)}
                aria-label="退出全屏"
                className="pointer-events-auto fixed right-4 top-4 z-[400] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/55 text-white shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl transition hover:bg-slate-900/70 md:right-6 md:top-6"
              >
                <X className="h-7 w-7" strokeWidth={2.4} />
              </button>

              <HandbookStage
                flipRef={fsFlipRef}
                pages={pages}
                currentPage={currentPage}
                seriesNav={seriesNav}
                activeNavId={activeNavId}
                onSelectNavItem={onSelectNavItem}
                onFlip={onFlip}
                onBookInit={onBookInit}
                onChangeState={onChangeState}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
