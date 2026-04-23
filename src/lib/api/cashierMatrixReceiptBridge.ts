/**
 * 收银台 ↔ 数据海关桥接：价目矩阵行（`zeiss_matrix_rx_ref`）→ `adaptOcrToOrderItemStrict` → 行业小票载荷。
 * 不修改 `dataAdapter.ts` 内校验与运算，仅做字段映射与数量倍率。
 */

import type { CartItem } from '@/components/cashier/cashierCartTypes';
import { isLensProduct } from '@/components/cashier/cashierCartTypes';
import {
  adaptOcrToOrderItemStrict,
  composeEyewearReceiptPayload,
  type AdaptInput,
  type EyewearOrderItem,
  type EyewearReceiptPayload,
  type OcrFieldKey,
  type OcrFieldValue,
  type ReceiptMeta,
  isDataAdapterError,
  MissingFieldError,
  InvalidFieldError,
  SkuNotFoundError,
} from '@/lib/api/dataAdapter';
import {
  listCoatingsForProductIndex,
  listIndicesForProduct,
  listZeissProductNames,
} from '@/data/zeissPriceMatrix';

function formatAdapterLineError(e: unknown, lineLabel: string): string {
  const prefix = `「${lineLabel}」`;
  if (e instanceof MissingFieldError) return `${prefix}${e.message}`;
  if (e instanceof InvalidFieldError) return `${prefix}${e.message}`;
  if (e instanceof SkuNotFoundError) return `${prefix}${e.message}`;
  if (isDataAdapterError(e)) return `${prefix}${e.message}`;
  return `${prefix}${e instanceof Error ? e.message : String(e)}`;
}

/** 从购物车行构造 strict 适配入参（仅含 OCR 字段字典，无业务 `any`） */
export function cartMatrixLineToAdaptInput(item: CartItem): AdaptInput | null {
  if (!isLensProduct(item) || !item.zeiss_matrix_rx_ref) return null;
  const ref = item.zeiss_matrix_rx_ref;
  const { right, left } = item.rx;

  const fields: Partial<Record<OcrFieldKey, OcrFieldValue>> = {
    SERIES: ref.productName,
    INDEX: ref.index,
    COATING: ref.coating,
    OD_SPH: right.ds,
    OS_SPH: left.ds,
  };

  const rDc = String(right.dc ?? '').trim();
  const lDc = String(left.dc ?? '').trim();
  fields.OD_CYL = rDc === '' ? 0 : right.dc;
  fields.OD_AXIS = rDc === '' ? 0 : right.axis;
  fields.OS_CYL = lDc === '' ? 0 : left.dc;
  fields.OS_AXIS = lDc === '' ? 0 : left.axis;

  const rAdd = String(right.add ?? '').trim();
  const lAdd = String(left.add ?? '').trim();
  if (rAdd !== '') fields.OD_ADD = right.add;
  if (lAdd !== '') fields.OS_ADD = left.add;

  fields.OD_PD = right.pd;
  fields.OS_PD = left.pd;

  const b = String(item.brand ?? '').trim();
  if (b) fields.BRAND = b;
  const lt = String(item.lens_type ?? '').trim();
  if (lt) fields.LENS_TYPE = lt;

  return { ocr: { source: 'manual', fields } };
}

function scaleOrderItemByQuantity(
  order: EyewearOrderItem,
  quantity: number,
  lineDiscountedTotalYuan: number,
): EyewearOrderItem {
  const q = Math.max(1, Math.floor(Number(quantity)) || 1);
  if (q === 1) {
    return {
      ...order,
      price: {
        ...order.price,
        discountedYuan: lineDiscountedTotalYuan,
      },
    };
  }
  const retail = Number(order.price.retailYuan);
  const proc = Number(order.price.processingFeeYuan);
  return {
    ...order,
    price: {
      ...order.price,
      retailYuan: (Number.isFinite(retail) ? retail : 0) * q,
      discountedYuan: lineDiscountedTotalYuan,
      processingFeeYuan: (Number.isFinite(proc) ? proc : 0) * q,
    },
  };
}

