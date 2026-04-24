'use client';

/** StandardEye V1.3：手册物理导航；豪雅为右页横向书签（方案 B：负 right + overflow 解锁 + 视口/页盒缩放同步）。 */

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { buildHoyaSeriesNavigationItems, hoyaRailTopPercentForPdfPage } from '@/data/hoyaSeriesNav';
import type {
  DigitalHandbookBrand,
  HandbookNavTabTone,
  HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';
import { acquireHoyaBookmarkOverflowParents } from '@/components/catalog/hoyaBookmarkOverflowParents';

const ZEISS_BLUE = '#0066B3';

function subscribeVisualViewportScale(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener('resize', cb);
  vv.addEventListener('scroll', cb);
  return () => {
    vv.removeEventListener('resize', cb);
    vv.removeEventListener('scroll', cb);
  };
}

function getVisualViewportScale(): number {
  if (typeof window === 'undefined') return 1;
  const s = window.visualViewport?.scale;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1;
}

function useVisualViewportScale(): number {
  return useSyncExternalStore(subscribeVisualViewportScale, getVisualViewportScale, () => 1);
}

/** 竖排凸标：偏宋黑 / 黑体，略紧字距，接近实物印刷 */
const PHYSICAL_EMBOSSED_FONT =
  "font-[SimHei,SimSun,'Noto_Sans_SC','Source_Han_Sans_SC',sans-serif] font-bold tabular-nums";

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
  brand?: DigitalHandbookBrand;
  navLayout?: NavLayout;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

/** 扁平实色，与 PDF 色块一致；无阴影、无渐变。 */
function resolvePhysicalTabSurface(
  brand: DigitalHandbookBrand,
  tone: HandbookNavTabTone | undefined,
  active: boolean,
): { bg: string; text: string } {
  const t = tone ?? (brand === 'zeiss' ? 'zeiss-deep-blue' : 'neutral');
  if (brand === 'zeiss' || t === 'zeiss-deep-blue') {
    return active
      ? { bg: '#003D78', text: 'text-white' }
      : { bg: '#002A48', text: 'text-white/88' };
  }
  if (t === 'hoya-orange') {
    return active
      ? { bg: '#B0380C', text: 'text-white' }
      : { bg: '#8B2E0E', text: 'text-white/90' };
  }
  if (t === 'hoya-blue') {
    return active
      ? { bg: '#055F94', text: 'text-white' }
      : { bg: '#085985', text: 'text-white/90' };
  }
  if (t === 'hoya-purple') {
    return active
      ? { bg: '#5E21A8', text: 'text-white' }
      : { bg: '#4C1D8F', text: 'text-white/90' };
  }
  return active
    ? { bg: '#374151', text: 'text-white' }
    : { bg: '#2A3341', text: 'text-white/80' };
}

/**
 * physical-tabs：豪雅为右缘横向书签，`top` 由 `hoyaRailTopPercentForPdfPage`（相对页容器高度，顶边对齐）；
 * 蔡司为竖排凸标 + `vOffsetPercent`；classic 为栅格列表（依视路）。
 */
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

  const vvScale = useVisualViewportScale();
  const [pageBoxH, setPageBoxH] = useState(0);

  useLayoutEffect(() => {
    if (navLayout !== 'physical-tabs' || brand !== 'hoya') return;
    const nav = scrollRef.current;
    if (!nav) return;
    const releaseOverflow = acquireHoyaBookmarkOverflowParents(nav);
    return () => releaseOverflow();
  }, [brand, navLayout, activeId]);

  useLayoutEffect(() => {
    if (navLayout !== 'physical-tabs' || brand !== 'hoya') return;
    const nav = scrollRef.current;
    const box = nav?.offsetParent as HTMLElement | null | undefined;
    if (!box) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height ?? 0;
      const rounded = Math.round(h);
      if (rounded > 0) setPageBoxH(rounded);
    });
    ro.observe(box);
    const h0 = Math.round(box.getBoundingClientRect().height);
    if (h0 > 0) setPageBoxH(h0);
    return () => ro.disconnect();
  }, [brand, navLayout, activeId]);

  useLayoutEffect(() => {
    if (navLayout === 'physical-tabs') return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, items.length, activeNav?.anchorId, activeNav?.dataStatus, navLayout]);

  if (navLayout === 'physical-tabs') {
    /** 豪雅：与 `HOYA_PHYSICAL_PAGE_ANCHORS` 全量同源，禁止依赖外层对 `items` 的裁剪。 */
    const physicalItems = brand === 'hoya' ? buildHoyaSeriesNavigationItems() : items;

    const hoyaNavFontPx =
      brand === 'hoya' && pageBoxH > 0
        ? Math.max(10, Math.min(16, Math.round(pageBoxH * 0.021)))
        : undefined;

    return (
      <nav
        ref={scrollRef}
        role="navigation"
        aria-label="系列索引（物理标签）"
        className="pointer-events-none h-full min-h-0"
        style={{
          position: 'absolute',
          right: brand === 'hoya' ? -30 * vvScale : 0,
          top: 0,
          bottom: 0,
          width: brand === 'hoya' ? 'min(10rem, 46%)' : 50,
          zIndex: 50,
          ...(brand === 'hoya' && hoyaNavFontPx
            ? { fontSize: `${hoyaNavFontPx}px` }
            : brand === 'hoya'
              ? { fontSize: '12px' }
              : {}),
        }}
      >
        {physicalItems.map((it) => {
          const topCss =
            brand === 'hoya'
              ? `${hoyaRailTopPercentForPdfPage(it.startPage0 + 1)}%`
              : typeof it.vOffsetPercent === 'number' && Number.isFinite(it.vOffsetPercent)
                ? `${it.vOffsetPercent}%`
                : '';
          if (!topCss) return null;

          const tabText = (it.physicalTabLabel?.trim() || it.label).trim() || it.id;
          const active = it.id === activeId;
          const integrityWarn = Boolean(integrityWarnIds?.has(it.id));
          const surf = resolvePhysicalTabSurface(brand, it.navTabTone, active);
          const anchorStatus =
            active && activeNav && it.id === activeNav.anchorId ? activeNav.dataStatus : undefined;
          const titleParts = [integrityWarn ? '数据完整性提示' : ''].filter(Boolean);
          const isHoyaRail = brand === 'hoya';
          return (
            <button
              key={it.id}
              type="button"
              data-zeiss-nav-active={active ? 'true' : undefined}
              data-handbook-anchor-status={anchorStatus}
              title={titleParts.length ? titleParts.join(' · ') : undefined}
              onClick={() => onSelect(it)}
              className={[
                'box-border cursor-pointer text-left pointer-events-auto',
                isHoyaRail
                  ? [
                      'm-0 flex items-center justify-end border border-r-0 border-black/30 pr-2',
                      'rounded-l-xl rounded-r-none',
                      'py-[0.35em] pl-[0.55em]',
                      'shadow-[-5px_2px_14px_rgba(0,0,0,0.32)]',
                      'whitespace-nowrap',
                    ].join(' ')
                  : 'rounded-[1px] rounded-r-none border border-black/25 border-r-0 px-0.5 py-1.5',
                surf.text,
                !isHoyaRail && integrityWarn ? 'outline outline-1 outline-red-500/80 -outline-offset-1' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                position: 'absolute',
                right: 0,
                top: topCss,
                width: isHoyaRail ? 'max-content' : '100%',
                maxWidth: isHoyaRail ? '100%' : undefined,
                background: surf.bg,
                zIndex: 10,
                ...(isHoyaRail
                  ? { maxHeight: '2.4em' }
                  : { margin: 0, minHeight: 44 }),
              }}
            >
              <span
                className={[
                  PHYSICAL_EMBOSSED_FONT,
                  isHoyaRail
                    ? 'box-border block text-right text-[0.85em] leading-tight tracking-wide'
                    : 'box-border block text-center text-[12px] leading-[1.75] tracking-[0.18em] [writing-mode:vertical-rl] [text-orientation:mixed]',
                  compact && !isHoyaRail ? 'text-[11px] tracking-[0.16em]' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {tabText}
              </span>
            </button>
          );
        })}
      </nav>
    );
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
