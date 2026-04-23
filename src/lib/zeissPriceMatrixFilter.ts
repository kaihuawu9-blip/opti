/**
 * 蔡司价目表·Select 下拉菜单过滤与联动规则
 *
 * 场景：
 *   - 用户在收银台/加工单选择 产品 → 折射率 → 膜层 → (染色/变色/偏光)；
 *   - 根据 `zeissPriceMatrix` 的 `tintable`、`colorFeature`、`colors` 等字段
 *     自动置灰/隐藏不兼容的选项，例如：
 *       · 1.74 铂金膜 → 不可染色：DISABLE「染色服务」选项；
 *       · 1.74 焕色视界 X → 仅「变深灰 / 褐」可选，隐藏「青 / 勃艮第红」；
 *       · 偏光子系列：不兼容镜框开槽/半框，仅全框；
 *   - 矩阵外的几何光学硬约束（sphere/cylinder）由
 *     `matrix-intelligence-hub.json` → `validate.geometric_optics` 给出，
 *     此处仅负责"属性可选性"，不越权替代度数合法性校验。
 */

import {
  findZeissProductMatrix,
  findZeissSubset,
  findZeissPriceRow,
  getZeissPowerRange,
  type ZeissPowerRange,
  type ZeissPriceRow,
  type ZeissSeriesSubset,
} from '@/data/zeissPriceMatrix';

/** UI 选项可用性：可选 / 置灰 + 原因文案 / 隐藏 */
export type OptionAvailability =
  | { state: 'available' }
  | { state: 'disabled'; reason: string }
  | { state: 'hidden' };

export interface CoatingOptionDescriptor {
  coating: string;
  coatingCode?: string;
  retailYuan: number;
  tintable: boolean;
  tintServiceAvailability: OptionAvailability;
  photochromicAvailability: OptionAvailability;
  polarizedAvailability: OptionAvailability;
  note?: string;
  designCode?: string;
  powerRange?: ZeissPowerRange | null;
}

/**
 * 给定「产品 + 子系列 + 折射率」，返回该折射率下每一种膜层的 UI 描述。
 * 可直接喂给前端 <Select> 渲染。
 *
 * @param productName 如 "智锐单光"
 * @param subsetName  如 "标配版" / "偏光（灰/褐/绿）" / "焕色视界X"
 * @param index       如 1.74
 */
export function getZeissCoatingOptions(
  productName: string,
  subsetName: string,
  index: number,
): CoatingOptionDescriptor[] {
  const subset = findZeissSubset(productName, subsetName);
  if (!subset) return [];

  const rows = subset.rows.filter((r) => Number(r.index) === Number(index));
  if (rows.length === 0) return [];

  return rows.map((r) => buildDescriptor(subset, r, productName, index));
}

function buildDescriptor(
  subset: ZeissSeriesSubset,
  row: ZeissPriceRow,
  productName: string,
  index: number,
): CoatingOptionDescriptor {
  const range = getZeissPowerRange(productName, index);

  // — 染色服务：看当前行 tintable；默认所有 1.74 行 tintable=false
  const tintService: OptionAvailability = row.tintable
    ? { state: 'available' }
    : {
        state: 'disabled',
        reason: index >= 1.74
          ? '1.74 高折射率镜片不支持染色服务'
          : '该膜层不支持染色服务（见价目册备注）',
      };

  // — 变色：若当前子系列本身就是 photochromic，则该项「已内置」；
  //   若当前子系列是标配版，则「变色」是可叠加选项，但仅当同一 product+index 存在
  //   'photochromic' 子系列里的相同膜层才可用。
  let photochromic: OptionAvailability;
  if (subset.colorFeature === 'photochromic') {
    photochromic = { state: 'hidden' }; // 已内置，无需再选
  } else {
    const photoSubset = findZeissProductMatrix(productName)?.series.find(
      (s) => s.colorFeature === 'photochromic',
    );
    const photoRow = photoSubset?.rows.find(
      (r) =>
        Number(r.index) === Number(index) &&
        (r.coating === row.coating || r.coatingCode === row.coatingCode),
    );
    photochromic = photoRow
      ? { state: 'available' }
      : {
          state: 'disabled',
          reason:
            index >= 1.74
              ? '1.74 + 该膜层暂无焕色视界 X 匹配'
              : '该膜层 / 折射率组合不提供焕色变色版',
        };
  }

  // — 偏光：类似
  let polarized: OptionAvailability;
  if (subset.colorFeature === 'polarized') {
    polarized = { state: 'hidden' };
  } else {
    const polSubset = findZeissProductMatrix(productName)?.series.find(
      (s) => s.colorFeature === 'polarized',
    );
    const polRow = polSubset?.rows.find(
      (r) =>
        Number(r.index) === Number(index) &&
        (r.coating === row.coating || r.coatingCode === row.coatingCode),
    );
    polarized = polRow
      ? { state: 'available' }
      : index >= 1.74
        ? { state: 'disabled', reason: '1.74 不提供偏光版本（手册未覆盖）' }
        : { state: 'disabled', reason: '该膜层 / 折射率组合不提供偏光版本' };
  }

  return {
    coating: row.coating,
    coatingCode: row.coatingCode,
    retailYuan: row.retailYuan,
    tintable: row.tintable,
    tintServiceAvailability: tintService,
    photochromicAvailability: photochromic,
    polarizedAvailability: polarized,
    note: row.note,
    designCode: row.designCode,
    powerRange: range,
  };
}

/** 便捷：1.74 + 任意膜层时，染色服务恒置灰 */
export function isTintServiceAllowed(
  productName: string,
  subsetName: string,
  index: number,
  coatingCodeOrName: string,
): boolean {
  const row = findZeissPriceRow(productName, subsetName, index, coatingCodeOrName);
  return Boolean(row?.tintable);
}

/**
 * 光度合法性快速校验：只校验价目册的矩形包络；更细的子午线约束仍在
 * matrix-intelligence-hub.json -> validate.geometric_optics 中处理。
 */
export function isPrescriptionInProductRange(
  productName: string,
  index: number,
  sphere_d: number,
  cylinder_d: number,
): { ok: boolean; reason?: string } {
  const range = getZeissPowerRange(productName, index);
  if (!range) return { ok: true };
  if (sphere_d < range.sphere_d.min || sphere_d > range.sphere_d.max) {
    return {
      ok: false,
      reason: `球镜 ${sphere_d.toFixed(2)}D 超出 ${productName} ${index} 的 [${range.sphere_d.min}, ${range.sphere_d.max}] 包络`,
    };
  }
  if (cylinder_d < range.cylinder_d.min || cylinder_d > range.cylinder_d.max) {
    return {
      ok: false,
      reason: `柱镜 ${cylinder_d.toFixed(2)}D 超出 ${productName} ${index} 的 [${range.cylinder_d.min}, ${range.cylinder_d.max}] 包络`,
    };
  }
  return { ok: true };
}

/**
 * 已有 `coatingsForZeissSelection(product, series, index): string[]` 在收银台使用。
 * 下面提供一个带"可用性"的升级版，外层按需调用。
 */
export function coatingsForZeissSelectionRich(
  productName: string,
  subsetName: string,
  index: number,
): CoatingOptionDescriptor[] {
  return getZeissCoatingOptions(productName, subsetName, index);
}
