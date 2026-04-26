/**
 * 通用价目表引擎：当前实现蔡司数字化价目（`AI-DATA-zeiss-retail.json`），
 * 可与收银台「价目表选购 / 自由填报」双模式对接，避免与 `zeissRetailCatalog` 逻辑漂移。
 *
 * 2026-04 升级：同时桥接 `@/data/zeissPriceMatrix`（五维价目矩阵），
 * 让旧的 `coatingsForZeissSelection(product, series, index)` 依然保持 string[] 签名，
 * 同时新增 `zeissTintFlagFor(...)` / `coatingsForZeissSelectionDetailed(...)`，
 * 供前端 Select 置灰「染色服务」或提示光度越界。
 */
import {
  coatingsForSeriesAndIndex,
  findZeissRetailRow,
  findZeissSeries,
  getZeissRetailProducts,
  type ZeissProductEntry,
  uniqueIndicesForSeries,
} from '@/lib/zeissRetailCatalog';
import {
  findZeissMatrixRow,
  findZeissProductMatrix,
  getZeissPowerRange,
  listCoatingsForProductIndex,
  listZeissProductNames,
  type ZeissPowerRange,
} from '@/data/zeissPriceMatrix';

/** 给定手册矩形包络，校验单眼光度（与 `getZeissPowerRange` 解耦，供手册行内嵌 range 复用） */
export function validatePrescriptionAgainstRange(
  range: ZeissPowerRange,
  sphere_d: number,
  cylinder_d_negative_form: number,
): { ok: boolean; reason?: string } {
  if (sphere_d < range.sphere_d.min || sphere_d > range.sphere_d.max) {
    return {
      ok: false,
      reason: `球镜 ${sphere_d.toFixed(2)}D 超出包络 [${range.sphere_d.min}, ${range.sphere_d.max}]`,
    };
  }
  if (
    cylinder_d_negative_form < range.cylinder_d.min ||
    cylinder_d_negative_form > range.cylinder_d.max
  ) {
    return {
      ok: false,
      reason: `柱镜 ${cylinder_d_negative_form.toFixed(2)}D 超出包络 [${range.cylinder_d.min}, ${range.cylinder_d.max}]`,
    };
  }
  return { ok: true };
}

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

// ———————————————————————————————————————————————————————————————————————
// 新矩阵桥接（tintable / 光度越界 / 变色&偏光可用性）
// ———————————————————————————————————————————————————————————————————————

export interface ZeissCoatingMeta {
  coating: string;
  tintable: boolean | null;
  photochromicAvailable: boolean;
  polarizedAvailable: boolean;
  powerRange: ZeissPowerRange | null;
  hint: string | null;
  /** StandardEye 4.0：该膜层对应的零售价（元），供收银下拉直接显示 */
  retailYuan: number | null;
}

/** 从 ZEISS_PRICE_MATRIX 任一 subset 里找匹配（product, index, coating） */
function findMatrixRow(productName: string, index: number, coating: string) {
  return findZeissMatrixRow(productName, index, coating);
}

/**
 * 查询给定（产品×折射率×膜层）是否可染色；未命中新矩阵返回 null，
 * 让前端按"未知/留空"渲染（不强行置灰，保持旧行为兼容）。
 */
export function zeissTintFlagFor(
  productName: string,
  _seriesName: string,
  index: number,
  coating: string,
): boolean | null {
  const hit = findMatrixRow(productName, index, coating);
  return hit ? Boolean(hit.row.tintable) : null;
}

