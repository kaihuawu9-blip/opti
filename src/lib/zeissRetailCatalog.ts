import raw from '@/data/AI-DATA-zeiss-retail.json';

export type ZeissRetailRow = { index: number; coating: string; retailYuan: number };
export type ZeissSeriesEntry = { name: string; rows: ZeissRetailRow[] };
export type ZeissProductEntry = { productName: string; series: ZeissSeriesEntry[] };

type FileShape = { products?: ZeissProductEntry[] };

const catalog: ZeissProductEntry[] = Array.isArray((raw as FileShape).products)
  ? (raw as FileShape).products!
  : [];

export function getZeissRetailProducts(): ZeissProductEntry[] {
  return catalog;
}

export function findZeissProduct(productName: string): ZeissProductEntry | undefined {
  const t = productName.trim();
  return catalog.find((p) => p.productName === t);
}

export function findZeissSeries(productName: string, seriesName: string): ZeissSeriesEntry | undefined {
  const p = findZeissProduct(productName);
  if (!p) return undefined;
  const t = seriesName.trim();
  return p.series.find((s) => s.name === t);
}

export function uniqueIndicesForSeries(productName: string, seriesName: string): number[] {
  const s = findZeissSeries(productName, seriesName);
  if (!s) return [];
  const set = new Set<number>();
  for (const r of s.rows) {
    if (Number.isFinite(r.index)) set.add(Number(r.index));
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function coatingsForSeriesAndIndex(
  productName: string,
  seriesName: string,
  index: number,
): string[] {
  const s = findZeissSeries(productName, seriesName);
  if (!s) return [];
  const list: string[] = [];
  for (const r of s.rows) {
    if (Number(r.index) === Number(index) && r.coating && !list.includes(r.coating)) {
      list.push(r.coating);
    }
  }
  return list;
}

export function findZeissRetailRow(
  productName: string,
  seriesName: string,
  index: number,
  coating: string,
): ZeissRetailRow | null {
  const s = findZeissSeries(productName, seriesName);
  if (!s) return null;
  const c = coating.trim();
  for (const r of s.rows) {
    if (Number(r.index) === Number(index) && r.coating === c) return r;
  }
  return null;
}
