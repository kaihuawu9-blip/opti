'use client';

import type { HandbookNavTabTone, HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';

/**
 * 右侧固定竖向导航（极简）：独立列，高度与书同高；每个标签 `position: absolute; top: vOffsetPercent%`。
 * - 不随 3D 翻页联动；只是「视觉对齐 PDF 色块 + 点击 flipTo」。
 * - 书本容器仍可 `overflow: hidden`，本列完全脱离书盒。
 */

export type PhysicalTabColumnItem = {
  id: string;
  label: string;
  vOffsetPercent: number;
  startPage0: number;
  navTabTone?: HandbookNavTabTone;
};

const TONE_CLASS: Record<HandbookNavTabTone, { bg: string; ring: string; dot: string }> = {
  'hoya-orange': {
    bg: 'bg-orange-500/35 hover:bg-orange-500/50',
    ring: 'ring-orange-300/70',
    dot: 'bg-orange-300',
  },
  'hoya-blue': {
    bg: 'bg-sky-600/35 hover:bg-sky-600/50',
    ring: 'ring-sky-300/70',
    dot: 'bg-sky-300',
  },
  'hoya-purple': {
    bg: 'bg-violet-600/35 hover:bg-violet-600/50',
    ring: 'ring-violet-300/70',
    dot: 'bg-violet-300',
  },
  'zeiss-deep-blue': {
    bg: 'bg-[#0059A3]/35 hover:bg-[#0059A3]/55',
    ring: 'ring-sky-200/70',
    dot: 'bg-sky-200',
  },
  neutral: {
    bg: 'bg-slate-500/30 hover:bg-slate-500/45',
    ring: 'ring-slate-200/60',
    dot: 'bg-slate-200',
  },
};

export function buildPhysicalTabColumnItems(
  items: readonly HandbookSeriesNavItem[],
): PhysicalTabColumnItem[] {
  const out: PhysicalTabColumnItem[] = [];
  for (const it of items) {
    if (it.physicalTabVerified !== true) continue;
    const label = (it.physicalTabLabel ?? '').trim();
    if (!label) continue;
    const v = typeof it.vOffsetPercent === 'number' && Number.isFinite(it.vOffsetPercent)
      ? it.vOffsetPercent
      : 50;
    out.push({
      id: it.id,
      label,
      vOffsetPercent: v,
      startPage0: it.startPage0,
      navTabTone: it.navTabTone,
    });
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function HandbookPhysicalTabColumn({
  items,
  activeStartPage0,
  heightCss,
  onSelect,
  widthPx = 44,
}: {
  items: readonly PhysicalTabColumnItem[];
  /** 当前翻到的页（0-based）；双页时可传左页，或你关心的任一页 */
  activeStartPage0: number | null;
  /** 书本高度 CSS（通常 `${dims.h}px` 或 `${fsDims.pageH}px`） */
  heightCss: string;
  onSelect: (item: PhysicalTabColumnItem) => void;
  widthPx?: number;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="relative shrink-0 self-stretch"
      style={{ width: widthPx, height: heightCss }}
      aria-label="系列快捷跳转"
      role="navigation"
    >
      {items.map((it) => {
        const active = activeStartPage0 != null && it.startPage0 === activeStartPage0;
        const tone = TONE_CLASS[it.navTabTone ?? 'neutral'] ?? TONE_CLASS.neutral;
        const topPct = clamp(it.vOffsetPercent, 1, 99);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it)}
            aria-label={it.label}
            title={it.label}
            aria-current={active ? 'page' : undefined}
            className={[
              'absolute left-0 flex -translate-y-1/2 select-none items-center gap-1 rounded-l-md border border-white/10 px-1.5 text-white/95 shadow-[0_3px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-200',
              tone.bg,
              active ? `ring-1 ${tone.ring} w-[calc(100%+4px)] -ml-1` : 'w-full',
            ].join(' ')}
            style={{
              top: `${topPct}%`,
              height: active ? 34 : 28,
            }}
          >
            {active ? (
              <span
                aria-hidden
                className={['h-1.5 w-1.5 shrink-0 rounded-full', tone.dot].join(' ')}
              />
            ) : null}
            <span
              className="min-w-0 flex-1 truncate text-center text-[10px] font-medium tracking-[0.1em]"
              style={{ textShadow: '0 1px 1px rgba(0,0,0,0.45)' }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
