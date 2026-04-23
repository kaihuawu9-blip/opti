'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CartItem } from '@/components/cashier/cashierCartTypes';

/** 快捷结算行：悬停「存证」徽标展示 OCR 原图预览（同源 pathname） */
function OcrEvidenceHoverPreview({ url, dense }: { url: string; dense: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const onImgError = useCallback(() => setImgOk(false), []);
  useEffect(() => {
    setImgOk(true);
  }, [url]);
  const chipCls = dense
    ? 'px-0.5 py-px text-[8px] leading-none'
    : 'px-1 py-0.5 text-[9px] leading-tight';

  return (
    <span className="group/ev relative inline-flex shrink-0">
      <span
        className={`cursor-help rounded border border-blue-200 bg-blue-50/95 font-medium text-blue-700 ${chipCls}`}
        title={`悬停预览存证图：${url}`}
      >
        存证
      </span>
      <div
        className="pointer-events-none invisible absolute top-full right-0 z-[100] mt-0.5 w-44 rounded-md border border-gray-200 bg-white p-1 opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity duration-150 group-hover/ev:visible group-hover/ev:opacity-100 sm:w-48"
        role="tooltip"
        aria-hidden
      >
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地 public/recordings 存证，需原生 img 悬停即显
          <img
            src={url}
            alt=""
            className="max-h-52 w-full rounded object-contain"
            onError={onImgError}
          />
        ) : (
          <p className="px-1 py-2 text-center text-[10px] text-amber-700">图片无法加载</p>
        )}
        <p className="max-w-[11rem] truncate px-0.5 pt-0.5 text-[8px] leading-tight text-gray-500" title={url}>
          {url}
        </p>
      </div>
    </span>
  );
}

export type QuickCheckoutListProps = {
  cart: CartItem[];
  getFinalUnitPrice: (item: CartItem) => number;
  onRemove: (lineId: string) => void;
  /** 收银右侧：更矮行高，便于大屏首屏容纳更多行 */
  density?: 'default' | 'dense';
};

function QuickCheckoutListInner({
  cart,
  getFinalUnitPrice,
  onRemove,
  density = 'default',
}: QuickCheckoutListProps) {
  const dense = density === 'dense';
  if (cart.length === 0) {
    return (
      <p className={`text-center leading-none text-gray-400 ${dense ? 'py-0.5 text-[10px]' : 'py-1 text-[11px]'}`}>
        暂无商品
      </p>
    );
  }
  return (
    <ul className={`divide-y divide-gray-100/90 ${dense ? 'leading-none' : ''}`}>
      {cart.map((item) => {
        const unit = getFinalUnitPrice(item);
        const ev = String(item.ocr_evidence_url || '').trim();
        const nameTitle = ev ? `${item.name}\nOCR 存证：${ev}` : item.name;
        return (
          <li
            key={item.lineId}
            className={`flex items-center gap-0.5 leading-none ${
              dense ? 'min-h-[1.125rem] py-px' : 'gap-1 py-1'
            }`}
          >
            <span
              className={`min-w-0 flex-1 truncate font-medium text-gray-900 ${dense ? 'text-[10px]' : 'text-[11px]'}`}
              title={nameTitle}
            >
              {item.name}
            </span>
            {ev ? <OcrEvidenceHoverPreview url={ev} dense={dense} /> : null}
            <span className="shrink-0 text-[10px] font-light text-gray-300" aria-hidden>
              |
            </span>
            <span className={`shrink-0 tabular-nums text-gray-600 ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
              ￥{unit.toFixed(2)} × {item.quantity}
            </span>
            <span className="shrink-0 text-[10px] font-light text-gray-300" aria-hidden>
              |
            </span>
            <button
              type="button"
              onClick={() => onRemove(item.lineId)}
              className={`inline-flex shrink-0 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 ${
                dense ? 'h-5 w-5' : 'h-6 w-6'
              }`}
              aria-label={`删除 ${item.name}`}
            >
              <Trash2 className={dense ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function propsEqual(prev: QuickCheckoutListProps, next: QuickCheckoutListProps): boolean {
  if (prev.cart !== next.cart) return false;
  if (prev.getFinalUnitPrice !== next.getFinalUnitPrice) return false;
  if (prev.onRemove !== next.onRemove) return false;
  if (prev.density !== next.density) return false;
  return true;
}

/** 右侧 / 抽屉快捷结算行列表 */
export const QuickCheckoutList = memo(QuickCheckoutListInner, propsEqual);
QuickCheckoutList.displayName = 'QuickCheckoutList';
