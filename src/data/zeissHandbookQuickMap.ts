/**
 * 蔡司价目册 · 编辑用章节 → PDF 页码快捷索引
 *
 * 供搜索、深链、管理后台等使用；**不是** physical rail 的 runtime 真值源。
 * 侧栏/凸标见 {@link buildZeissPhysicalTabNavItems} 与 `ZEISS_HANDBOOK_PAGE_MAP`（须 `physicalTabVerified` + `physicalTabLabel`）。
 */

export const ZEISS_HANDBOOK_MAP = [
  { id: 'smartlife', label: '智锐系列', page: 10 },
  { id: 'youth', label: '青少年系列', page: 25 },
  { id: 'single_vision', label: '单光镜片', page: 33 },
  { id: 'progressive', label: '渐进系列', page: 41 },
  { id: 'digital', label: '数码型镜片', page: 53 },
  { id: 'drive', label: '驾驶型镜片', page: 56 },
  { id: 'outdoor', label: '户外镜片', page: 60 },
  { id: 'appendix', label: '附录', page: 73 },
  { id: 'healthcare', label: '眼健康消费品', page: 80 },
] as const;

export type ZeissHandbookMapEntry = (typeof ZEISS_HANDBOOK_MAP)[number];
export type ZeissHandbookMapId = ZeissHandbookMapEntry['id'];

/** 将「快捷表」的 `page` 转为 `HTMLFlipBook` 使用的 0-based 页下标 */
export function zeissHandbookMapPageToIndex0(pdfPage1: number): number {
  return Math.max(0, Math.floor(pdfPage1) - 1);
}

/**
 * 横展双页时，引擎的 `getCurrentPageIndex` / `onFlip(e.data)` 常指向**左叶**下标。
 * 章节从某 PDF 页号开始（如 智锐 P10），若 P10 为右叶，需用对页中**较大**下标做高亮，左右叶均落在同一段内。
 */
export function zeissHandbookMapEffectiveIndex0(engineIndex0: number, totalPages: number): number {
  const t = Math.max(0, totalPages);
  if (t <= 0) return 0;
  const i = Math.max(0, Math.min(Math.floor(engineIndex0), t - 1));
  if (t > 1 && i < t - 1) return i + 1;
  return i;
}

/**
 * 在「区间」上取**最后一个**满足 `entry.page - 1 <= index0` 的项（与累积命中规则一致）
 */
export function getZeissHandbookMapActiveId(
  currentIndex0: number,
  totalPages: number,
): ZeissHandbookMapId | null {
  const eff = zeissHandbookMapEffectiveIndex0(currentIndex0, totalPages);
  let id: ZeissHandbookMapId | null = null;
  for (const it of ZEISS_HANDBOOK_MAP) {
    if (it.page - 1 <= eff) id = it.id;
  }
  return id;
}