export type MatrixThermalReceiptBuildResult = {
  /** 非空时表示热敏/兼容打印可消费 `EyewearReceiptPayload` */
  payload: EyewearReceiptPayload | null;
  /** 任意矩阵行 strict 失败时收集人类可读原因（不阻断结算） */
  errors: string[];
};

/**
 * 从已快照的结算购物车构造行业小票载荷。
 * 仅处理带 `zeiss_matrix_rx_ref` 的镜片行；无此类行时返回 `payload: null` 且 `errors: []`。
 */
export function tryBuildEyewearReceiptFromMatrixCart(params: {
  cart: readonly CartItem[];
  meta: ReceiptMeta;
  getFinalUnitPrice: (item: CartItem) => number;
}): MatrixThermalReceiptBuildResult {
  const matrixLines = params.cart.filter((item) => cartMatrixLineToAdaptInput(item) != null);
  if (matrixLines.length === 0) {
    return { payload: null, errors: [] };
  }

  const errors: string[] = [];
  const items: EyewearOrderItem[] = [];

  for (const item of matrixLines) {
    const input = cartMatrixLineToAdaptInput(item);
    if (!input) continue;
    const label = item.name.trim() || item.zeiss_matrix_rx_ref?.productName || '镜片';
    try {
      const r = adaptOcrToOrderItemStrict(input);
      const lineTotal = params.getFinalUnitPrice(item) * item.quantity;
      items.push(scaleOrderItemByQuantity(r.order, item.quantity, lineTotal));
    } catch (e) {
      errors.push(formatAdapterLineError(e, label));
    }
  }

  if (errors.length > 0) {
    return { payload: null, errors };
  }

  return {
    payload: composeEyewearReceiptPayload(items, params.meta),
    errors: [],
  };
}

// ─── 异常模拟（开发 / 联调用）：验证收银提示链路 ─────────────────────────────

function pickDemoSeriesCoatingIndex(): { series: string; index: number; coating: string } {
  const names = listZeissProductNames();
  const series = names[0] ?? '智锐单光';
  const indices = listIndicesForProduct(series);
  const index = (indices[0] ?? 1.6) as number;
  const coatings = listCoatingsForProductIndex(series, index);
  const coating = coatings[0] ?? '钻立方铂金膜';
  return { series, index, coating };
}

/** 应触发 `MissingFieldError`（无 PD_BINOCULAR 且无单眼 PD） */
export function runCashierAdapterDemoMissingPd(): string {
  const { series, index, coating } = pickDemoSeriesCoatingIndex();
  try {
    adaptOcrToOrderItemStrict({
      ocr: {
        source: 'manual',
        fields: {
          BRAND: '蔡司',
          SERIES: series,
          INDEX: index,
          COATING: coating,
          OD_SPH: -2,
          OD_CYL: 0,
          OD_AXIS: 90,
          OS_SPH: -2.25,
          OS_CYL: 0,
          OS_AXIS: 90,
        },
      },
    });
    return '未触发异常：请检查价目矩阵或演示数据。';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 应触发 `InvalidFieldError`（球镜非 0.25 步进） */
export function runCashierAdapterDemoInvalidSphereStep(): string {
  const { series, index, coating } = pickDemoSeriesCoatingIndex();
  try {
    adaptOcrToOrderItemStrict({
      ocr: {
        source: 'manual',
        fields: {
          BRAND: '蔡司',
          SERIES: series,
          INDEX: index,
          COATING: coating,
          OD_SPH: -3.27,
          OD_CYL: 0,
          OD_AXIS: 90,
          OD_PD: 32,
          OS_SPH: -3,
          OS_CYL: 0,
          OS_AXIS: 90,
          OS_PD: 31,
        },
      },
    });
    return '未触发异常：请检查演示数据。';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
