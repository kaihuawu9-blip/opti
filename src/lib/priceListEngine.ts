/**
 * 通用价目表引擎：当前实现蔡司数字化价目（`AI-DATA-zeiss-retail.json`），
 * 可与收银台「价目表选购 / 自由填报」双模式对接，避免与 `zeissRetailCatalog` 逻辑漂移。
 */
import {
  coatingsForSeriesAndIndex,
  findZeissRetailRow,
  findZeissSeries,
  getZeissRetailProducts,
  type ZeissProductEntry,
  uniqueIndicesForSeries,
} from '@/lib/zeissRetailCatalog';

export type LensPriceEntryMode = 'freeform' | 'catalog';

export { getZeissRetailProducts, findZeissRetailRow, findZeissSeries };

/** 按品名关键字过滤（大小写不敏感，含即得） */
export function searchZeissProducts(keyword: string): ZeissProductEntry[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return getZeissRetailProducts();
  return getZeissRetailProducts().filter((p) => p.productName.toLowerCase().includes(k));
}

export function formatZeissSkuName(
  productName: string,
  seriesName: string,
  indexLabel: string,
  coating: string,
): string {
  const brand = '蔡司';
  const parts = [brand, productName.trim(), seriesName.trim(), indexLabel.trim(), coating.trim()].filter(Boolean);
  return parts.join(' · ');
}

export function resolveZeissRetailYuan(
  productName: string,
  seriesName: string,
  index: number,
  coating: string,
): number | null {
  const row = findZeissRetailRow(productName, seriesName, index, coating);
  return row ? Number(row.retailYuan) : null;
}

export function indicesForZeissSeries(productName: string, seriesName: string): number[] {
  return uniqueIndicesForSeries(productName, seriesName);
}

export function coatingsForZeissSelection(
  productName: string,
  seriesName: string,
  index: number,
): string[] {
  return coatingsForSeriesAndIndex(productName, seriesName, index);
}
