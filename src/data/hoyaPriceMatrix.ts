/**
 * 豪雅价目矩阵（Matrix V1.3 HOYA 专项）
 * 数据源：ai-data/hoya_handbook/price_matrix.json
 */

import raw from '../../ai-data/hoya_handbook/price_matrix.json';
import type {
  ZeissPriceMatrixFile,
  ZeissProductMatrix,
  ZeissPriceRow,
  ZeissSeriesSubset,
} from '@/data/zeissPriceMatrix';

const data = raw as unknown as ZeissPriceMatrixFile;

export const HOYA_PRICE_MATRIX: readonly ZeissProductMatrix[] = Object.freeze(
  data.products.filter((p) => Array.isArray(p.series) && p.series.length > 0),
);

export const HOYA_HANDBOOK_PAGE_IMAGE_DATA: Readonly<Record<string, string>> = Object.freeze(
  data.handbookPageImageData ?? {},
);

export function findHoyaProductMatrix(productName: string): ZeissProductMatrix | undefined {
  const t = productName.trim();
  return HOYA_PRICE_MATRIX.find((p) => p.productName === t);
}

export function findHoyaMatrixRow(
  productName: string,
  index: number,
  coating: string,
): { row: ZeissPriceRow; subset: ZeissSeriesSubset } | null {
  const p = findHoyaProductMatrix(productName);
  if (!p) return null;
  const ct = coating.trim();
  for (const subset of p.series) {
    for (const row of subset.rows) {
      if (Number(row.index) !== Number(index)) continue;
      if (row.coating === ct || row.coatingCode === ct) {
        return { row, subset };
      }
    }
  }
  return null;
}
