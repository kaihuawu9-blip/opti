'use client';

import { useEffect, useMemo } from 'react';
import { groupMatrixProductsForCashierSelect } from '@/data/zeissHandbookPageMap';
import {
  ZEISS_PRICE_MATRIX,
  listCoatingsForProductIndex,
  listIndicesForProduct,
  listUniqueMatrixBrandKeys,
  matrixBrandDisplayLabel,
  matrixProductBrandKey,
} from '@/data/zeissPriceMatrix';
import {
  coatingsForMatrixIndexDetailed,
  isZeissTintingDisabled,
  zeissTintFlagFor,
} from '@/lib/priceListEngine';
import { matrixProductMatchesFuzzySearch } from '@/lib/catalog/zeissMatrixFuzzySearch';

/** 矩阵品牌键（与 `ZeissProductMatrix.brand` / 缺省 ZEISS 对齐） */
export type MatrixBrandKey = string;

export type LensSelectionSectionProps = {
  brand: MatrixBrandKey;
  onBrandChange: (b: MatrixBrandKey) => void;
  search: string;
  onSearchChange: (v: string) => void;
  productName: string;
  onProductNameChange: (name: string) => void;
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
  search,
  onSearchChange,
  productName,
  onProductNameChange,
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

  const filteredProducts = useMemo(() => {
    const k = search.trim().toLowerCase();
    const base = matrixRowsForBrand;
    const f = k ? base.filter((p) => matrixProductMatchesFuzzySearch(p, k)) : [...base];
    const cur = base.find((p) => p.productName === productName);
    if (cur && !f.some((p) => p.productName === cur.productName)) {
      return [cur, ...f];
    }
    return f;
  }, [matrixRowsForBrand, search, productName]);

  useEffect(() => {
    if (!brandHasProducts) return;
    if (filteredProducts.length === 0) return;
    if (!filteredProducts.some((p) => p.productName === productName)) {
      onProductNameChange(filteredProducts[0]!.productName);
    }
  }, [brand, brandHasProducts, filteredProducts, productName, onProductNameChange, search]);

  const groupedProducts = useMemo(
    () => groupMatrixProductsForCashierSelect(filteredProducts),
    [filteredProducts],
  );

  const indexOptions = useMemo(() => {
    if (!productName) return [] as number[];
    return listIndicesForProduct(productName);
  }, [productName]);

  const coatingOptions = useMemo(() => {
    if (!productName || indexStr === '') return [] as string[];
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return [];
    return listCoatingsForProductIndex(productName, idx);
  }, [productName, indexStr]);

  const coatingMeta = useMemo(() => {
    if (!productName || indexStr === '') return [];
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return [];
    return coatingsForMatrixIndexDetailed(productName, idx);
  }, [productName, indexStr]);

  const currentTintable = useMemo(() => {
    if (!productName || !coating || indexStr === '') return null;
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return null;
    return zeissTintFlagFor(productName, '', idx, coating);
  }, [productName, indexStr, coating]);

  const tintingDisabled = useMemo(() => {
    if (!productName || !coating || indexStr === '') return false;
    const idx = Number(indexStr);
    if (!Number.isFinite(idx)) return false;
    return isZeissTintingDisabled(productName, '', idx, coating);
  }, [productName, indexStr, coating]);

  useEffect(() => {
    if (tintingDisabled) onLensCatalogTintChange(false);
  }, [tintingDisabled, onLensCatalogTintChange]);

  return (
    <div className="space-y-2">
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
          <code className="text-[10px]">2026_price_matrix.json</code> 写入对应 <code className="text-[10px]">brand</code>{' '}
          与产品后重载，或暂用「自由填报」。
        </p>
      ) : null}

      {brandHasProducts ? (
        <>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索品种（实时过滤下方列表）"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
          />
          <label className="block text-[11px] text-gray-600">
            品种（与矩阵 1:1）
            <select
              value={
                filteredProducts.some((p) => p.productName === productName)
                  ? productName
                  : filteredProducts[0]?.productName ?? ''
              }
              onChange={(e) => onProductNameChange(e.target.value)}
              disabled={filteredProducts.length === 0}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {filteredProducts.length === 0 ? <option value="">无匹配品种</option> : null}
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
          <label className="block text-[11px] text-gray-600">
            膜层
            <select
              value={coating}
              onChange={(e) => onCoatingChange(e.target.value)}
              disabled={!productName || indexStr === '' || coatingOptions.length === 0}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
            >
              {coatingOptions.map((c) => {
                const meta = coatingMeta.find((m) => m.coating === c);
                const label = meta?.hint ? `${c}（${meta.hint}）` : c;
                return (
                  <option key={c} value={c}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
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
          <label
            className={`flex items-center gap-2 text-[11px] ${tintingDisabled ? 'text-gray-400' : 'text-gray-700'}`}
          >
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={lensCatalogTint && !tintingDisabled}
              disabled={tintingDisabled}
              onChange={(e) => onLensCatalogTintChange(e.target.checked)}
            />
            染色
            {tintingDisabled ? <span className="text-amber-800">手册限制不可染色</span> : null}
          </label>
          <p className="text-[10px] text-gray-500 leading-snug">
            品种列表 = <code className="text-[10px]">ZEISS_PRICE_MATRIX.filter(brand)</code>
            ；分组依据 <code className="text-[10px]">zeissHandbookPageMap</code> 的 section。光度核对在验光单保存时进行。
          </p>
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
