/**
 * 依视路数字化手册 · 物理页映射（Matrix Protocol V1.3 · 内容收割）
 *
 * 与 `ai-data/essilor_handbook/price_matrix.json` 中 `productName` / `catalog_page_reference.pdfIndex` 对齐。
 * 黄金索引：`HANDBOOK_BRAND_REGISTRY.essilor`（见 `zeissHandbookPageMap.ts`）。
 */

/** 与蔡司侧 `HandbookPageEntry` 字段对齐的最小契约（便于后续共用工具） */
export type EssilorHandbookPageEntry = {
  pdfPage: number;
  printedPage: number | null;
  section: string;
  productName?: string;
  title?: string;
};

/** 钻晶系列首批：封面 + 两个价目锚点页（与价目 JSON 一致） */
export const ESSILOR_HANDBOOK_PAGE_MAP: readonly EssilorHandbookPageEntry[] = Object.freeze([
  { pdfPage: 1, printedPage: null, section: 'cover-brand', title: '依视路 · 钻晶系列' },
  { pdfPage: 2, printedPage: 1, section: 'price', productName: '钻晶A4单光', title: '钻晶 A4 单光' },
  { pdfPage: 3, printedPage: 2, section: 'price', productName: '钻晶膜岩单光', title: '钻晶 膜岩 单光' },
]);
