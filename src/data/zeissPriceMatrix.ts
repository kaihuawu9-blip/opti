/**
 * 蔡司 2026 价目表·五维矩阵
 * 品牌（蔡司）/系列/折射率/膜层/价格 + 光度边界 + 特殊属性
 *
 * 数据源：public/catalog/zeiss-handbook/2026_蔡司价目册-1106-终审8（预览可复制）(1).pdf
 * 结构化 JSON：ai-data/zeiss_digital_handbook/2026_price_matrix.json
 *
 * 与 @/lib/zeissRetailCatalog 的关系：
 *   - 本文件提供带 `tintable` / `colors` / `powerRanges` 等扩展字段的新结构；
 *   - 旧 @/data/AI-DATA-zeiss-retail.json 仍保留，供 `coatingsForSeriesAndIndex`
 *     等现有 API 的最小兼容；后续可通过 bridgeZeissCatalog() 替换底层数据源。
 *
 * Matrix Self-Check Protocol：
 *   - 每条 `products[]` 建议写入 `catalog_page_reference.pdfIndex`（与手册物理页 1:1）；
 *   - Node 启动时 `src/instrumentation.ts` 调用 `@/lib/catalog/matrixSelfCheckProtocol` 校验
 *     与 `zeissHandbookPageMap` 的 dataAnchor / pdfIndex 链；可用 `MATRIX_SELF_CHECK_STRICT=1` 失败即抛错。
 */

import raw from '../../ai-data/zeiss_digital_handbook/2026_price_matrix.json';

// —————————————————————————————————————————————————————————————————————
// 类型
// —————————————————————————————————————————————————————————————————————

/** 蔡司售卖的标准折射率档位（含常见 1.56 / 1.59 等补档） */
export type ZeissRefractiveIndex = 1.5 | 1.56 | 1.59 | 1.6 | 1.67 | 1.74;

/** 膜层英文代号（用于后续 SKU 生成 & UI 规则匹配） */
export type ZeissCoatingCode =
  | 'DVC' // 钻立方绿晶膜
  | 'DP'  // 钻立方铂金膜
  | 'BP'  // 钻立方防蓝光膜
  | 'DG'  // 钻立方鎏金膜
  | 'DVK' // 钻立方爱动膜
  | 'BL+DP'
  | 'BL+DV'
  | 'BL+DG'
  | 'LT'; // 莲花膜

/** 特征分类（子系列附加特性） */
export type ZeissColorFeature = 'photochromic' | 'polarized' | null;

/** 单行 SKU（交叉点） */
export interface ZeissPriceRow {
  index: number;
  coating: string;
  coatingCode?: string;
  retailYuan: number;
  /** 是否可染色（染色服务可叠加）；收银展示层在膜层名后追加「(可染色)」 */
  tintable: boolean;
  designCode?: string;
  note?: string;
  material?: string;
  /** 焕色/偏光可选颜色（局部覆盖系列级 colorsBy） */
  colors?: string[];
  /**
   * StandardEye 4.0：价目格归一化坐标 [centerX, centerY, width, height]（0–1，单页宽高基准）。
   * 由 `scripts/zeiss-matrix-v4-rebuild.mjs` 自动计算后写入 JSON；
   * 供 `ProductHotspot` 系统精准触发收银台自动填装。
   */
  coord?: [number, number, number, number];
}

/** 子系列（同一 productName 下按"变色 / 偏光 / 标配"再切分） */
export interface ZeissSeriesSubset {
  name: string;
  colorFeature?: ZeissColorFeature;
  specialAttributes?: string[];
  /** 焕色视界 X 在不同折射率下颜色不同：按 "1.5" / "1.6" / "1.67" / "1.74" 键索引 */
  colorsBy?: Record<string, string[]>;
  colors?: string[];
  corridors?: string[];
  rows: ZeissPriceRow[];
}

/** 光度范围（矩形包络） */
export interface ZeissPowerRange {
  sphere_d: { min: number; max: number };
  cylinder_d: { min: number; max: number };
  diameter_mm?: [number, number];
  source?: string;
}

/**
 * 价目行 ↔ 手册物理页唯一锚定（与 `handbookPageImageData` / manifest 页序一致）。
 * Matrix Self-Check 要求每条矩阵产品可解析到合法 `pdfIndex`；JSON 可暂缺，由启动自检反推并告警。
 */
