'use client';

/** StPageFlip 程序化翻页的「发力角」：显式传入可强制走页角折叠路径，利于 3D 观感 */
export type HandbookPhysicsFlipCorner = 'top' | 'bottom';

/**
 * 手册「物理」翻页：统一走 StPageFlip 动画，供首页/外部切页/页码跳转/侧栏等调用。
 *
 * `target` 为 **0-based** 左页下标，与 `HandbookSeriesNavItem.startPage0`、引擎 `flip()` 一致。
 * 依赖 `ZeissDigitalHandbook` 挂载的 `window.pageFlipInstance`。
 */
export function physicsJump(target: number, corner: HandbookPhysicsFlipCorner = 'top'): void {
  if (!Number.isFinite(target)) return;
  try {
    // 二参必传 'top'：从页角上缘「抠开」，否则部分构建会走弱 3D/滑页
    window.pageFlipInstance?.flip(Math.trunc(target), corner);
  } catch {
    /* ignore */
  }
}

/** 1-based 物理 PDF 页 → 0-based flip 下标（蔡司侧栏 / 页码输入等） */
export function physicsJumpFromPdfPage1(
  pdfPage1: number,
  corner: HandbookPhysicsFlipCorner = 'top',
): void {
  if (!Number.isFinite(pdfPage1)) return;
  physicsJump(Math.max(0, Math.trunc(pdfPage1) - 1), corner);
}
