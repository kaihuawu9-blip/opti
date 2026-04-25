'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { HandbookBinderLeatherField } from '@/components/catalog/HandbookBinderDecor';
import { ZeissSeriesNavList } from '@/components/catalog/ZeissSeriesNavList';
import { ZeissHandbookPage } from '@/components/catalog/ZeissHandbookPage';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { playHandbookPaperRustle } from '@/lib/catalog/handbookPaperSound';
import {
  buildHandbookSeriesNavItemsForBrand,
  getHandbookPageCount,
  getPageData,
  type HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';

const HANDBOOK_FLIPPING_TIME_MS = 1000;
const HANDBOOK_FLIPBOOK_PAGE_W = 450;
const HANDBOOK_FLIPBOOK_PAGE_H = 600;

function loadReactPageFlip(): Promise<ComponentType<ReactPageFlipProps>> {
  return import('react-pageflip').then((m) => m.default as ComponentType<ReactPageFlipProps>);
}

const HTMLFlipBook = dynamic(loadReactPageFlip, {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-white/60">加载 3D 书引擎…</div>
  ),
});

/** 三层物理舞台：背景皮革 + 中轴书体 + 右缘标签。`fullscreen` 改变高度策略，不改变内部三层结构 */
function HandbookPhysicsStage({
  flipRef,
  pages,
  seriesNav,
  activeNavId,
  currentPage,
  onSelectNavItem,
  onFlip,
  onBookInit,
  onChangeState,
  fullscreen,
}: {
  flipRef: React.RefObject<ReactPageFlipRef | null>;
  pages: React.ReactNode;
  seriesNav: HandbookSeriesNavItem[];
  activeNavId: string;
  currentPage: number;
  onSelectNavItem: (item: HandbookSeriesNavItem) => void;
  onFlip: () => void;
  onBookInit: () => void;
  onChangeState: (e: { data?: unknown }) => void;
  fullscreen: boolean;
}) {
  return (
    <div
      id="handbook-physics-root"
      className={[
        'pointer-events-none relative w-full overflow-visible',
        fullscreen ? 'h-full' : 'h-full min-h-[640px]',
      ].join(' ')}
    >
      {/* 第 0 层：荔枝纹皮革背景，全部铺满父级 */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <HandbookBinderLeatherField />
      </div>

      {/* 第 1 层：书（绝对中轴） */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
        style={{ width: '900px', height: '600px', zIndex: 10 }}
      >
        <HTMLFlipBook
          ref={flipRef}
          className="pointer-events-auto h-full w-full !overflow-visible"
          style={{ width: '100%', height: '100%', margin: 0 }}
          width={HANDBOOK_FLIPBOOK_PAGE_W}
          height={HANDBOOK_FLIPBOOK_PAGE_H}
          minWidth={800}
          minHeight={600}
          maxWidth={2000}
          maxHeight={2000}
          size="fixed"
          startPage={0}
          flippingTime={HANDBOOK_FLIPPING_TIME_MS}
          drawShadow={true}
          usePortrait={false}
          startZIndex={0}
          showCover
          autoSize={false}
          clickEventForward
          useMouseEvents={true}
          disableFlipByClick={false}
          onFlip={onFlip}
          onInit={onBookInit}
          onChangeState={onChangeState}
        >
          {pages}
        </HTMLFlipBook>
      </div>

      {/* 第 2 层：物理标签（基于书中心点偏移；与书层独立兄弟节点） */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-[600px] w-[92px] -translate-y-1/2 translate-x-[450px] overflow-visible">
        <div className="pointer-events-auto h-full w-full">
          <ZeissSeriesNavList
            items={seriesNav}
            pageIndex={1}
            activeId={activeNavId}
            onSelect={onSelectNavItem}
            brand="zeiss"
            navLayout="physical-tabs"
            viewerPdfPage1={currentPage + 1}
          />
        </div>
      </div>
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

  /** 当前可见书的 ref（预览 / 全屏切换都从这里取） */
  const activeFlipRef = fullscreenOpen ? fsFlipRef : previewFlipRef;

  const syncCurrentPageFromEngine = useCallback(() => {
    try {
      const idx = activeFlipRef.current?.pageFlip?.()?.getCurrentPageIndex?.();
      if (Number.isFinite(idx)) setCurrentPage(idx as number);
    } catch {
      /* ignore */
    }
  }, [activeFlipRef]);

  const assignWindowPageFlipInstance = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const engine = activeFlipRef.current?.pageFlip?.();
      window.pageFlipInstance = engine as Window['pageFlipInstance'];
    } catch {
      window.pageFlipInstance = undefined;
    }
  }, [activeFlipRef]);

  useLayoutEffect(() => {
    assignWindowPageFlipInstance();
    return () => {
      if (typeof window !== 'undefined') window.pageFlipInstance = undefined;
    };
  }, [assignWindowPageFlipInstance, currentPage, fullscreenOpen]);

  const onBookInit = useCallback(() => {
    queueMicrotask(() => {
      assignWindowPageFlipInstance();
      syncCurrentPageFromEngine();
    });
  }, [assignWindowPageFlipInstance, syncCurrentPageFromEngine]);

  const onChangeState = useCallback(
    (e: { data?: unknown }) => {
      if (e?.data === 'flipping') playHandbookPaperRustle();
      if (e?.data === 'read') syncCurrentPageFromEngine();
    },
    [syncCurrentPageFromEngine],
  );

  const onFlip = useCallback(() => {
    syncCurrentPageFromEngine();
    assignWindowPageFlipInstance();
  }, [assignWindowPageFlipInstance, syncCurrentPageFromEngine]);

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

  /** Esc 关闭全屏 */
  useEffect(() => {
    if (!fullscreenOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenOpen]);

  /** 全屏时锁住 body 滚动 */
  useEffect(() => {
    if (!fullscreenOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenOpen]);

  if (total <= 0) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-white/70">
        蔡司手册页尚未就绪
      </div>
    );
  }

  /** 预览：嵌入内容区，垂直居中；右上角「全屏沉浸」 */
  const previewBlock = (
    <section className="relative w-full">
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

      <div className="relative h-[calc(100vh-220px)] min-h-[640px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black/45 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        {!fullscreenOpen ? (
          <HandbookPhysicsStage
            flipRef={previewFlipRef}
            pages={pages}
            seriesNav={seriesNav}
            activeNavId={activeNavId}
            currentPage={currentPage}
            onSelectNavItem={onSelectNavItem}
            onFlip={onFlip}
            onBookInit={onBookInit}
            onChangeState={onChangeState}
            fullscreen={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/55">
            沉浸阅读已开启 · 当前在全屏模式
          </div>
        )}
      </div>

      <p className="mt-2 text-center text-[10px] text-white/45">
        翻页时单击书角或拖拽；右侧物理标签可直接跳转到对应系列。
      </p>
    </section>
  );

  if (typeof window === 'undefined') {
    return previewBlock;
  }

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

              <div className="relative h-[min(96dvh,100%)] w-[min(98vw,1600px)]">
                <HandbookPhysicsStage
                  flipRef={fsFlipRef}
                  pages={pages}
                  seriesNav={seriesNav}
                  activeNavId={activeNavId}
                  currentPage={currentPage}
                  onSelectNavItem={onSelectNavItem}
                  onFlip={onFlip}
                  onBookInit={onBookInit}
                  onChangeState={onChangeState}
                  fullscreen={true}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
