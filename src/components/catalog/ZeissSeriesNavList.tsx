'use client';

/**
 * StandardEye 4.0：蔡司价目册右缘 rail（硬编码锚点 + 物理公式）；
 * 豪雅 rail 已迁至 {@link HoyaPhysicalTabRail}，本文件不再引用豪雅数据源。
 */

import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';
import { HoyaPhysicalTabRail } from '@/components/catalog/HoyaPhysicalTabRail';
import { useHandbookFlipRuntime } from '@/components/catalog/HandbookFlipRuntimeContext';
import { isHandbookPhysicalRailHostPage } from '@/lib/catalog/handbookPhysicalRailHostPage';

const ZEISS_BLUE = '#0066B3';

const NAV_SCROLL_STYLES =
  'zeiss-nav-scroll ' +
  '[scrollbar-width:thin] [scrollbar-gutter:stable] ' +
  '[scrollbar-color:rgba(0,30,50,0.25)_rgba(0,0,0,0.12)] ' +
  'hover:[scrollbar-color:rgba(0,59,100,0.5)_rgba(0,0,0,0.2)] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:bg-transparent ' +
  'hover:[&::-webkit-scrollbar]:bg-white/[0.04] ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/[0.08] ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#0066B3]/35';

type NavLayout = 'classic' | 'physical-tabs';

type Props = {
  items: readonly HandbookSeriesNavItem[];
  /** PageFlip 子页 0-based；`physical-tabs` 下须满足 {@link isHandbookPhysicalRailHostPage}（父级已门控，此为双重保险） */
  pageIndex: number;
  /** 未传时从 {@link useHandbookFlipRuntime} 读取（页内 rail，避免牵动 page-flip 子树） */
  activeId?: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  compact?: boolean;
  className?: string;
  useTwoColumn?: boolean;
  integrityWarnIds?: ReadonlySet<string>;
  activeNav?: HandbookActiveNavState | null;
  brand?: import('@/data/zeissHandbookPageMap').DigitalHandbookBrand;
  navLayout?: NavLayout;
  /** 未传时从 flip runtime context 读取 */
  viewerPdfPage1?: number;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

export function ZeissSeriesNavList({
  items,
  pageIndex,
  activeId,
  onSelect,
  compact = false,
  className = '',
  useTwoColumn: useTwoColProp = true,
  integrityWarnIds,
  activeNav,
  brand = 'zeiss',
  navLayout = 'physical-tabs',
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rt = useHandbookFlipRuntime();
  const activeNavEff = activeNav ?? rt.activeNav ?? null;
  const integrityWarnEff = integrityWarnIds ?? rt.integrityWarnNavIds;
  const activeIdEff =
    (typeof activeId === 'string' && activeId.length > 0 ? activeId : activeNavEff?.anchorId) ?? '';

  const useTwoColumn =
    navLayout === 'classic' && useTwoColProp && !compact && items.length > 6;

  useLayoutEffect(() => {
    if (navLayout === 'physical-tabs') return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeIdEff, items.length, activeNavEff?.anchorId, activeNavEff?.dataStatus, navLayout]);

  if (navLayout === 'physical-tabs') {
    /** 与 `ZeissDigitalHandbook` 父级 `mountPhysicalRailOnThisPage` 同式，防误挂时的最后一道闸 */
    if (!isHandbookPhysicalRailHostPage(pageIndex)) return null;

    if (brand === 'hoya') {
      return (
        <HoyaPhysicalTabRail
          ref={scrollRef}
          className="zeiss-series-nav-container"
          activeId={activeIdEff}
          onSelect={onSelect}
          integrityWarnIds={integrityWarnEff}
          activeNav={activeNavEff}
        />
      );
    }

    // 蔡司物理标签由 `ZeissDigitalHandbook` 自渲染（书右缘均分铺排）；本组件 zeiss 物理路径已退役。
    if (brand === 'zeiss') return null;

    return null;
  }

  return (
    <div
      ref={scrollRef}
      role="navigation"
      className={[
        'flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden',
        'rounded-xl bg-gradient-to-b from-white/[0.06] to-white/[0.02]',
        NAV_SCROLL_STYLES,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="系列快速跳转"
    >
      <div
        className={
          useTwoColumn
            ? 'grid grid-cols-2 content-start items-start gap-x-0.5 gap-y-0.5 pr-0.5'
            : 'flex flex-col gap-0.5 pr-0.5'
        }
      >
        {items.map((it) => {
          const active = it.id === activeIdEff;
          const wide = !shortLabel(it.label);
          const integrityWarn = Boolean(integrityWarnEff?.has(it.id));
          const anchorStatus =
            active && activeNavEff && it.id === activeNavEff.anchorId ? activeNavEff.dataStatus : undefined;
          const pendingMsg =
            active && activeNavEff && it.id === activeNavEff.anchorId && activeNavEff.dataStatus === 'warning'
              ? activeNavEff.placeholderMessage
              : '';
          const showDataPending = Boolean(pendingMsg);
          const titleParts = [
            integrityWarn ? '侧栏有此系列，但价目 JSON 中暂无同名 productName' : '',
            anchorStatus === 'validated' ? '价目锚点已通过数据完整性校验' : '',
            anchorStatus === 'warning' ? '当前锚点价目数据待补全' : '',
          ].filter(Boolean);
          return (
            <motion.button
              key={it.id}
              type="button"
              data-zeiss-nav-active={active ? 'true' : undefined}
              data-handbook-anchor-status={anchorStatus}
              title={titleParts.length ? titleParts.join(' · ') : undefined}
              onClick={() => onSelect(it)}
              layout
              initial={false}
              whileHover={{ x: -0.5 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
              className={[
                'group/btn relative w-full rounded-md text-left',
                'px-0.5 py-0.5 leading-tight',
                'border-l-[1px] border-l-transparent pl-1.5',
                useTwoColumn && wide ? 'col-span-2' : 'col-span-1',
                integrityWarn ? 'ring-1 ring-red-500/70 ring-inset' : '',
                active
                  ? 'border-l-[#0066B3]/0 bg-gradient-to-r from-[#0066B3]/18 to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                  : 'text-white/60 hover:border-l-white/15 hover:bg-white/[0.04] hover:text-white/88',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none absolute left-0 top-1/2 w-[2px] -translate-y-1/2 rounded-full',
                  'transition-all duration-200',
                  active
                    ? 'h-[64%] opacity-100 shadow-[0_0_10px_rgba(0,102,179,0.45)]'
                    : 'h-0 opacity-0',
                ].join(' ')}
                style={{ background: ZEISS_BLUE }}
                aria-hidden
              />
              <span className="line-clamp-3 pl-1 text-[14px] font-medium leading-snug tracking-tight text-white/90">
                {it.label}
              </span>
              {showDataPending ? (
                <span
                  role="status"
                  className="mt-1 block rounded-md border border-amber-500/40 bg-amber-950/35 px-1.5 py-1 pl-1 text-[10px] font-semibold leading-tight text-amber-100/95"
                >
                  {pendingMsg}
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export { ZeissSeriesNavList as ZeissHandbookNav };