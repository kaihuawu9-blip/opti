/**
 * 豪雅数字化手册 · 物理页映射（Matrix Protocol V1.2）
 *
 * 当前 **故意为空**：与 `MATRIX_BRAND_REGISTRY` 中 HOYA 条目配合，
 * 用于多品牌场景下插件 B / UI「数据待补全」占位与启动自检告警。
 */

export type HoyaHandbookPageEntry = {
  pdfPage: number;
  printedPage: number | null;
  section: string;
  productName?: string;
  title?: string;
};

export const HOYA_HANDBOOK_PAGE_MAP: readonly HoyaHandbookPageEntry[] = Object.freeze([]);
