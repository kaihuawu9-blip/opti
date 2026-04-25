/**
 * StPageFlip 子页 **0-based** 下标：仅在这些页挂载右缘物理 rail（蔡司 prestige 条 / 豪雅横签）。
 *
 * 与 `ZeissDigitalHandbook` 的父级门控、{@link ZeissSeriesNavList} 内二次校验为**同一公式**（双重保险，禁止漂移）。
 */
export function isHandbookPhysicalRailHostPage(pageIndex0: number): boolean {
  return pageIndex0 % 2 !== 0 || pageIndex0 === 0;
}
