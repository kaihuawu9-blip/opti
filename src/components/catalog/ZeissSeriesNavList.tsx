'use client';

import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';

/** 蔡司品牌蓝：系列激活指示与滚动条高亮 */
const ZEISS_BLUE = '#0066B3';

const NAV_SCROLL_STYLES =
  // thin + 深色轨；悬停时拇指略现（Firefox）
  'zeiss-nav-scroll ' +
  '[scrollbar-width:thin] [scrollbar-gutter:stable] ' +
  '[scrollbar-color:rgba(0,30,50,0.25)_rgba(0,0,0,0.12)] ' +
  'hover:[scrollbar-color:rgba(0,59,100,0.5)_rgba(0,0,0,0.2)] ' +
  // WebKit：极细、默认几乎隐藏，悬停时可见
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:bg-transparent ' +
  'hover:[&::-webkit-scrollbar]:bg-white/[0.04] ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/[0.08] ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#0066B3]/35';

type Props = {
  items: readonly HandbookSeriesNavItem[];
  activeId: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  /**
   * 紧凑区（预览条）：单栏更稳；全屏为 false 时允许短标题双列
   */
  compact?: boolean;
  /** 包裹层额外 class，通常由父级定高后传 h-full */
  className?: string;
  /** 短标题双列；系列较多时有效 */
  useTwoColumn?: boolean;
  /** Data-Integrity-Validator：侧栏项在矩阵 JSON 中缺 productName 时标红 */
  integrityWarnIds?: ReadonlySet<string>;
  /** AnchorID 反查 + dataStatus：当前激活项 warning 时展示「数据待补全」占位 */
  activeNav?: HandbookActiveNavState | null;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

/**
 * 右侧「系列」快速跳转：与 3D 书同高时由父级定高，本组件负责内部滚动、激活条与双列
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const useTwoColumn = useTwoColProp && !compact && items.length > 6;

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, items.length, activeNav?.anchorId, activeNav?.dataStatus]);

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
                // 相对上一版再减半：更密，智锐一屏可展示更多
                'px-0.5 py-0.5 leading-tight',
                'border-l-[1px] border-l-transparent pl-1.5',
                useTwoColumn && wide ? 'col-span-2' : 'col-span-1',
                integrityWarn ? 'ring-1 ring-red-500/70 ring-inset' : '',
                active
                  ? 'border-l-[#0066B3]/0 bg-gradient-to-r from-[#0066B3]/18 to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                  : 'text-white/60 hover:border-l-white/15 hover:bg-white/[0.04] hover:text-white/88',
              ].join(' ')}
            >
              {/* 蔡司蓝细长激活条 */}
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
