'use client';

import { memo } from 'react';
import {
  type CartItem,
  type RxEye,
  isCustomComboLine,
  isLensProduct,
  isRxComplete,
} from '@/components/cashier/cashierCartTypes';

/** 单眼验光字段压缩为短片段（无标签） */
export function rxEyeCompactParts(eye: RxEye): string[] {
  const ds = String(eye.ds).trim();
  const dc = String(eye.dc).trim();
  const axis = String(eye.axis).trim();
  const va = String(eye.va).trim();
  const pd = String(eye.pd).trim();
  const add = String(eye.add).trim();
  const bits: string[] = [];
  if (ds) bits.push(`DS${ds}`);
  if (dc) bits.push(`DC${dc}`);
  if (axis) bits.push(`C${axis}`);
  if (va) bits.push(`VA${va}`);
  if (pd) bits.push(`PD${pd}`);
  if (add) bits.push(`ADD${add}`);
  return bits;
}

/** 单眼只读摘要（标签 + 压缩字段） */
export function formatEyeRxReadonly(label: string, eye: RxEye): string {
  const bits = rxEyeCompactParts(eye);
  if (bits.length === 0) return `${label} —`;
  return `${label} ${bits.join('/')}`;
}

/** OD/OS 合并单行；内部复用 formatEyeRxReadonly */
export function formatBothEyesRxOneLine(rx: CartItem['rx']): string {
  return `${formatEyeRxReadonly('OD', rx.right)} · ${formatEyeRxReadonly('OS', rx.left)}`;
}

export type ReadonlyCartBlockProps = {
  cart: CartItem[];
  getFinalUnitPrice: (item: CartItem) => number;
  getBaseUnitPrice: (item: CartItem) => number;
  /** 逗号分隔 lineId，用于结算前验光缺失红框（空串表示无） */
  highlightLineIdsKey?: string;
  /** 点击该行打开验光编辑（镜片 / 自主配镜等需处方行） */
  onEditRx?: (lineId: string) => void;
};

function lineSupportsRxEditor(item: CartItem): boolean {
  return isLensProduct(item) || isCustomComboLine(item);
}

