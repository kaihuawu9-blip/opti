'use client';

/**
 * ZeissHandbookShortcutRail —— 蔡司价目册章节快捷栏
 *
 * 设计意图
 * ────────────────────────────────────────────────────────────────────────────
 * - 作为 `BookStage`（书槽）的**直接子元素**，用 `position:absolute; left:100%`
 *   贴合书右缘；位于 `ScaledBlock` 内部 → 与书页同频缩放，无位移偏差。
 * - 数据源：硬编码章节快捷表（{@link ZEISS_HANDBOOK_MAP}），并非 StandardEye
 *   `physicalTabVerified` 凸标；故避开 `ZeissSeriesNavList` 的物理凸标真值检查路径。
 * - Active 联动：父级把 `currentPageIndex0` 传进来；本组件 useMemo 推断 activeId。
 * - 跳转：`onClick` → `window.pageFlipInstance?.flip(targetPage0, 'top')`。
 *
 * 视觉规约
 * ────────────────────────────────────────────────────────────────────────────
 * - 9 条目通过 `flex-1` 等高平分书页高度，工业对齐感。
 * - 蔡司深色：`from-[#0a1622] via-[#0c1928] to-[#04080d]` + 内凹高光阴影。
 * - 激活态：左缘 3px 蓝色竖向高光条 + 横向蓝色淡渐变背景。
 * - Hover：左缘竖条 28% 高 30% 透明（提示可点）+ 文字提亮。
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ZEISS_HANDBOOK_MAP } from '@/data/zeissHandbookQuickMap';

const ZEISS_BLUE = '#0066B3';

type Props = {
  /** 当前 0-based 页下标（来自 react-pageflip onFlip） */
  currentPageIndex0: number;
  /** 自定义点击回调；未传时回退到 `window.pageFlipInstance.flip()` */
  onJump?: (pageIndex0: number) => void;
  className?: string;
};

export function ZeissHandbookShortcutRail({
  currentPageIndex0,
  onJump,
  className = '',
}: Props) {
  /**
   * 累积命中：取最后一个 `page-1 ≤ currentPageIndex0` 的项作为激活项。
   * （书翻到 13 页时仍属于「智锐 P10」段，符合 PDF 章节范围语义。）
   */
  const activeId = useMemo(() => {
    let id: string | null = null;
    for (const it of ZEISS_HANDBOOK_MAP) {
      if (it.page - 1 <= currentPageIndex0) id = it.id;
    }
    return id;
  }, [currentPageIndex0]);

  const handleClick = (pdfPage1: number) => {
    const target0 = Math.max(0, pdfPage1 - 1);
    if (onJump) {
      onJump(target0);
      return;
    }
    try {
      window.pageFlipInstance?.flip(target0, 'top');
    } catch {
      /* ignore */
    }
  };

  return (
    <nav
      aria-label="蔡司价目手册章节快捷"
      className={[
        'relative flex h-full w-full flex-col overflow-hidden',
        'rounded-r-md',
        // 蔡司深色质感
        'border-l border-white/[0.18]',
        'bg-gradient-to-b from-[#0a1622]/96 via-[#0c1928]/92 to-[#04080d]/96',
        // 内凹高光（顶 1px 白光 + 右侧深阴影内陷）
        'shadow-[inset_1px_0_0_rgba(255,255,255,0.06),inset_-2px_0_18px_rgba(0,0,0,0.65)]',
        'backdrop-blur-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* 顶光涂层（不参与布局） */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/[0.06] via-transparent to-black/30"
      />

      {ZEISS_HANDBOOK_MAP.map((it, idx) => {
        const active = it.id === activeId;
        return (
          <motion.button
            key={it.id}
            type="button"
            onClick={() => handleClick(it.page)}
            initial={false}
            whileHover={{ x: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            data-active={active || undefined}
            aria-current={active || undefined}
            aria-label={`${it.label}（第 ${it.page} 页）`}
            title={`${it.label} · P${it.page}`}
            className={[
              'group/btn relative flex min-h-0 flex-1 select-none items-center justify-center',
              'transition-[background,color,box-shadow] duration-200',
              idx > 0 ? 'border-t border-white/[0.05]' : '',
              active
                ? 'bg-gradient-to-r from-[#0066B3]/30 via-[#0066B3]/10 to-transparent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                : 'text-white/55 hover:bg-white/[0.05] hover:text-white/95',
            ].join(' ')}
          >
            {/* 左缘竖向激活条（与书脊咬合） */}
            <span
              aria-hidden
              className={[
                'pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 rounded-full',
                'transition-all duration-200 ease-out',
                active
                  ? 'h-[78%] w-[3px] opacity-100'
                  : 'h-[28%] w-[2px] opacity-0 group-hover/btn:opacity-50',
              ].join(' ')}
              style={{
                background: active
                  ? `linear-gradient(180deg, #66B5E8 0%, ${ZEISS_BLUE} 50%, #003359 100%)`
                  : 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.1))',
                boxShadow: active
                  ? '0 0 12px 1px rgba(0,102,179,0.55), inset 0 0 0 1px rgba(255,255,255,0.18)'
                  : undefined,
              }}
            />

            <span
              className={[
                'relative z-[1] block px-1 text-center leading-[1.05] tracking-[0.02em]',
                'text-[11px] font-semibold',
                active ? 'drop-shadow-[0_0_6px_rgba(0,102,179,0.4)]' : '',
              ].join(' ')}
            >
              {it.label}
            </span>

            {/* 右下角页码角标（仅 active） */}
            {active ? (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0.5 right-1 text-[8px] font-semibold tabular-nums text-[#66B5E8]/75"
              >
                P{it.page}
              </span>
            ) : null}
          </motion.button>
        );
      })}
    </nav>
  );
}