export interface CatalogPageReference {
  /** 1-based 物理页（= `ZEISS_HANDBOOK_PAGE_MAP[].pdfPage`） */
  pdfIndex: number;
  /** 印刷页码（审计用，可选） */
  printedPage?: number | null;
}

/** 产品（= 一条手册里的镜片产品） */
export interface ZeissProductMatrix {
  productName: string;
  /**
   * 价目所属品牌键（大写英文，与多品牌矩阵对齐）；JSON 可省略，省略时视为 `ZEISS`。
   * 收银「选择品牌」下拉与 `ZEISS_PRICE_MATRIX.filter(...)` 均依赖此字段。
   */
  brand?: string;
  /**
   * StandardEye 4.0 — 一级字段【大系列】，与手册右侧物理凸起标签 1:1 对应。
   * 取值：'智锐系列' | '青少年系列' | '单光系列' | '渐进系列' | '数码型' | '驾驶型' | '户外镜片'
   */
  seriesGroup?: string;
  printedPage?: number;
  /** 可选：与产品价目同页的图（data:image/webp;base64,...），图文合一时的产品级备援 */
  imageData?: string;
  englishName?: string;
  seriesFamily?: string;
  lensType?: string;
  lensCategory?: string;
  designCodePrefix?: string;
  addRange?: { min: number; max: number; unit: string } | null;
  description?: string;
  series: ZeissSeriesSubset[];
  powerRanges?: Record<string, ZeissPowerRange>;
  specialAttributes?: string[];
  /**
   * 物理价目图唯一索引（Matrix Self-Check / 图手册对齐）。
   * 若 JSON 未写入，启动时由 `matrixSelfCheckProtocol` 用手册映射反推并输出 WARN。
   */
  catalog_page_reference?: CatalogPageReference;
}

/** 顶层（便于将来扩展 bundle / 加工附加价等） */
export interface ZeissPriceMatrixFile {
  _source: string;
  _effective: { from: string; to: string };
  _currency: string;
  _unit: string;
  _extractedAt: string;
  /**
   * 物理页 1..N → dataURL（建议 WebP base64，键为字符串 "1".."82"）
   * 与翻页/侧栏/价目同内存加载，无 /catalog/ 路径回拉
   */
  handbookPageImageData?: Record<string, string>;
  products: ZeissProductMatrix[];
}

// —————————————————————————————————————————————————————————————————————
// 数据
// —————————————————————————————————————————————————————————————————————

const data = raw as unknown as ZeissPriceMatrixFile;

export const ZEISS_PRICE_MATRIX: readonly ZeissProductMatrix[] = Object.freeze(
  data.products.filter((p) => Array.isArray(p.series) && p.series.length > 0),
);

/** 与物理页 1:1 的内嵌图（见 scripts/embed-zeiss-handbook-to-matrix.mjs 写入 JSON） */
export const ZEISS_HANDBOOK_PAGE_IMAGE_DATA: Readonly<Record<string, string>> = Object.freeze(
  data.handbookPageImageData ?? {},
);

export function embeddedHandbookPageCount(): number {
  return Object.keys(ZEISS_HANDBOOK_PAGE_IMAGE_DATA).length;
}

export const ZEISS_MATRIX_META = {
  source: data._source,
  effective: data._effective,
  currency: data._currency,
  unit: data._unit,
  extractedAt: data._extractedAt,
} as const;

// —————————————————————————————————————————————————————————————————————
// 查询辅助
// —————————————————————————————————————————————————————————————————————

export function findZeissProductMatrix(
  productName: string,
): ZeissProductMatrix | undefined {
  const t = productName.trim();
  return ZEISS_PRICE_MATRIX.find((p) => p.productName === t);
}

export function findZeissSubset(
  productName: string,
  subsetName: string,
): ZeissSeriesSubset | undefined {
  const p = findZeissProductMatrix(productName);
  if (!p) return undefined;
  const t = subsetName.trim();
  return p.series.find((s) => s.name === t);
}

export function listZeissProductNames(): string[] {
  return ZEISS_PRICE_MATRIX.map((p) => p.productName);
}

