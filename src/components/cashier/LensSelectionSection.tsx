'use client';

import { useEffect, useMemo } from 'react';
import { groupMatrixProductsForCashierSelect } from '@/data/zeissHandbookPageMap';
import {
  ZEISS_PRICE_MATRIX,
  findZeissProductMatrix,
  listCoatingsForProductIndex,
  listCoatingsForSubsetAndIndex,
  listIndicesForMatrixSeries,
  listIndicesForProduct,
  listSubsetsForProduct,
  listUniqueMatrixBrandKeys,
  matrixBrandDisplayLabel,
  matrixProductBrandKey,
} from '@/data/zeissPriceMatrix';
import {
  coatingsForMatrixIndexDetailed,
  isZeissTintingDisabled,
  zeissTintFlagFor,
} from '@/lib/priceListEngine';

/** 矩阵品牌键（与 `ZeissProductMatrix.brand` / 缺省 ZEISS 对齐） */
export type MatrixBrandKey = string;

export type LensSelectionSectionProps = {
  brand: MatrixBrandKey;
  onBrandChange: (b: MatrixBrandKey) => void;
  /** StandardEye 4.0 一级字段：系列（productName，对应价目矩阵） */
  productName: string;
  onProductNameChange: (name: string) => void;
  /** StandardEye 4.0 二级字段：子系列/版次（ZeissSeriesSubset.name，空串 = 全部） */
  subsetName: string;
  onSubsetNameChange: (v: string) => void;
  indexStr: string;
  onIndexStrChange: (v: string) => void;
  coating: string;
  onCoatingChange: (v: string) => void;
  lensCatalogTint: boolean;
  onLensCatalogTintChange: (v: boolean) => void;
  previewName: string;
  previewPrice: string;
};

