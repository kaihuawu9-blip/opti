/**
 * MATRIX_PROTOCOL_V1 — 手册 → 收银 桥接
 *
 * 手册 UI 侧点击「选定此款并加入收银」时：
 *   1) 通过 `getPageData(pdfIndex, brand)` 获得统一页面数据
 *   2) 调用 `buildCashierPayloadFromPage(...)` 合成收银 payload
 *   3) 用 `dispatchHandbookAddToCart(payload)` 发自定义事件
 *
 * 收银台（CashierPageClient）侧：
 *   - 用 `onHandbookAddToCart(handler)` 注册监听，拿到 payload 直接 addToCart
 *   - 同步带入 `tintable`（是否可染色）与 `powerRange`（光度限制）用于自动校验
 *
 * 跨品牌：payload 仅依赖 pageMap 和 priceMatrix 通用结构；新品牌的 adapter
 *   只要在 `HANDBOOK_BRAND_REGISTRY` 里注册，即可复用本桥接全部能力，无需再改 UI。
 */

import type {
  DigitalHandbookBrand,
  HandbookPageData,
} from '@/data/zeissHandbookPageMap';
import { getPageData } from '@/data/zeissHandbookPageMap';
import type {
  ZeissPowerRange,
  ZeissProductMatrix,
  ZeissSeriesSubset,
  ZeissPriceRow,
} from '@/data/zeissPriceMatrix';

export const HANDBOOK_ADD_TO_CART_EVENT = 'handbook:add-to-cart' as const;

/** 事件 payload（全品牌通用） */
export interface HandbookCartPayload {
  /** 品牌键（与 DigitalHandbookBrand 对齐） */
  brand: DigitalHandbookBrand;
  /** 中文品牌名：蔡司 / 依视路 / 豪雅 */
  brandLabel: string;
  /** 产品名（= 价目矩阵 productName；= dataAnchor） */
  productName: string;
  /** 子系列名（变色 / 偏光 / 标配 …），可空 */
  subsetName: string | null;
  /** 折射率，如 1.6 / 1.67 */
  index: number;
  /** 膜层中文名 */
  coating: string;
  /** 膜层英文代号 */
  coatingCode: string | null;
  /** 零售价（元） */
  retailYuan: number;
  /** 是否可染色（染色服务可叠加） */
  tintable: boolean;
  /** 光度适用范围（rect 包络，缺失则 null） */
  powerRange: ZeissPowerRange | null;
  /** 源自哪一页（物理页码） */
  sourcePdfIndex: number;
  /** 源自哪一印刷页标签（如 'P05'） */
  sourcePrintedLabel: string | null;
}

const BRAND_LABEL: Record<DigitalHandbookBrand, string> = {
  zeiss: '蔡司',
  essilor: '依视路',
  hoya: '豪雅',
};

/** 选择最具代表性的一行（默认优先：标配子系列 + 最低折射率），供「一键加入」使用 */
function pickDefaultRow(product: ZeissProductMatrix): {
  subset: ZeissSeriesSubset;
  row: ZeissPriceRow;
} | null {
  const subsets = product.series ?? [];
  if (!subsets.length) return null;
  const preferred =
    subsets.find((s) => !s.colorFeature) ??
    subsets.find((s) => s.colorFeature == null) ??
    subsets[0];
  const rows = preferred.rows ?? [];
  if (!rows.length) return null;
  const sortedByIndex = [...rows].sort(
    (a, b) => Number(a.index) - Number(b.index),
  );
  return { subset: preferred, row: sortedByIndex[0]! };
}

/**
 * 根据 `HandbookPageData` + 可选的（子系列 / 折射率 / 膜层）偏好，合成 payload。
 * 若未指定偏好，走 `pickDefaultRow`（标配 + 最低折射率）。
 */
export function buildCashierPayloadFromPage(
  page: HandbookPageData,
  preference?: {
    subsetName?: string;
    index?: number;
    coatingCodeOrName?: string;
  },
): HandbookCartPayload | null {
  const product = page.product;
  if (!page.dataAnchor || !product) return null;
  let subset: ZeissSeriesSubset | undefined;
  let row: ZeissPriceRow | undefined;
  if (preference?.subsetName) {
    subset = product.series.find((s) => s.name === preference.subsetName);
  }
  if (!subset) subset = product.series.find((s) => !s.colorFeature) ?? product.series[0];
  if (!subset) return null;
  if (preference?.index != null || preference?.coatingCodeOrName) {
    const idx = preference?.index;
    const ct = preference?.coatingCodeOrName?.trim();
    row = subset.rows.find(
      (r) =>
        (idx == null || Number(r.index) === Number(idx)) &&
        (!ct || r.coating === ct || r.coatingCode === ct),
    );
  }
  if (!row) {
    const picked = pickDefaultRow(product);
    if (!picked) return null;
    subset = picked.subset;
    row = picked.row;
  }
  const powerRange =
    product.powerRanges?.[String(row.index)] ?? null;
  return {
    brand: page.brand,
    brandLabel: BRAND_LABEL[page.brand] ?? page.brand,
    productName: page.dataAnchor,
    subsetName: subset.name || null,
    index: Number(row.index),
    coating: row.coating,
    coatingCode: row.coatingCode ?? null,
    retailYuan: Number(row.retailYuan) || 0,
    tintable: Boolean(row.tintable),
    powerRange,
    sourcePdfIndex: page.pdfIndex,
    sourcePrintedLabel: page.printedLabel,
  };
}

