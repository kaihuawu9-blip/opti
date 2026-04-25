'use client';

/**
 * 豪雅价目册 · 右页物理横向书签（与蔡司 `ZeissSeriesNavList` 解耦，数据源 `buildHoyaSeriesNavigationItems`）。
 */
import { forwardRef, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import { buildHoyaSeriesNavigationItems, hoyaRailTopPercentForPdfPage } from '@/data/hoyaSeriesNav';
import type { HandbookNavTabTone, HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';
import { acquireHoyaBookmarkOverflowParents } from '@/components/catalog/hoyaBookmarkOverflowParents';

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

const PHYSICAL_EMBOSSED_FONT =
  "font-[SimHei,SimSun,'Noto_Sans_SC','Source_Han_Sans_SC',sans-serif] font-bold tabular-nums";

function resolvePhysicalTabFrost(
  tone: HandbookNavTabTone | undefined,
  active: boolean,
): { bg: string; text: string; borderLeft: string; boxShadow?: string } {
  const t = tone ?? 'neutral';
  const base = active ? 'rgba(30, 30, 30, 0.72)' : 'rgba(30, 30, 30, 0.6)';
  if (t === 'hoya-orange') {
    return {
      bg: base,
      text: 'text-white/92',
      borderLeft: active ? '3px solid rgba(224, 90, 32, 0.7)' : '1px solid rgba(194, 65, 12, 0.35)',
      boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.06)' : undefined,
    };
  }
  if (t === 'hoya-blue') {
    return {
      bg: base,
      text: 'text-white/92',
      borderLeft: active ? '3px solid rgba(14, 140, 200, 0.65)' : '1px solid rgba(3, 105, 161, 0.35)',
      boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.06)' : undefined,
    };
  }
  if (t === 'hoya-purple') {
    return {
      bg: base,
      text: 'text-white/92',
      borderLeft: active ? '3px solid rgba(139, 92, 246, 0.55)' : '1px solid rgba(109, 40, 217, 0.32)',
      boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.06)' : undefined,
    };
  }
  return {
    bg: base,
    text: active ? 'text-white' : 'text-white/85',
    borderLeft: active ? '3px solid rgba(148, 163, 184, 0.45)' : '1px solid rgba(255,255,255,0.12)',
    boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.05)' : undefined,
  };
}

export type HoyaPhysicalTabRailProps = {
  activeId: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  integrityWarnIds?: ReadonlySet<string>;
  activeNav?: HandbookActiveNavState | null;
  /** 与蔡司 rail 共用 `page-flip.css` 中 `.zeiss-series-nav-container` 物理槽样式 */
  className?: string;
};

export const HoyaPhysicalTabRail = forwardRef<HTMLDivElement, HoyaPhysicalTabRailProps>(
  function HoyaPhysicalTabRail({ activeId, onSelect, integrityWarnIds, activeNav, className = '' }, ref) {
    const innerRef = useRef<HTMLDivElement | null>(null);
    const setRef = (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref && 'current' in ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
    };

    const vvScale = useVisualViewportScale();
    const [pageBoxH, setPageBoxH] = useState(0);
    const physicalItems = buildHoyaSeriesNavigationItems();

    useLayoutEffect(() => {
      const nav = innerRef.current;
      if (!nav) return;
      const releaseOverflow = acquireHoyaBookmarkOverflowParents(nav);
      return () => releaseOverflow();
    }, [activeId]);

    useLayoutEffect(() => {
      const nav = innerRef.current;
      const box = nav?.offsetParent as HTMLElement | null | undefined;
      if (!box) return;
      const ro = new ResizeObserver((entries) => {
        const h = entries[0]?.contentRect?.height ?? 0;
        const rounded = Math.round(h);
        if (rounded > 0) setPageBoxH(rounded);
      });
      ro.observe(box);
      const h0 = Math.round(box.getBoundingClientRect().height);
      if (h0 > 0) queueMicrotask(() => setPageBoxH(h0));
      return () => ro.disconnect();
    }, [activeId]);

    const hoyaNavFontPx =
      pageBoxH > 0 ? Math.max(10, Math.min(16, Math.round(pageBoxH * 0.021))) : undefined;

    return (
      <nav
        ref={setRef}
        role="navigation"
        aria-label="系列索引（物理标签）"
        data-handbook-series-nav="1"
        className={['pointer-events-none h-full min-h-0', className].filter(Boolean).join(' ')}
        style={{
          position: 'absolute',
          right: -30 * vvScale,
          top: 0,
          bottom: 0,
          width: 'min(10rem, 46%)',
          zIndex: 50,
          ...(hoyaNavFontPx ? { fontSize: `${hoyaNavFontPx}px` } : { fontSize: '12px' }),
        }}
      >
        {physicalItems.map((it) => {
          const topCss = `${hoyaRailTopPercentForPdfPage(it.startPage0 + 1)}%`;
          const tabText = (it.physicalTabLabel?.trim() || it.label).trim() || it.id;
          const active = it.id === activeId;
          const integrityWarn = Boolean(integrityWarnIds?.has(it.id));
          const frost = resolvePhysicalTabFrost(it.navTabTone, active);
          const anchorStatus =
            active && activeNav && it.id === activeNav.anchorId ? activeNav.dataStatus : undefined;
          const titleParts = [integrityWarn ? '数据完整性提示' : ''].filter(Boolean);
          return (
            <button
              key={it.id}
              type="button"
              data-zeiss-nav-active={active ? 'true' : undefined}
              data-handbook-anchor-status={anchorStatus}
              title={titleParts.length ? titleParts.join(' · ') : undefined}
              onClick={() => onSelect(it)}
              className={[
                'box-border m-0 flex cursor-pointer items-center justify-end whitespace-nowrap border-y border-r-0 border-white/[0.08] py-[0.35em] pl-[0.55em] pr-2 text-left',
                'rounded-l-xl rounded-r-none shadow-[-5px_2px_14px_rgba(0,0,0,0.32)]',
                frost.text,
                integrityWarn ? 'outline outline-1 outline-red-500/80 -outline-offset-1' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                position: 'absolute',
                right: 0,
                top: topCss,
                width: 'max-content',
                maxWidth: '100%',
                backgroundColor: frost.bg,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderLeft: frost.borderLeft,
                boxShadow: frost.boxShadow,
                zIndex: 10,
                maxHeight: '2.4em',
              }}
            >
              <span
                className={[
                  PHYSICAL_EMBOSSED_FONT,
                  'box-border block text-right text-[0.85em] leading-tight tracking-wide',
                ].join(' ')}
              >
                {tabText}
              </span>
            </button>
          );
        })}
      </nav>
    );
  },
);
