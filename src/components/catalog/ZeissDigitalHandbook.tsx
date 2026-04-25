'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { playHandbookPaperRustle } from '@/lib/catalog/handbookPaperSound';
import { getHandbookPageCount, getPageData } from '@/data/zeissHandbookPageMap';

/**
 * 单页槽位尺寸（宽 × 高）。蔡司素材实际是横版页（约 4:3），整书展开 = 2 × PAGE_W × PAGE_H。
 * 每张 PDF 图都将以 `object-cover` 精确填满此槽位，**容器与图片可视区一样大**，无上下黑边。
 */
const PAGE_W = 540;
const PAGE_H = 405;
const SPREAD_W = PAGE_W * 2;
const SPREAD_H = PAGE_H;

/** 蔡司物理标签锚点（PDF 1-based 页）。点击直接 flip 到该页。 */
const ZEISS_TABS = [
  { name: '智锐系列', page: 10 },
  { name: '青少年', page: 25 },
  { name: '单光', page: 33 },
  { name: '渐进系列', page: 44 },
  { name: '数码型', page: 53 },
  { name: '驾驶型', page: 56 },
  { name: '户外镜片', page: 60 },
  { name: '附录', page: 64 },
  { name: '健康消费品', page: 80 },
] as const;

const FLIP_MS = 1000;

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
 * 物理舞台：双页书 + 右缘标签条。**容器 = 图片可视区 1:1**。
 * `flipRef` 注入对应实例（预览 / 全屏各持一个）。
 */
function HandbookStage({
  flipRef,
  pages,
  currentPage,
  onFlip,
  onBookInit,
  onChangeState,
}: {
  flipRef: React.RefObject<ReactPageFlipRef | null>;
  pages: React.ReactNode;
  currentPage: number;
  onFlip: () => void;
  onBookInit: () => void;
  onChangeState: (e: { data?: unknown }) => void;
}) {
  const onTabClick = useCallback((page1: number) => {
    try {
      window.pageFlipInstance?.flip(page1 - 1, 'top');
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      className="flex items-center justify-center gap-2"
      data-handbook-stage="zeiss"
      style={{ height: SPREAD_H }}
    >
      {/* 书：永远双页展开（取消 showCover，避免封面只占半幅造成视觉「靠上靠左」） */}
      <div
        className="relative shrink-0 self-center"
        style={{ width: SPREAD_W, height: SPREAD_H }}
      >
        <HTMLFlipBook
          ref={flipRef}
          className="pointer-events-auto h-full w-full !overflow-visible"
          style={{ width: SPREAD_W, height: SPREAD_H, margin: 0, minHeight: SPREAD_H, display: 'block' }}
          width={PAGE_W}
          height={PAGE_H}
          minWidth={PAGE_W}
          minHeight={PAGE_H}
          maxWidth={PAGE_W}
          maxHeight={PAGE_H}
          size="fixed"
          startPage={0}
          flippingTime={FLIP_MS}
          drawShadow
          usePortrait={false}
          startZIndex={0}
          showCover={false}
          autoSize={false}
          clickEventForward
          useMouseEvents
          disableFlipByClick={false}
          onFlip={onFlip}
          onInit={onBookInit}
          onChangeState={onChangeState}
        >
          {pages}
        </HTMLFlipBook>
      </div>

      {/* 标签条：紧贴书右外缘，flex 兄弟节点。垂直均分 9 格，永不重叠 */}
      <ul
        aria-label="蔡司系列快速跳转"
        className="pointer-events-auto z-50 flex shrink-0 flex-col gap-1.5"
        style={{
          height: SPREAD_H,
          width: 108,
          paddingTop: 18,
          paddingBottom: 18,
        }}
      >
        {ZEISS_TABS.map((tab) => {
          const isActive = currentPage + 1 >= tab.page;
          return (
            <li key={tab.page} className="flex-1 min-h-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClick(tab.page);
                }}
                className={[
                  'group flex h-full w-full items-center justify-start',
                  'rounded-r-md border-l-[3px] px-2.5 text-left',
                  'shadow-[0_2px_6px_rgba(0,0,0,0.25)] backdrop-blur-md transition-all duration-200',
                  isActive
                    ? 'border-[#0066B3] bg-white/85 hover:bg-white'
                    : 'border-white/35 bg-white/30 hover:bg-white/55',
                ].join(' ')}
              >
                <span
                  className={[
                    'whitespace-nowrap text-[12px] font-bold tracking-wide',
                    isActive ? 'text-[#0066B3]' : 'text-slate-700',
                  ].join(' ')}
                >
                  {tab.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ZeissDigitalHandbook() {
  const previewFlipRef = useRef<ReactPageFlipRef>(null);
  const fsFlipRef = useRef<ReactPageFlipRef>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const total = useMemo(() => getHandbookPageCount('zeiss'), []);

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

  useEffect(() => {
    if (!fullscreenOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenOpen]);

  /** 视口比书+标签窄时横向可滚动，并把初始位置放在中间，避免只看见「半本书/半列标签」 */
  const centerPreviewScroll = useCallback(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) {
      el.scrollLeft = 0;
      return;
    }
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, []);

  useLayoutEffect(() => {
    if (fullscreenOpen) return;
    centerPreviewScroll();
  }, [fullscreenOpen, centerPreviewScroll]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || fullscreenOpen) return;
    const el = previewScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      centerPreviewScroll();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreenOpen, centerPreviewScroll]);

  if (total <= 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-white/70">
        蔡司手册页尚未就绪
      </div>
    );
  }

  const previewBlock = (
    <section className="relative w-full min-w-0">
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
        ref={previewScrollRef}
        className="relative w-full min-w-0 overflow-x-auto overflow-y-visible py-8 [scrollbar-gutter:stable] rounded-2xl border border-white/10 bg-slate-950/60 px-1 text-center shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        style={{ minHeight: SPREAD_H + 64 }}
        aria-label="手册阅读区，内容较宽时可左右滑动查看"
      >
        <div className="inline-block w-max min-w-0 max-w-none text-left align-middle">
          {!fullscreenOpen ? (
            <HandbookStage
              flipRef={previewFlipRef}
              pages={pages}
              currentPage={currentPage}
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
              className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-md"
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
