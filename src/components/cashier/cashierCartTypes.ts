/**
 * 收银台购物车行：类型与纯函数（供页面、只读核对区、快捷结算列表共用）
 */

export const CUSTOM_COMBO_CATEGORY = '自主配镜';

export type RxEye = {
  ds: string;
  dc: string;
  axis: string;
  va: string;
  pd: string;
  add: string;
};

/** 与库存商品字段对齐，供 CartItem 继承 */
export type CashierProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  allow_discount?: boolean | null;
  allow_points?: boolean | null;
  allow_promo_price?: boolean | null;
  is_hot?: boolean | null;
  is_promo?: boolean | null;
  promo_price?: number | null;
  low_stock_threshold?: number | null;
  /** 自定义商品 OCR 存证（如 /recordings/frame_*.jpg），写入库存 attributes 并随购物车保留 */
  ocr_evidence_url?: string | null;
};

/** 页面内沿用 Product 命名时可等价于 CashierProduct */
export type Product = CashierProduct;

export type CartItem = CashierProduct & {
  lineId: string;
  quantity: number;
  rx: { right: RxEye; left: RxEye };
  discountPercent: number;
  overrideUnitPrice?: number | null;
  tint_info?: {
    id: string;
    name: string;
    hex: string;
    surchargeYuan: number;
  } | null;
  /** 历史草稿/挂单：曾用快充行，仅用于恢复时过滤 */
  isQuickSale?: boolean;
  /** 自主配镜行：手写镜框+镜片+成套价 */
  isCustomCombo?: boolean;
  /**
   * 收银「价目矩阵」镜片行：保存验光单时用 productName+index 拉取 powerRanges 做光度包络校验。
   * 仅运行时挂在购物车行，不落库。
   */
  zeiss_matrix_rx_ref?: {
    productName: string;
    index: number;
    coating: string;
  } | null;
};

export function isLensProduct(p: Pick<CartItem, 'category' | 'lens_type' | 'name' | 'frame_type'>): boolean {
  const cat = (p.category || '').trim();
  if (cat === '套餐') return true;
  /** 自主配镜：镜框、镜片均可空（仅服务费/待补录）时不按配镜处方行校验 */
  if (cat === CUSTOM_COMBO_CATEGORY) {
    const hasFrame = String(p.frame_type || '').trim();
    const hasLens = String(p.lens_type || '').trim();
    if (!hasFrame && !hasLens) return false;
    return true;
  }
  return Boolean(p.lens_type) || cat.includes('镜片') || p.name.toLowerCase().includes('镜片');
}

export function isCustomComboLine(item: CartItem): boolean {
  return Boolean(item.isCustomCombo || (item.category || '').trim() === CUSTOM_COMBO_CATEGORY);
}

function isEyeRxComplete(eye: RxEye): boolean {
  const ds = String(eye.ds).trim();
  const pd = String(eye.pd).trim();
  if (!ds || !pd) return false;
  const dc = String(eye.dc).trim();
  const axis = String(eye.axis).trim();
  if (dc !== '' && !axis) return false;
  return true;
}

export function isRxComplete(rx: CartItem['rx']): boolean {
  return isEyeRxComplete(rx.right) && isEyeRxComplete(rx.left);
}