/** 矩阵行品牌键（大写）；缺省 `ZEISS` */
export function matrixProductBrandKey(p: ZeissProductMatrix): string {
  const raw = p.brand?.trim().toUpperCase();
  return raw || 'ZEISS';
}

/** 价目矩阵中出现的全部品牌键（升序），供收银品牌下拉数据源 */
export function listUniqueMatrixBrandKeys(): string[] {
  return Array.from(new Set(ZEISS_PRICE_MATRIX.map(matrixProductBrandKey))).sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
}

/** 手册页未映射到 section 时，按矩阵 lensType / lensCategory 分的兜底分组名 */
export function matrixLensTypeGroupLabel(p: ZeissProductMatrix): string {
  const t = (p.lensType || '').trim();
  if (t === 'SingleVision') return '单光';
  if (t === 'Progressive') return '渐进 / 睐光';
  if (t === 'Digital-PAL') return '数码型';
  if (t === 'MyopiaControl') return '青少年近视管理';
  const c = (p.lensCategory || '').trim();
  if (c) return c;
  return '其他';
}

/** 品牌键 → 中文展示（未知键原样返回，便于扩展） */
export function matrixBrandDisplayLabel(brandKey: string): string {
  const k = brandKey.trim().toUpperCase();
  if (k === 'ZEISS') return '蔡司';
  if (k === 'ESSILOR') return '依视路';
  if (k === 'HOYA') return '豪雅';
  return brandKey.trim() || '—';
}

export function listIndicesForMatrixSeries(
  productName: string,
  subsetName: string,
): number[] {
  const s = findZeissSubset(productName, subsetName);
  if (!s) return [];
  const set = new Set<number>();
  for (const r of s.rows) if (Number.isFinite(r.index)) set.add(Number(r.index));
  return Array.from(set).sort((a, b) => a - b);
}

export function findZeissPriceRow(
  productName: string,
  subsetName: string,
  index: number,
  coatingCodeOrName: string,
): ZeissPriceRow | null {
  const s = findZeissSubset(productName, subsetName);
  if (!s) return null;
  const t = coatingCodeOrName.trim();
  for (const r of s.rows) {
    if (Number(r.index) !== Number(index)) continue;
    if (r.coating === t || r.coatingCode === t) return r;
  }
  return null;
}

export function getZeissPowerRange(
  productName: string,
  index: number,
): ZeissPowerRange | null {
  const p = findZeissProductMatrix(productName);
  if (!p || !p.powerRanges) return null;
  return p.powerRanges[String(index)] ?? null;
}

/** 跨子系列汇总：某品种下全部可选折射率（去重升序） */
export function listIndicesForProduct(productName: string): number[] {
  const p = findZeissProductMatrix(productName);
  if (!p) return [];
  const set = new Set<number>();
  for (const subset of p.series) {
    for (const r of subset.rows) {
      if (Number.isFinite(r.index)) set.add(Number(r.index));
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** 跨子系列汇总：给定品种+折射率下的全部膜层展示名（去重，中文排序） */
export function listCoatingsForProductIndex(
  productName: string,
  index: number,
): string[] {
  const p = findZeissProductMatrix(productName);
  if (!p) return [];
  const set = new Set<string>();
  for (const subset of p.series) {
    for (const r of subset.rows) {
      if (Number(r.index) !== Number(index)) continue;
      const label = r.coating?.trim();
      if (label) set.add(label);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/**
 * 在价目矩阵中解析（品种 + 折射率 + 膜层）对应行；膜层可与 coating 展示名或 coatingCode 匹配。
 */
export function findZeissMatrixRow(
  productName: string,
  index: number,
  coating: string,
): { row: ZeissPriceRow; subset: ZeissSeriesSubset } | null {
  const p = findZeissProductMatrix(productName);
  if (!p) return null;
  const t = coating.trim();
  for (const subset of p.series) {
    for (const row of subset.rows) {
      if (Number(row.index) !== Number(index)) continue;
      if (row.coating === t || row.coatingCode === t) {
        return { row, subset };
      }
    }
  }
  return null;
}

export function resolveMatrixRetailYuan(
  productName: string,
  index: number,
  coating: string,
): number | null {
  const hit = findZeissMatrixRow(productName, index, coating);
  if (!hit) return null;
  const y = Number(hit.row.retailYuan);
  return Number.isFinite(y) ? y : null;
}
