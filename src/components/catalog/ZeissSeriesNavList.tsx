'use client';

/** StandardEye V1.3：物理凸标侧栏孪生 UI；点击仅 `startPage0`，无智能跳转。 */

import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type {
  DigitalHandbookBrand,
  HandbookNavTabTone,
  HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';

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
  activeId: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  compact?: boolean;
  className?: string;
  useTwoColumn?: boolean;
  integrityWarnIds?: ReadonlySet<string>;
  activeNav?: HandbookActiveNavState | null;
  /** 凸出标签配色策略 */
  brand?: DigitalHandbookBrand;
  /** `physical-tabs`：模拟实体手册右侧凸出索引签 */
  navLayout?: NavLayout;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

function resolvePhysicalTabSurface(
  brand: DigitalHandbookBrand,
  tone: HandbookNavTabTone | undefined,
  active: boolean,
): { bg: string; text: string; shadow: string } {
  const t = tone ?? (brand === 'zeiss' ? 'zeiss-deep-blue' : 'neutral');
  if (brand === 'zeiss' || t === 'zeiss-deep-blue') {
    return active
      ? {
          bg: 'linear-gradient(180deg,#004a8c 0%,#003566 100%)',
          text: 'text-white',
          shadow: '4px 0 18px rgba(0,0,0,0.35)',
        }
      : {
          bg: 'linear-gradient(180deg,#003056 0%,#002040 100%)',
          text: 'text-white/88',
          shadow: '3px 0 12px rgba(0,0,0,0.28)',
        };
  }
  if (t === 'hoya-orange') {
    return active
      ? {
          bg: 'linear-gradient(180deg,#c2410c 0%,#9a3412 100%)',
          text: 'text-white',
          shadow: '4px 0 18px rgba(0,0,0,0.32)',
        }
      : {
          bg: 'linear-gradient(180deg,#9a3412 0%,#7c2d12 100%)',
          text: 'text-white/90',
          shadow: '3px 0 12px rgba(0,0,0,0.26)',
        };
  }
  if (t === 'hoya-blue') {
    return active
      ? {
          bg: 'linear-gradient(180deg,#0369a1 0%,#075985 100%)',
          text: 'text-white',
          shadow: '4px 0 18px rgba(0,0,0,0.32)',
        }
      : {
          bg: 'linear-gradient(180deg,#075985 0%,#0c4a6e 100%)',
          text: 'text-white/90',
          shadow: '3px 0 12px rgba(0,0,0,0.26)',
        };
  }
  if (t === 'hoya-purple') {
    return active
      ? {
          bg: 'linear-gradient(180deg,#6d28d9 0%,#5b21b6 100%)',
          text: 'text-white',
          shadow: '4px 0 18px rgba(0,0,0,0.32)',
        }
      : {
          bg: 'linear-gradient(180deg,#5b21b6 0%,#4c1d95 100%)',
          text: 'text-white/90',
          shadow: '3px 0 12px rgba(0,0,0,0.26)',
        };
  }
  return active
    ? {
        bg: 'linear-gradient(180deg,rgba(55,65,81,0.95) 0%,rgba(30,41,59,0.98) 100%)',
        text: 'text-white',
        shadow: '4px 0 14px rgba(0,0,0,0.28)',
      }
    : {
        bg: 'linear-gradient(180deg,rgba(40,48,64,0.9) 0%,rgba(24,32,48,0.95) 100%)',
        text: 'text-white/80',
        shadow: '2px 0 10px rgba(0,0,0,0.22)',
      };
}

/**
 * 右侧「系列」快速跳转：实体手册仿真为凸出标签（`physical-tabs`），经典模式保留原双列栅格。
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

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, items.length, activeNav?.anchorId, activeNav?.dataStatus]);

  if (navLayout === 'physical-tabs') {
    return (
      <div
        ref={scrollRef}
        role="navigation"
        className={[
          'flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden pl-1.5',
          'rounded-xl bg-gradient-to-b from-white/[0.05] to-transparent',
          NAV_SCROLL_STYLES,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="系列索引（物理标签）"
      >
        <div className="flex flex-col gap-1 pr-0.5 pt-0.5">
          {items.map((it) => {
            const active = it.id === activeId;
            const integrityWarn = Boolean(integrityWarnIds?.has(it.id));
            const surf = resolvePhysicalTabSurface(brand, it.navTabTone, active);
            const anchorStatus =
              active && activeNav && it.id === activeNav.anchorId ? activeNav.dataStatus : undefined;
            const pendingMsg =
              active && activeNav && it.id === activeNav.anchorId && activeNav.dataStatus === 'warning'
                ? activeNav.placeholderMessage
                : '';
            const showDataPending = Boolean(pendingMsg);
            const titleParts = [
              integrityWarn ? '数据完整性提示' : '',
              anchorStatus === 'validated' ? '物理索引签已校验' : '',
              anchorStatus === 'warning' ? '当前锚点数据待补全' : '',
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
                whileHover={{ x: -2 }}
                whileTap={{ scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className={[
                  'group/tab relative z-0 ml-auto flex w-[min(100%,2.75rem)] min-w-[2.5rem] flex-col items-center rounded-l-xl rounded-r-none border-y border-l py-2.5',
                  'border-r-0 px-1',
                  surf.text,
                  integrityWarn ? 'ring-1 ring-red-500/70 ring-inset' : '',
                  active ? 'z-10 scale-[1.02]' : 'z-0',
                ].join(' ')}
                style={{
                  background: surf.bg,
                  borderColor: 'rgba(255,255,255,0.12)',
                  boxShadow: surf.shadow,
                }}
              >
                <span
                  className={[
                    'pointer-events-none absolute right-0 top-1/2 hidden h-[72%] w-px -translate-y-1/2 sm:block',
                    active ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                  style={{ background: ZEISS_BLUE, opacity: active ? 0.35 : 0 }}
                  aria-hidden
                />
                <span
                  className={[
                    'flex min-h-[3.25rem] max-h-[11rem] items-center justify-center text-center text-[12px] font-semibold leading-tight tracking-wide [writing-mode:vertical-rl] [text-orientation:mixed]',
                    compact ? 'text-[11px]' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {it.label}
                </span>
                {it.printedPage != null ? (
                  <span
                    className={[
                      'mt-1 block text-[9px] tabular-nums [writing-mode:horizontal-tb]',
                      active ? 'opacity-50' : 'opacity-40',
                    ].join(' ')}
                  >
                    P{it.printedPage}
                  </span>
                ) : null}
                {showDataPending ? (
                  <span
                    role="status"
                    className="mt-1 block rounded-md border border-amber-500/40 bg-amber-950/35 px-1.5 py-1 text-[10px] font-semibold leading-tight text-amber-100/95"
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
              {it.printedPage != null ? (
                <span
                  className={[
                    'mt-0.5 block pl-1 text-[10px] tabular-nums',
                    active ? 'text-white/32' : 'text-white/22',
                  ].join(' ')}
                >
                  印 P{it.printedPage}
                </span>
              ) : null}
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
