'use client';

import { memo } from 'react';
import { Trash2 } from 'lucide-react';
import type { CartItem } from '@/components/cashier/cashierCartTypes';

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
        return (
          <li
            key={item.lineId}
            className={`flex items-center gap-0.5 leading-none ${
              dense ? 'min-h-[1.125rem] py-px' : 'gap-1 py-1'
            }`}
          >
            <span
              className={`min-w-0 flex-1 truncate font-medium text-gray-900 ${dense ? 'text-[10px]' : 'text-[11px]'}`}
              title={item.name}
            >
              {item.name}
            </span>
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
