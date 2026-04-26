'use client';

/**
 * 工业级静态规约：壳无 blur/外阴影；激活态为左侧 3px #005AAA 实线 + 浅底 #F5F8FF（低透明度），禁止 scale 缩小选中感。
 * 高亮由 {@link getZeissHandbookMapActiveId} 双页修正后决定，随 `onFlip` 的页码更新。
 */

import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { getZeissHandbookMapActiveId, ZEISS_HANDBOOK_MAP } from '@/data/zeissHandbookQuickMap';

const ZEISS_RAIL_SHELF: CSSProperties = {
  backgroundColor: 'rgb(15 23 42 / 0.95)',
};

type Props = {
  currentPageIndex0: number;
  /** 总页数；与引擎页数一致，供双页展平后区间判定 */
  pageCount: number;
  className?: string;
};

export function ZeissHandbookShortcutRail({ currentPageIndex0, pageCount, className = '' }: Props) {
  const activeId = useMemo(
    () => getZeissHandbookMapActiveId(currentPageIndex0, pageCount),
    [currentPageIndex0, pageCount],
  );

  const handleClick = (e: MouseEvent<HTMLButtonElement>, pdfPage1: number) => {
    e.preventDefault();
    e.stopPropagation();
    const target0 = Math.max(0, pdfPage1 - 1);
    if (typeof window === 'undefined') return;
    try {
      window.pageFlipInstance?.flip(target0, 'top');
    } catch {
      /* ignore */
    }
  };

  return (
    <nav
      aria-label="蔡司价目手册章节快捷"
      style={ZEISS_RAIL_SHELF}
      className={[
        'relative flex h-full w-full flex-col overflow-hidden',
        'rounded-r-md',
        'border-l border-white/20 border-r border-white/5',
        'divide-y divide-white/10',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {ZEISS_HANDBOOK_MAP.map((it) => {
        const active = it.id === activeId;
        return (
          <button
            key={it.id}
            type="button"
            onClick={(e) => handleClick(e, it.page)}
            data-active={active || undefined}
            aria-current={active || undefined}
            aria-label={`${it.label}（第 ${it.page} 页）`}
            title={`${it.label} · P${it.page}`}
            className={[
              'relative flex min-h-0 min-w-0 flex-1 select-none items-center justify-center overflow-hidden px-0',
              active ? 'bg-[#F5F8FF]/[0.14]' : 'bg-transparent',
            ].join(' ')}
          >
            <span
              aria-hidden
              className={[
                'pointer-events-none absolute left-0 top-[11%] z-[2] h-[78%] w-[3px] rounded-none',
                active ? 'bg-[#005AAA] opacity-100' : 'opacity-0',
              ].join(' ')}
            />
            <span className="relative z-[1] w-full min-w-0 pl-1 text-center text-[11px] font-medium leading-tight text-white">
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