/** 直接基于 `(pdfIndex, brand)` 合成 payload（会内部调用 `getPageData`） */
export function buildCashierPayloadFromPdfIndex(
  pdfIndex: number,
  brand: DigitalHandbookBrand = 'zeiss',
  preference?: Parameters<typeof buildCashierPayloadFromPage>[1],
): HandbookCartPayload | null {
  const page = getPageData(pdfIndex, brand);
  if (!page) return null;
  return buildCashierPayloadFromPage(page, preference);
}

/** 触发加入收银的自定义事件（供手册 UI 调用） */
export function dispatchHandbookAddToCart(payload: HandbookCartPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<HandbookCartPayload>(HANDBOOK_ADD_TO_CART_EVENT, {
      detail: payload,
    }),
  );
}

export type HandbookAddToCartHandler = (payload: HandbookCartPayload) => void;

/** 注册监听器（供 CashierPageClient 使用，返回取消函数） */
export function onHandbookAddToCart(handler: HandbookAddToCartHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const cb = (e: Event) => {
    const ce = e as CustomEvent<HandbookCartPayload>;
    if (ce?.detail) handler(ce.detail);
  };
  window.addEventListener(HANDBOOK_ADD_TO_CART_EVENT, cb as EventListener);
  return () =>
    window.removeEventListener(HANDBOOK_ADD_TO_CART_EVENT, cb as EventListener);
}

/* ─── 全屏感应层：页面点击坐标广播 ───────────────────────────────────────── */

/**
 * 点击页面时广播的比例语义坐标（StandardEye 4.0）。
 * 供全屏「收银映射」等上层逻辑消费，与 {@link HandbookCartPayload} 解耦。
 */
export interface HandbookPageClickCoord {
  /** 翻页引擎 0-based 左页下标（与 StPageFlip `e.data` 一致） */
  pageIndex0: number;
  /** 点击位于左页还是右页 */
  side: 'left' | 'right';
  /** 单页内相对 X（0.0–1.0，左 → 右） */
  relX: number;
  /** 单页内相对 Y（0.0–1.0，上 → 下） */
  relY: number;
  /** 相对 `window.innerWidth`（StandardEye 4.0 Hard-Fill 指纹分母） */
  screenRelX: number;
  /** 相对 `window.innerHeight` */
  screenRelY: number;
  /** 跨幅书槽 bbox 内横向比 */
  spreadRelX: number;
  /** 跨幅书槽 bbox 内纵向比 */
  spreadRelY: number;
  /** @deprecated 恒等于 relX；非 PDF 像素 */
  physX: number;
  /** @deprecated 恒等于 relY */
  physY: number;
  brand: DigitalHandbookBrand;
  /** 1-based 左页 PDF 页码 */
  pdfPage1Left: number;
}

export const HANDBOOK_PAGE_CLICK_EVENT = 'handbook:page-click' as const;

/** 全屏感应层点击 → 广播坐标（供上层「坐标收银」消费） */
export function dispatchHandbookPageClick(coord: HandbookPageClickCoord): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<HandbookPageClickCoord>(HANDBOOK_PAGE_CLICK_EVENT, { detail: coord }),
  );
}

export type HandbookPageClickHandler = (coord: HandbookPageClickCoord) => void;

/** 注册页面坐标点击监听（返回取消函数） */
export function onHandbookPageClick(handler: HandbookPageClickHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const cb = (e: Event) => {
    const ce = e as CustomEvent<HandbookPageClickCoord>;
    if (ce?.detail) handler(ce.detail);
  };
  window.addEventListener(HANDBOOK_PAGE_CLICK_EVENT, cb as EventListener);
  return () => window.removeEventListener(HANDBOOK_PAGE_CLICK_EVENT, cb as EventListener);
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** 将 payload 合成为一个可直接传给 CartItem 的「镜片 Product」快照；非 UUID id 代表非库存入账行 */
export function toCashierLensProduct(payload: HandbookCartPayload): {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  brand: string;
  model: string;
  lens_type: string;
  /** 非标准字段，挂在 Product 上用于后续校验；CartItem 兼容展开 */
  ext_handbook_index: number;
  ext_handbook_coating: string;
  ext_handbook_tintable: boolean;
  ext_handbook_power_range: ZeissPowerRange | null;
  ext_handbook_brand: DigitalHandbookBrand;
  ext_handbook_page: number;
} {
  const { brandLabel, productName, subsetName, index, coating, retailYuan, tintable, powerRange, brand, sourcePdfIndex } = payload;
  const subsetSuffix = subsetName ? ` · ${subsetName}` : '';
  return {
    id: `handbook:${brand}:${productName}:${subsetName ?? 'default'}:${index}:${coating}`,
    name: `${brandLabel} ${productName}${subsetSuffix} ${index} · ${coating}`,
    price: retailYuan,
    stock: 9999,
    category: '镜片',
    brand: brandLabel,
    model: `${productName}${subsetSuffix}`,
    lens_type: `${index} · ${coating}`,
    ext_handbook_index: index,
    ext_handbook_coating: coating,
    ext_handbook_tintable: tintable,
    ext_handbook_power_range: powerRange,
    ext_handbook_brand: brand,
    ext_handbook_page: sourcePdfIndex,
  };
}