export function LensSelectionSection({
  brand,
  onBrandChange,
  productName,
  onProductNameChange,
  subsetName,
  onSubsetNameChange,
  indexStr,
  onIndexStrChange,
  coating,
  onCoatingChange,
  lensCatalogTint,
  onLensCatalogTintChange,
  previewName,
  previewPrice,
}: LensSelectionSectionProps) {
  const brandKeys = useMemo(() => listUniqueMatrixBrandKeys(), []);

  const matrixRowsForBrand = useMemo(
    () => ZEISS_PRICE_MATRIX.filter((item) => matrixProductBrandKey(item) === brand),
    [brand],
  );

  const brandHasProducts = matrixRowsForBrand.length > 0;

  const groupedProducts = useMemo(
    () => groupMatrixProductsForCashierSelect(matrixRowsForBrand),
    [matrixRowsForBrand],
  );

  // 当品牌变更时，若当前 productName 不在新品牌列表中则自动选首项
  useEffect(() => {
    if (!brandHasProducts) return;
    if (matrixRowsForBrand.length === 0) return;
    if (!matrixRowsForBrand.some((p) => p.productName === productName)) {
      onProductNameChange(matrixRowsForBrand[0]!.productName);
    }
  }, [brand, brandHasProducts, matrixRowsForBrand, productName, onProductNameChange]);

  // 子系列列表（当前产品）
  const subsets = useMemo(
    () => (productName ? listSubsetsForProduct(productName) : []),
    [productName],
  );
  const hasMultipleSubsets = subsets.length > 1;

  // 子系列变更时若不在新列表内则重置
  useEffect(() => {
    if (!subsetName) return;
    if (!subsets.some((s) => s.name === subsetName)) onSubsetNameChange('');
  }, [subsets, subsetName, onSubsetNameChange]);

  // 折射率：按子系列筛选 or 跨子系列汇总
  const indexOptions = useMemo(() => {
    if (!productName) return [] as number[];
    if (subsetName) return listIndicesForMatrixSeries(productName, subsetName);
    return listIndicesForProduct(productName);
  }, [productName, subsetName]);

  // 膜层：按子系列+折射率筛选 or 跨子系列汇总
  const coatingOptions = useMemo(() => {
    if (!productName || indexStr === '') return [] as string[];
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return [];
    if (subsetName) return listCoatingsForSubsetAndIndex(productName, subsetName, idx);
    return listCoatingsForProductIndex(productName, idx);
  }, [productName, subsetName, indexStr]);

  // 膜层元信息（含 retailYuan、tintable）
  const coatingMeta = useMemo(() => {
    if (!productName || indexStr === '') return [];
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return [];
    return coatingsForMatrixIndexDetailed(productName, idx);
  }, [productName, indexStr]);

  // 当前所选膜层的 tintable 标志
  const currentTintable = useMemo(() => {
    if (!productName || !coating || indexStr === '') return null;
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return null;
    return zeissTintFlagFor(productName, '', idx, coating);
  }, [productName, indexStr, coating]);

  // 是否强制置灰染色复选框
  const tintingDisabled = useMemo(() => {
    if (!productName || !coating || indexStr === '') return false;
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return false;
    return isZeissTintingDisabled(productName, '', idx, coating);
  }, [productName, indexStr, coating]);

  // tintingDisabled 变为 true 时自动取消选中
  useEffect(() => {
    if (tintingDisabled) onLensCatalogTintChange(false);
  }, [tintingDisabled, onLensCatalogTintChange]);

  // 系列 seriesGroup（用于 UI 标注）
  const seriesGroupLabel = useMemo(
    () => (productName ? findZeissProductMatrix(productName)?.seriesGroup ?? '' : ''),
    [productName],
  );

  return (
    <div className="space-y-2">
      {/* 品牌 */}
      <label className="block text-[11px] text-gray-600">
        选择品牌
        <select
          value={brandKeys.length > 0 && brandKeys.includes(brand) ? brand : (brandKeys[0] ?? 'ZEISS')}
          onChange={(e) => onBrandChange(e.target.value)}
          className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
        >
          {brandKeys.map((key) => (
            <option key={key} value={key}>
              {matrixBrandDisplayLabel(key)}
            </option>
          ))}
        </select>
      </label>

      {!brandHasProducts ? (
        <p className="text-[11px] leading-relaxed text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-2">
          当前品牌在价目矩阵中暂无条目。请在{' '}
          <code className="text-[10px]">2026_price_matrix.json</code> 写入对应{' '}
          <code className="text-[10px]">brand</code> 与产品后重载，或暂用「自由填报」。
        </p>
      ) : null}

      {brandHasProducts ? (
        <>
          {/* ── 一级字段：系列（与价目矩阵 productName 1:1） ── */}
          <label className="block text-[11px] text-gray-600">
            系列
            {seriesGroupLabel ? (
              <span className="ml-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 text-[10px]">
                {seriesGroupLabel}
              </span>
            ) : null}
            <select
              value={
                matrixRowsForBrand.some((p) => p.productName === productName)
                  ? productName
                  : (matrixRowsForBrand[0]?.productName ?? '')
              }
              onChange={(e) => onProductNameChange(e.target.value)}
              disabled={matrixRowsForBrand.length === 0}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {matrixRowsForBrand.length === 0 ? <option value="">无产品</option> : null}
              {groupedProducts.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((pr) => (
                    <option key={pr.productName} value={pr.productName}>
                      {pr.productName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* ── 二级字段：子系列/版次（多 subset 才显示） ── */}
          {hasMultipleSubsets ? (
            <label className="block text-[11px] text-gray-600">
              子系列 / 版次
              <select
                value={subsetName}
                onChange={(e) => onSubsetNameChange(e.target.value)}
                className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">全部（汇总）</option>
                {subsets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* ── 三级字段：折射率 ── */}
          <label className="block text-[11px] text-gray-600">
            折射率
            <select
              value={indexStr}
              onChange={(e) => onIndexStrChange(e.target.value)}
              disabled={!productName || indexOptions.length === 0}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {indexOptions.map((n) => (
                <option key={String(n)} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          {/* ── 四级字段：膜层规格（规格版次 · 膜层名 (染色属性) | ¥价格） ── */}
          <label className="block text-[11px] text-gray-600">
            膜层规格
            <select
              value={coating}
              onChange={(e) => onCoatingChange(e.target.value)}
              disabled={!productName || indexStr === '' || coatingOptions.length === 0}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {coatingOptions.map((c) => {
                const meta = coatingMeta.find((m) => m.coating === c);
                const tintSuffix =
                  meta?.tintable === true
                    ? ' (可染色)'
                    : meta?.tintable === false
                      ? ' (不可染色)'
                      : '';
                const priceSuffix =
                  meta?.retailYuan != null ? ` | ¥${meta.retailYuan.toLocaleString('zh-CN')}` : '';
                return (
                  <option key={c} value={c}>
                    {`${productName} · ${c}${tintSuffix}${priceSuffix}`}
                  </option>
                );
              })}
            </select>
          </label>

          {/* 可/不可染色徽标 */}
          <div className="flex flex-wrap gap-1 text-[10px]">
            {currentTintable === true ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5">
                可染色
              </span>
            ) : currentTintable === false ? (
              <span
                className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5"
                title="该折射率/膜层组合依手册不提供染色服务"
              >
                不可染色
              </span>
            ) : null}
          </div>

          {/* ── 染色复选框：tintingDisabled 时自动置灰并说明原因 ── */}
          <label
            className={`flex items-center gap-2 text-[11px] rounded-lg px-2 py-1.5 border ${
              tintingDisabled
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-white border-gray-100 text-gray-700'
            }`}
          >
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={lensCatalogTint && !tintingDisabled}
              disabled={tintingDisabled}
              onChange={(e) => onLensCatalogTintChange(e.target.checked)}
            />
            染色服务
            {tintingDisabled ? (
              <span className="font-medium text-amber-800">手册限制不可染色</span>
            ) : null}
          </label>

          <input
            value={previewPrice}
            readOnly
            disabled
            placeholder="单价（价目表）"
            className="w-full text-sm border border-dashed border-gray-300 rounded-lg px-2 py-1.5 bg-gray-50 text-gray-700"
          />
          {previewName.trim() ? (
            <p className="text-[10px] text-gray-600">
              将创建：<span className="font-medium text-gray-800">{previewName.trim()}</span>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