function ReadonlyCartBlockInner({
  cart,
  getFinalUnitPrice,
  getBaseUnitPrice,
  highlightLineIdsKey = '',
  onEditRx,
}: ReadonlyCartBlockProps) {
  const highlightIds =
    highlightLineIdsKey.length > 0 ? new Set(highlightLineIdsKey.split(',').filter(Boolean)) : null;
  if (cart.length === 0) {
    return <p className="text-xs leading-tight text-gray-500">暂无商品</p>;
  }
  return (
    <div className="space-y-1.5">
      {cart.map((item) => {
        const unit = getFinalUnitPrice(item);
        const line = unit * item.quantity;
        const metaBrand =
          [item.brand?.trim(), item.model?.trim()].filter(Boolean).join(' · ') || null;
        const metaCat =
          [item.category?.trim(), item.frame_type?.trim(), item.lens_type?.trim()].filter(Boolean).join(' · ') ||
          null;
        const priceNote = `标价￥${Number(item.price).toFixed(2)} · 基础￥${getBaseUnitPrice(item).toFixed(2)}${
          item.discountPercent ? ` · 折扣${item.discountPercent}%` : ''
        }${item.overrideUnitPrice != null ? ` · 改价￥${item.overrideUnitPrice}` : ''}`;
        const tintNote = isLensProduct(item)
          ? Number(item.tint_info?.surchargeYuan || 0) > 0
            ? `染色：${item.tint_info?.name ?? '—'} +￥${Number(item.tint_info?.surchargeYuan || 0).toFixed(2)}/片`
            : '染色：未选'
          : null;
        const rxOne =
          isLensProduct(item) || isCustomComboLine(item) ? formatBothEyesRxOneLine(item.rx) : null;
        const showRxDegreeBlock = isLensProduct(item) || isCustomComboLine(item);
        const rxWarn = highlightIds?.has(item.lineId) ?? false;
        const rxEditable = Boolean(onEditRx) && lineSupportsRxEditor(item);
        const ocrEv = String(item.ocr_evidence_url || '').trim();
        const nameTitle = ocrEv ? `${item.name}\nOCR 存证：${ocrEv}` : item.name;
        const shellClass = `rounded-md border bg-white px-2 py-1 leading-tight text-stone-700 shadow-sm ${
          rxWarn ? 'border-red-500 ring-2 ring-red-500/90' : 'border-stone-200/90'
        } ${rxEditable ? 'cursor-pointer transition hover:bg-stone-50/90 hover:shadow-md active:scale-[0.99]' : ''}`;
        const inner = (
          <>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 border-b border-stone-100 pb-1 text-[11px]">
              <span className="min-w-0 flex-1 font-semibold text-stone-900" title={nameTitle}>
                {item.name}
              </span>
              <span className="shrink-0 text-[10px] text-stone-300">|</span>
              <span className="shrink-0 tabular-nums text-stone-600">
                ￥{unit.toFixed(2)} × {item.quantity} ={' '}
                <span className="font-bold text-stone-900">￥{line.toFixed(2)}</span>
              </span>
            </div>
            {metaBrand ? (
              <p className="mt-0.5 text-[10px] leading-tight text-stone-500">品牌/型号/备注 · {metaBrand}</p>
            ) : null}
            {metaCat ? (
              <p className="mt-0.5 text-[10px] leading-tight text-stone-500">属性 · {metaCat}</p>
            ) : null}
            <p className="mt-0.5 text-[10px] leading-tight text-stone-500">{priceNote}</p>
            {tintNote ? <p className="mt-0.5 text-[10px] leading-tight text-stone-500">{tintNote}</p> : null}
            {showRxDegreeBlock ? (
              rxOne ? (
                <p className="mt-0.5 truncate font-mono text-[10px] leading-none text-stone-800" title={rxOne}>
                  度数 · {rxOne}
                </p>
              ) : isCustomComboLine(item) ? (
                <p className="mt-0.5 text-[10px] leading-tight text-amber-700">自主配镜 · 验光待填</p>
              ) : (
                <p className="mt-0.5 text-[10px] leading-tight text-stone-400">镜片行 · 度数待填</p>
              )
            ) : null}
            <p className="mt-1">
              <span
                className={`inline-block rounded px-1 py-px text-[10px] leading-none ${
                  isCustomComboLine(item)
                    ? isRxComplete(item.rx)
                      ? 'bg-violet-100 text-violet-800'
                      : 'bg-amber-100 text-amber-800'
                    : isLensProduct(item)
                      ? isRxComplete(item.rx)
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                      : 'bg-stone-100 text-stone-600'
                }`}
              >
                {isCustomComboLine(item)
                  ? isRxComplete(item.rx)
                    ? '自主配镜 · 验光齐'
                    : '自主配镜 · 缺验光'
                  : isLensProduct(item)
                    ? isRxComplete(item.rx)
                      ? '验光齐'
                      : '缺验光'
                    : '零售商品'}
              </span>
            </p>
          </>
        );
        if (rxEditable && onEditRx) {
          return (
            <button
              key={item.lineId}
              type="button"
              id={`cashier-readonly-line-${item.lineId}`}
              className={`${shellClass} block w-full text-left`}
              onClick={() => onEditRx(item.lineId)}
              aria-label={`编辑验光：${item.name}`}
            >
              {inner}
            </button>
          );
        }
        return (
          <div key={item.lineId} id={`cashier-readonly-line-${item.lineId}`} className={shellClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function propsEqual(prev: ReadonlyCartBlockProps, next: ReadonlyCartBlockProps): boolean {
  if (prev.cart !== next.cart) return false;
  if (prev.getFinalUnitPrice !== next.getFinalUnitPrice) return false;
  if (prev.getBaseUnitPrice !== next.getBaseUnitPrice) return false;
  if ((prev.highlightLineIdsKey ?? '') !== (next.highlightLineIdsKey ?? '')) return false;
  if (prev.onEditRx !== next.onEditRx) return false;
  return true;
}

/** 左侧只读核对区（memo + 自定义比较，减少与结算区无关的全局重绘） */
export const ReadonlyCartBlock = memo(ReadonlyCartBlockInner, propsEqual);
ReadonlyCartBlock.displayName = 'ReadonlyCartBlock';

/** 兼容旧命名 */
export const CashierLeftReadonlyCartBlock = ReadonlyCartBlock;
