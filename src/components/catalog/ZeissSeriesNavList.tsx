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

const ZEISS_BLUE = '#0066B3';

/** 蔡司价目册物理纵轴基准页数（与公式分母一致） */
const ZEISS_PHYSICS_REF_PAGES = 82;

/**
 * 蔡司右缘 rail 锚点（秒开展示用，谨慎：页表 `series_entry` 补全后应以此处为冗余逐步收敛）。
 */
const ZEISS_PRESTIGE_TABS = [
  { name: '智锐系列', page: 10 },
  { name: '青少年', page: 25 },
  { name: '单光系列', page: 33 },
  { name: '渐进系列', page: 44 },
  { name: '数码型', page: 53 },
  { name: '驾驶型', page: 56 },
  { name: '户外镜片', page: 60 },
  { name: '健康消费品', page: 80 },
] as const;

/** 微梯形 + 左圆角右直边观感（clip + 左圆角） */
const ZEISS_PHYSICAL_TAB_CLIP = 'polygon(0% 2%, 100% 10%, 100% 90%, 0% 98%)';

const ZEISS_RAIL_TAB_W = 45;
const ZEISS_RAIL_TAB_W_ACTIVE = ZEISS_RAIL_TAB_W + 10;

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
  activeId: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  compact?: boolean;
  className?: string;
  useTwoColumn?: boolean;
  integrityWarnIds?: ReadonlySet<string>;
  activeNav?: HandbookActiveNavState | null;
  brand?: import('@/data/zeissHandbookPageMap').DigitalHandbookBrand;
  navLayout?: NavLayout;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

function zeissPrestigeTabToNavItem(tab: (typeof ZEISS_PRESTIGE_TABS)[number]): HandbookSeriesNavItem {
  const p = tab.page;
  return {
    id: `tab:${p}`,
    label: tab.name,
    section: 'price',
    startPage0: p - 1,
    printedPage: null,
    physicalTabVerified: false,
    physicalTabLabel: tab.name,
    navTabTone: 'zeiss-deep-blue',
  };
}

export function ZeissSeriesNavList({
  items,
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
  const useTwoColumn =
    navLayout === 'classic' && useTwoColProp && !compact && items.length > 6;

  useLayoutEffect(() => {
    if (navLayout === 'physical-tabs') return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, items.length, activeNav?.anchorId, activeNav?.dataStatus, navLayout]);

  if (navLayout === 'physical-tabs') {
    if (brand === 'hoya') {
      return (
        <HoyaPhysicalTabRail
          ref={scrollRef}
          activeId={activeId}
          onSelect={onSelect}
          integrityWarnIds={integrityWarnIds}
          activeNav={activeNav}
        />
      );
    }

    if (brand === 'zeiss') {
      console.log('Tabs rendered', ZEISS_PRESTIGE_TABS);

      return (
        <nav
          ref={scrollRef}
          role="navigation"
          aria-label="系列索引（物理标签）"
          className="pointer-events-none absolute right-0 top-0 h-full w-[56px] overflow-visible [transform:translateZ(0)] will-change-transform !z-[9999]"
        >
          {ZEISS_PRESTIGE_TABS.map((tab) => {
            const topCss = `${(tab.page / ZEISS_PHYSICS_REF_PAGES) * 100}%`;
            const navItem = zeissPrestigeTabToNavItem(tab);
            const active = activeId === navItem.id;
            const integrityWarn = Boolean(integrityWarnIds?.has(navItem.id));
            const anchorStatus =
              active && activeNav && navItem.id === activeNav.anchorId ? activeNav.dataStatus : undefined;
            const titleParts = [integrityWarn ? '数据完整性提示' : ''].filter(Boolean);
            const w = active ? ZEISS_RAIL_TAB_W_ACTIVE : ZEISS_RAIL_TAB_W;

            return (
              <button
                key={navItem.id}
                type="button"
                data-zeiss-nav-active={active ? 'true' : undefined}
                data-handbook-anchor-status={anchorStatus}
                title={titleParts.length ? titleParts.join(' · ') : undefined}
                onClick={() => onSelect(navItem)}
                className={[
                  'box-border cursor-pointer border-0 bg-transparent p-0 text-left',
                  'pointer-events-auto absolute',
                  'transition-[width] duration-200 ease-out',
                  integrityWarn ? 'outline outline-1 outline-red-500/80 -outline-offset-1' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  top: topCss,
                  right: -45,
                  width: w,
                  minHeight: 36,
                  transform: 'translateZ(0)',
                  zIndex: 10,
                }}
              >
                <div
                  className="relative flex h-full min-h-9 w-full items-center overflow-hidden rounded-l-md rounded-r-none pl-1.5 pr-1.5"
                  style={{
                    clipPath: ZEISS_PHYSICAL_TAB_CLIP,
                    WebkitClipPath: ZEISS_PHYSICAL_TAB_CLIP,
                    borderLeft: `2px solid ${ZEISS_BLUE}`,
                    backgroundColor: active ? ZEISS_BLUE : 'rgba(20, 20, 20, 0.8)',
                    backdropFilter: active ? 'blur(6px)' : 'blur(12px)',
                    WebkitBackdropFilter: active ? 'blur(6px)' : 'blur(12px)',
                    boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.16)' : undefined,
                  }}
                >
                  {active ? <div className="zeiss-physical-tab-active-shine" aria-hidden /> : null}
                  <span
                    className={[
                      "relative z-[1] block w-full truncate text-left text-[11px] font-medium leading-tight tracking-tight text-white [font-family:SimHei,SimSun,'Noto_Sans_SC','Source_Han_Sans_SC',sans-serif]",
                      'tabular-nums',
                    ].join(' ')}
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
                  >
                    {tab.name}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>
      );
    }

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
          const active = it.id === activeId;
          const wide = !shortLabel(it.label);
          const integrityWarn = Boolean(integrityWarnIds?.has(it.id));
          const anchorStatus =
            active && activeNav && it.id === activeNav.anchorId ? activeNav.dataStatus : undefined;
          const pendingMsg =
            active && activeNav && it.id === activeNav.anchorId && activeNav.dataStatus === 'warning'
              ? activeNav.placeholderMessage
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