/** 新版：返回每个膜层选项的元信息（用于下拉项 disabled / 徽标 / 提示） */
export function coatingsForZeissSelectionDetailed(
  productName: string,
  seriesName: string,
  index: number,
): ZeissCoatingMeta[] {
  const plain = coatingsForSeriesAndIndex(productName, seriesName, index);
  const powerRange = getZeissPowerRange(productName, index);

  const product = findZeissProductMatrix(productName);
  const photoSubset = product?.series.find((s) => s.colorFeature === 'photochromic');
  const polSubset = product?.series.find((s) => s.colorFeature === 'polarized');

  return plain.map((coating) => {
    const hit = findMatrixRow(productName, index, coating);
    const tintable = hit ? Boolean(hit.row.tintable) : null;

    const photochromicAvailable = Boolean(
      photoSubset?.rows.some(
        (r) =>
          Number(r.index) === Number(index) &&
          (r.coating === coating || r.coatingCode === coating),
      ),
    );
    const polarizedAvailable = Boolean(
      polSubset?.rows.some(
        (r) =>
          Number(r.index) === Number(index) &&
          (r.coating === coating || r.coatingCode === coating),
      ),
    );

    const hints: string[] = [];
    if (tintable === false) {
      hints.push(index >= 1.74 ? '1.74 不可染色' : '不可染色');
    } else if (tintable === true) {
      hints.push('可染色');
    }
    if (!photochromicAvailable && product) hints.push('无焕色变色');
    if (!polarizedAvailable && product) hints.push('无偏光版');

    return {
      coating,
      tintable,
      photochromicAvailable,
      polarizedAvailable,
      powerRange,
      hint: hints.length ? hints.join(' · ') : null,
      retailYuan: hit ? (Number.isFinite(Number(hit.row.retailYuan)) ? Number(hit.row.retailYuan) : null) : null,
    };
  });
}

/** 收银「视光矩阵」展示名：蔡司 · 品种 · 膜层 · 折射率 */
export function formatMatrixLensDisplayName(
  productName: string,
  coating: string,
  indexLabel: string,
): string {
  return `蔡司 · ${productName.trim()} · ${coating.trim()} · ${indexLabel.trim()}`;
}

/** 仅依 ZEISS_PRICE_MATRIX（不按旧 retail 的「系列」列）；用于三列级联的膜层元信息 */
export function coatingsForMatrixIndexDetailed(
  productName: string,
  index: number,
): ZeissCoatingMeta[] {
  const product = findZeissProductMatrix(productName);
  const powerRange = getZeissPowerRange(productName, index);
  if (!product) return [];
  const photoSubset = product.series.find((s) => s.colorFeature === 'photochromic');
  const polSubset = product.series.find((s) => s.colorFeature === 'polarized');

  return listCoatingsForProductIndex(productName, index).map((coating) => {
    const hit = findMatrixRow(productName, index, coating);
    const tintable = hit ? Boolean(hit.row.tintable) : null;

    const photochromicAvailable = Boolean(
      photoSubset?.rows.some(
        (r) =>
          Number(r.index) === Number(index) &&
          (r.coating === coating || r.coatingCode === coating),
      ),
    );
    const polarizedAvailable = Boolean(
      polSubset?.rows.some(
        (r) =>
          Number(r.index) === Number(index) &&
          (r.coating === coating || r.coatingCode === coating),
      ),
    );

    const hints: string[] = [];
    if (tintable === false) {
      hints.push(index >= 1.74 ? '1.74 不可染色' : '不可染色');
    } else if (tintable === true) {
      hints.push('可染色');
    }
    if (!photochromicAvailable) hints.push('无焕色变色');
    if (!polarizedAvailable) hints.push('无偏光版');

    return {
      coating,
      tintable,
      photochromicAvailable,
      polarizedAvailable,
      powerRange,
      hint: hints.length ? hints.join(' · ') : null,
      retailYuan: hit ? (Number.isFinite(Number(hit.row.retailYuan)) ? Number(hit.row.retailYuan) : null) : null,
    };
  });
}

/** 快捷：是否应当在 UI 置灰「染色服务」单选项 */
export function isZeissTintingDisabled(
  productName: string,
  seriesName: string,
  index: number,
  coating: string,
): boolean {
  return zeissTintFlagFor(productName, seriesName, index, coating) === false;
}

/** 光度越界检查（矩形包络）——超出厂家手册包络时给出软提示 */
export function validateZeissPrescription(
  productName: string,
  index: number,
  sphere_d: number,
  cylinder_d_negative_form: number,
): { ok: boolean; reason?: string } {
  const range = getZeissPowerRange(productName, index);
  if (!range) return { ok: true };
  const v = validatePrescriptionAgainstRange(range, sphere_d, cylinder_d_negative_form);
  if (v.ok) return v;
  return {
    ok: false,
    reason: `${v.reason ?? '光度越界'}（${productName} · ${index}）`,
  };
}

export function zeissMatrixProductNames(): string[] {
  return listZeissProductNames();
}

