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
