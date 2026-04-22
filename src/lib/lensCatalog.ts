export type ImportLensBrandKey = '依视路' | '蔡司' | '豪雅';
export type DomesticLensBrandKey = '明月' | '凯米' | '康耐特' | '格林视通';
export type LensBrandKey = ImportLensBrandKey | DomesticLensBrandKey;

export type LensSeriesOption = {
  series: string;
  /**
   * 该系列在门店录入时可选择的折射率（mm=mm 不涉及，这里是 n）。
   * 说明：为了满足“录入方便”，本文件的系列清单与折射率列表优先用作 UI 下拉来源；你后续可以继续补齐/更正。
   */
  indices: number[];
};

export const IMPORT_LENS_BRANDS: ImportLensBrandKey[] = ['依视路', '蔡司', '豪雅'];
export const DOMESTIC_LENS_BRANDS: DomesticLensBrandKey[] = ['明月', '凯米', '康耐特', '格林视通'];

/**
 * 映射 B：
 * - 系列 -> 写入 products.lens_type
 * - 折射率 -> 写入 products.lens_type（与系列拼接）
 * - model 不参与（自动置空）
 */
export const IMPORT_LENS_CATALOG: Record<ImportLensBrandKey, LensSeriesOption[]> = {
  // 先按常用/可确认的主线做 UI 录入；你后续如果要“官网全量 + 严格剔除已停产”，把官网清单发我，我可以继续补齐本文件。
  '依视路': [
    { series: '钻晶 X4', indices: [1.56, 1.60, 1.67, 1.74] },
    { series: '钻晶 致洁', indices: [1.60, 1.67, 1.74] },
    { series: '适赞', indices: [1.56, 1.60] },
    { series: '钻晶 A4', indices: [1.56, 1.60, 1.67] },
  ],
  '蔡司': [
    { series: 'DriveSafe（驾驶型渐进）', indices: [1.50, 1.60, 1.67, 1.74] },
    { series: 'DriveSafe（驾驶型单光）', indices: [1.50, 1.60, 1.67, 1.74] },
  ],
  '豪雅': [
    { series: 'MiYOSMART 新乐学（儿童近视管理）', indices: [1.67, 1.74] },
    // 把材料线也当作“系列”录入，便于门店直接选折射率（n 归档落在 lens_type）。
    { series: 'Eynoa（1.67 材料）', indices: [1.67] },
    { series: 'Eyvia（1.74 材料）', indices: [1.74] },
  ],
};

export const DOMESTIC_LENS_CATALOG: Record<DomesticLensBrandKey, LensSeriesOption[]> = {
  '明月': [
    { series: 'PMC 超亮', indices: [1.56, 1.60, 1.67, 1.74] },
    { series: '轻松控 Pro', indices: [1.60, 1.67] },
    { series: 'U6 防蓝光', indices: [1.56, 1.60, 1.67] },
    { series: '双擎', indices: [1.60, 1.67, 1.74] },
  ],
  '凯米': [
    { series: 'U2', indices: [1.56, 1.60, 1.67] },
    { series: 'U6', indices: [1.56, 1.60, 1.67] },
    { series: 'U8', indices: [1.60, 1.67, 1.74] },
    { series: 'EV（防蓝光）', indices: [1.60, 1.67] },
  ],
  '康耐特': [
    { series: 'A 系列（膜层）', indices: [1.56, 1.60, 1.67] },
    { series: '防蓝光系列', indices: [1.56, 1.60, 1.67] },
    { series: '超薄系列', indices: [1.67, 1.74] },
  ],
  '格林视通': [
    { series: '高清防蓝光', indices: [1.56, 1.60, 1.67] },
    { series: '超薄非球面', indices: [1.60, 1.67, 1.74] },
    { series: '轻松控（青少年）', indices: [1.60, 1.67] },
  ],
};

export function formatIndex(n: number): string {
  // 1.60 -> 1.6；1.74 -> 1.74；1.50 -> 1.5
  return String(Number(n.toFixed(2)));
}

export function parseLensType(lensType: string): { seriesPart: string; index: number | null } {
  const raw = (lensType || '').trim();
  // 末尾匹配折射率数字：例如 "... / 1.67"
  const m = raw.match(/(.+?)[\/|, ]+(\d\.\d+)\s*$/);
  if (!m) return { seriesPart: raw, index: null };
  return { seriesPart: (m[1] || '').trim(), index: Number.parseFloat(m[2]) };
}

