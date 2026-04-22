'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { CartItem } from '@/components/cashier/cashierCartTypes';
import { isLensProduct, isRxComplete } from '@/components/cashier/cashierCartTypes';
import type { LensTintPreset } from '@/lib/fittingbox/lensTintPresets';

export type CartLineOperationsProps = {
  cart: CartItem[];
  profile: { role: string } | null;
  allowSalesEdit: boolean;
  lensTintOptions: LensTintPreset[];
  unitPriceDraftByLine: Record<string, string>;
  setUnitPriceDraftByLine: Dispatch<SetStateAction<Record<string, string>>>;
  sanitizePriceDraft: (raw: string) => string;
  updateQuantity: (lineId: string, delta: number) => void;
  patchDiscount: (lineId: string, value: number) => void;
  patchOwnerPrice: (lineId: string, raw: string) => void;
  patchTintInfo: (lineId: string, presetId: string) => void;
  openRxEditor: (lineId: string) => void;
};

/** 原中间购物车：折扣/改价/染色/验光，并入左侧动线 */
export function CartLineOperations({
  cart,
  profile,
  allowSalesEdit,
  lensTintOptions,
  unitPriceDraftByLine,
  setUnitPriceDraftByLine,
  sanitizePriceDraft,
  updateQuantity,
  patchDiscount,
  patchOwnerPrice,
  patchTintInfo,
  openRxEditor,
}: CartLineOperationsProps) {
  if (cart.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-6 text-center text-xs text-gray-500">
        无行内操作项；请从上方选品加入。
      </div>
    );
  }

  return (
    <div className="min-h-0 space-y-3 overflow-y-auto overscroll-y-contain pr-0.5 max-xl:max-h-[min(36vh,18rem)] xl:max-h-[min(42vh,22rem)]">
      {cart.map((item) => (
        <div
          key={item.lineId}
          className={`rounded-lg border p-2.5 ${
            isLensProduct(item) && !isRxComplete(item.rx)
              ? 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-100'
              : 'border-gray-100 bg-gray-50/60'
          }`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h4 className="min-w-0 flex-1 text-xs font-semibold text-gray-800">{item.name}</h4>
            <div className="flex shrink-0 items-center gap-0 overflow-hidden rounded-md border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => updateQuantity(item.lineId, -1)}
                className="p-1 text-gray-500 hover:bg-gray-100"
                aria-label="减少数量"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[1.25rem] px-1 text-center text-xs font-medium tabular-nums">{item.quantity}</span>
              <button
                type="button"
                onClick={() => updateQuantity(item.lineId, 1)}
                className="p-1 text-gray-500 hover:bg-gray-100"
                aria-label="增加数量"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {profile?.role === 'manager' ? (
              <div className="flex items-center gap-2">
                <label className="min-w-[52px] shrink-0 text-[10px] text-gray-600">折扣(%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={item.discountPercent}
                  disabled={item.allow_discount === false}
                  onChange={(e) => patchDiscount(item.lineId, Number(e.target.value))}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] disabled:bg-gray-100 disabled:text-gray-400"
                />
                {item.allow_discount === false ? (
                  <span className="shrink-0 text-[9px] text-gray-500">不可折</span>
                ) : null}
              </div>
            ) : null}
            {(profile?.role === 'owner' || allowSalesEdit) && (
              <div className="flex items-center gap-2">
                <label className="min-w-[52px] shrink-0 text-[10px] text-gray-600">改价</label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={
                    unitPriceDraftByLine[item.lineId] !== undefined
                      ? unitPriceDraftByLine[item.lineId]
                      : item.overrideUnitPrice != null
                        ? String(item.overrideUnitPrice)
                        : ''
                  }
                  onChange={(e) =>
                    setUnitPriceDraftByLine((p) => ({
                      ...p,
                      [item.lineId]: sanitizePriceDraft(e.target.value),
                    }))
                  }
                  onBlur={() => {
                    const raw = unitPriceDraftByLine[item.lineId];
                    if (raw === undefined) return;
                    patchOwnerPrice(item.lineId, raw);
                    setUnitPriceDraftByLine((p) => {
                      if (!(item.lineId in p)) return p;
                      const next = { ...p };
                      delete next[item.lineId];
                      return next;
                    });
                  }}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px]"
                  placeholder={`默认￥${item.price}`}
                />
              </div>
            )}
          </div>
          {isLensProduct(item) ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-600">镜片</p>
              <div className="rounded-md border border-emerald-100 bg-emerald-50/50 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="shrink-0 text-[10px] font-semibold text-emerald-900">染色</label>
                  <select
                    value={item.tint_info?.id || ''}
                    onChange={(e) => patchTintInfo(item.lineId, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-emerald-200 bg-white px-1.5 py-1 text-[11px]"
                  >
                    <option value="">不染色</option>
                    {lensTintOptions.map((tint) => (
                      <option key={tint.id} value={tint.id}>
                        {tint.name} ({tint.hex}) +¥{Number(tint.surchargeYuan || 0).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-2 py-1 text-[10px] text-blue-900">
                <span className="min-w-0 leading-tight">验光单</span>
                <button
                  type="button"
                  onClick={() => openRxEditor(item.lineId)}
                  className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-700"
                >
                  填写
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
