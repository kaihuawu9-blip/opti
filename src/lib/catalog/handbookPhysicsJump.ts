'use client';

/**
 * 手册「物理」翻页：统一走 StPageFlip 动画，供首页/外部切页/页码跳转/侧栏等调用。
 *
 * `target` 为 **0-based** 左页下标，与 `HandbookSeriesNavItem.startPage0`、引擎 `flip()` 一致。
 * 依赖 `ZeissDigitalHandbook` 在 `useLayoutEffect` 中挂载的 `window.pageFlipInstance`。
 */
export function physicsJump(target: number, corner: string = 'top'): void {
  if (!Number.isFinite(target)) return;
  try {
    window.pageFlipInstance?.flip(Math.trunc(target), corner);
  } catch {
    /* ignore */
  }
}

/** 1-based 物理 PDF 页 → 0-based flip 下标（蔡司侧栏 / 页码输入等） */
export function physicsJumpFromPdfPage1(pdfPage1: number, corner?: string): void {
  if (!Number.isFinite(pdfPage1)) return;
  physicsJump(Math.max(0, Math.trunc(pdfPage1) - 1), corner);
}
