/**
 * 依视路数字化手册 · 物理页映射（Matrix Protocol V1.1）
 *
 * 当前 **故意为空**：与 `MATRIX_BRAND_REGISTRY` 中 ESSILOR 条目配合，
 * 用于多品牌场景下插件 B / UI「数据待补全」占位与启动自检告警。
 *
 * 接入后：在此追加 `HandbookPageEntry` 形态行，并与价目 JSON、`HANDBOOK_BRAND_REGISTRY` 对齐。
 */

/** 与蔡司侧 `HandbookPageEntry` 字段对齐的最小契约（便于后续共用工具） */
export type EssilorHandbookPageEntry = {
  pdfPage: number;
  printedPage: number | null;
  section: string;
  productName?: string;
  title?: string;
};

export const ESSILOR_HANDBOOK_PAGE_MAP: readonly EssilorHandbookPageEntry[] = Object.freeze([]);
