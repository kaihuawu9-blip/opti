'use client';

import { useState, useEffect, useRef, useMemo, useCallback, useId, type ChangeEvent } from 'react';
import { useReactToPrint } from 'react-to-print';
import { flushSync } from 'react-dom';
import { cloudRest, isCloudRestConfigured, cloudRestConfigHint } from '@/lib/cloudRest';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Printer,
  X,
  QrCode,
  User,
  ClipboardList,
  Glasses,
  Camera,
  Image as ImageIcon,
  Mic,
  PanelRight,
  Library,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useAppNavigate } from '@/lib/useAppNavigate';
import { roleNameMap } from '@/lib/permissions';
import type { PrintOrder } from '@/components/PrintTemplate';
import type { EyewearReceiptPayload, ReceiptMeta } from '@/lib/api/dataAdapter';
import {
  tryBuildEyewearReceiptFromMatrixCart,
  runCashierAdapterDemoMissingPd,
  runCashierAdapterDemoInvalidSphereStep,
  type MatrixThermalReceiptBuildResult,
} from '@/lib/api/cashierMatrixReceiptBridge';
import { ReceiptPrintBundle } from '@/components/cashier/ReceiptPrintBundle';
import { resolveStoreDisplayName } from '@/lib/storeDisplayName';
import { ReceiptDesktopPrinterBar } from '@/components/ReceiptDesktopPrinterBar';
import { buildOrderQrPayload, ORDER_QR_MAGIC, parseOrderQrPayload } from '@/lib/orderQr';
import { localCache } from '@/lib/localCache';
import {
  printReceiptViaWebBluetooth,
  printReceiptWithElectronPreference,
  setCashierBrowserPrintOverride,
} from '@/lib/receiptElectronPrint';
import { hasWebBluetooth, webBluetoothUnavailableReason } from '@/lib/webBluetoothSupport';
import { compressImageFileToJpegBlob } from '@/lib/compressImageClient';
import { runServerCashierCustomAddOcr, runServerCashierOcr } from '@/lib/cashierOcrPipeline';
import { fetchLensTintConfigClient } from '@/lib/fittingbox/lensTintConfigClient';
import type { LensTintPreset } from '@/lib/fittingbox/lensTintPresets';
import { StandardLayout } from '@/components/layout/StandardLayout';
import AppModal from '@/components/layout/AppModal';
import { DraggableRxEditorModal } from '@/components/cashier/DraggableRxEditorModal';
import type { CartItem, Product, RxEye } from '@/components/cashier/cashierCartTypes';
import { CUSTOM_COMBO_CATEGORY, isCustomComboLine, isLensProduct, isRxComplete } from '@/components/cashier/cashierCartTypes';
import { buildCashierRefractiveIndexHints } from '@/matrix/suggest-runtime';
import { ReadonlyCartBlock } from '@/components/cashier/ReadonlyCartBlock';
import { QuickCheckoutList } from '@/components/cashier/QuickCheckoutList';
import { DraggableCashierModal } from '@/components/cashier/DraggableCashierModal';
import { WebCameraCaptureModal } from '@/components/WebCameraCaptureModal';
import { CartLineOperations } from '@/components/cashier/CartLineOperations';
import '@/styles/Print.css';
import { CASHIER_OPEN_CHECKOUT_DRAWER_EVENT } from '@/lib/cashierCheckoutEvents';
// MATRIX_PROTOCOL_V1 · 手册 → 收银桥接（品牌无关，下次放入依视路只需扩 pageMap）
import { onHandbookAddToCart, toCashierLensProduct } from '@/lib/catalog/handbookCashierBridge';
import { disableAuthMode } from '@/core/auth';
import { formatMatrixLensDisplayName, type LensPriceEntryMode } from '@/lib/priceListEngine';
import { validateCartLineRxPowerEnvelope } from '@/lib/cashierRxPowerValidate';
import {
  ZEISS_PRICE_MATRIX,
  listCoatingsForProductIndex,
  listIndicesForProduct,
  listUniqueMatrixBrandKeys,
  matrixBrandDisplayLabel,
  matrixProductBrandKey,
  resolveMatrixRetailYuan,
} from '@/data/zeissPriceMatrix';
import { LensSelectionSection } from '@/components/cashier/LensSelectionSection';

/** 历史销售/挂单 JSON 中可能仍有 category「快充」，恢复购物车时剔除 */
const LEGACY_QUICK_CATEGORY = '快充';

/** 开发环境或显式开启时显示「测试一键出单」；非 UUID 行不落库存，仅用于试打小票 */
const TEST_ONE_CLICK_CHECKOUT_ENABLED =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_CHECKOUT === 'true';

/** 与 PostgreSQL uuid / Prisma 一致：8-4-4-4-12 十六进制（不强制 RFC variant，兼容各类客户端/历史数据） */
function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || '').trim());
}

/** finalizeSale 入口快照：避免 await 间隙购物车被改导致扣库/流水与 Toast 错位 */
function snapshotCartForSale(items: CartItem[]): CartItem[] {
  return items.map((item) => ({
    ...item,
    rx: {
      right: { ...item.rx.right },
      left: { ...item.rx.left },
    },
  }));
}

type CustomAddOcrExtract = Awaited<ReturnType<typeof runServerCashierCustomAddOcr>>;

/**
 * 镜片包装 OCR：将 `/api/ocr` custom_add（分类「镜片」）结果填入「自由填报」品牌/系列/折射率/膜层。
 */
function applyLensPackagingOcrToManualFields(
  r: CustomAddOcrExtract,
  set: {
    setLensManualBrand: (v: string) => void;
    setLensManualSeries: (v: string) => void;
    setLensManualIndex: (v: string) => void;
    setLensManualCoating: (v: string) => void;
  },
) {
  const { ocrMode, productName, modelLine, brand, model, size, color } = r;
  const ml = (modelLine || '').trim();
  if (ocrMode === 'temple' && (brand || model)) {
    set.setLensManualBrand((brand || '').trim());
    set.setLensManualSeries((model || productName || '').trim());
    const sz = (size || '').trim();
    set.setLensManualIndex(/\d+\.\d{2}/.test(sz) ? sz : '');
    set.setLensManualCoating((color || ml || '').trim());
    return;
  }
  const pn = (productName || '').trim();
  const segs = pn.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  if (segs.length >= 4) {
    set.setLensManualBrand(segs[0].replace(/镜片\s*$/u, '').trim());
    set.setLensManualSeries(segs[1]);
    set.setLensManualIndex(segs[2]);
    set.setLensManualCoating(segs.slice(3).join(' · '));
  } else if (segs.length === 3) {
    set.setLensManualBrand(segs[0].replace(/镜片\s*$/u, '').trim());
    set.setLensManualSeries(segs[1]);
    set.setLensManualIndex(segs[2]);
    set.setLensManualCoating(ml || '');
  } else if (segs.length === 2) {
    set.setLensManualBrand(segs[0].replace(/镜片\s*$/u, '').trim());
    set.setLensManualSeries(segs[1]);
    const mlSegs = ml.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
    if (mlSegs.length >= 2) {
      set.setLensManualIndex(mlSegs[0]);
      set.setLensManualCoating(mlSegs.slice(1).join(' · '));
    } else {
      set.setLensManualIndex(ml);
    }
  } else if (pn) {
    set.setLensManualBrand(pn.replace(/镜片\s*$/u, '').trim());
    if (ml) set.setLensManualSeries(ml);
  }
}

/**
 * 购物车行上的 OCR 存证：优先用库存/API 带回的 `product.ocr_evidence_url`，否则用收银台刚识别时的临时 URL。
 * 在 `addToCart` 里**显式赋值**，避免 `...product` 缺键或未展开到类型外字段时被丢失。
 */
function mergeOcrEvidenceUrlForCart(product: Product, fallback?: string | null): string | null {
  const fromProduct =
    product.ocr_evidence_url != null && String(product.ocr_evidence_url).trim()
      ? String(product.ocr_evidence_url).trim()
      : '';
  const fromFallback = fallback != null && String(fallback).trim() ? String(fallback).trim() : '';
  return fromProduct || fromFallback || null;
}

function genId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // RFC 4122 v4（无 randomUUID 的 HTTP/旧环境），须为合法 UUID 以便收银门店校验通过
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function withTimeoutFallback<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ProductQuickCategory = 'all' | 'frame' | 'lens' | 'package' | 'other';

function getProductQuickCategory(p: Product): ProductQuickCategory {
  const c = String(p.category || '').trim();
  const n = String(p.name || '').toLowerCase();
  if (c === '套餐' || n.includes('套餐')) return 'package';
  if (c.includes('镜框') || String(p.frame_type || '').trim()) return 'frame';
  if (c.includes('镜片') || String(p.lens_type || '').trim() || n.includes('镜片')) return 'lens';
  return 'other';
}

function productQuickCategoryLabel(cat: ProductQuickCategory): string {
  switch (cat) {
    case 'all':
      return '全部';
    case 'frame':
      return '镜框';
    case 'lens':
      return '镜片';
    case 'package':
      return '套餐';
    case 'other':
      return '其他';
    default:
      return cat;
  }
}

function filterProductsByQuickCategory(products: Product[], cat: ProductQuickCategory): Product[] {
  if (cat === 'all') return products;
  return products.filter((p) => getProductQuickCategory(p) === cat);
}

type Store = {
  id: string;
  name: string;
};

const emptyEye = (): RxEye => ({
  ds: '',
  dc: '',
  axis: '',
  va: '',
  pd: '',
  add: '',
});

/** 金额草稿：仅保留数字与最多一个小数点，避免 type=number 在 Electron/中文环境下无法键入或小数点被吞 */
function sanitizePriceDraft(raw: string): string {
  const t = raw.replace(/[^\d.]/g, '');
  const dot = t.indexOf('.');
  if (dot === -1) return t;
  return t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '');
}

/** 语音开单：优先当前验光编辑行，否则购物车中第一条需处方的商品行 */
function pickLensTargetLine(cart: CartItem[], rxEditorLineId: string | null): CartItem | undefined {
  if (rxEditorLineId) {
    const ed = cart.find((i) => i.lineId === rxEditorLineId);
    if (ed && isLensProduct(ed)) return ed;
  }
  return cart.find(isLensProduct);
}

/** 弹窗自定义商品：与快速分类对应的库存分类文案 */
function categoryLabelForQuickModal(cat: ProductQuickCategory): string {
  switch (cat) {
    case 'frame':
      return '镜框';
    case 'lens':
      return '镜片';
    case 'package':
      return '套餐';
    default:
      return '其他';
  }
}

function mergeRxEye(partial: Partial<RxEye> | undefined): RxEye {
  return { ...emptyEye(), ...partial };
}

function ocrScalarToRxString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') return v.trim();
  return '';
}

/** 与 rx-ocr 服务端均分启发一致：常见双眼总瞳距（mm），超出则提示用户确认 */
const PD_BINOCULAR_HUMANE_MIN_MM = 45;
const PD_BINOCULAR_HUMANE_MAX_MM = 85;

function parsePdMmFromOcrField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(String(v).replace(/[^\d.+-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inferBinocularPdTotalMm(result: Record<string, unknown>): number | null {
  const top = parsePdMmFromOcrField(result.pd);
  const right = (result.right && typeof result.right === 'object' ? result.right : {}) as Record<string, unknown>;
  const left = (result.left && typeof result.left === 'object' ? result.left : {}) as Record<string, unknown>;
  const rr = parsePdMmFromOcrField(right.pd);
  const ll = parsePdMmFromOcrField(left.pd);
  if (top != null) return top;
  if (rr != null && ll != null) return rr + ll;
  if (rr != null && ll == null) return rr;
  if (ll != null && rr == null) return ll;
  return null;
}

/**
 * 与 AI 服务侧一致：模型可能用 rightEye/OD 或包一层 data/result，避免 result.right 为空导致整单未填。
 */
function pickOcrResultEyeRecord(r: Record<string, unknown>, side: 'right' | 'left'): Record<string, unknown> {
  let root: Record<string, unknown> = r;
  if (!r.right && !r.left && !r.rightEye && !r.leftEye) {
    const d = r.data;
    const inner = r.result;
    if (d && typeof d === 'object' && !Array.isArray(d)) root = d as Record<string, unknown>;
    else if (inner && typeof inner === 'object' && !Array.isArray(inner)) root = inner as Record<string, unknown>;
  }
  const raw =
    side === 'right'
      ? (root.right ??
        root.Right ??
        root.rightEye ??
        root.OD ??
        root.od ??
        root['右眼'] ??
        root['右'])
      : (root.left ??
        root.Left ??
        root.leftEye ??
        root.OS ??
        root.os ??
        root['左眼'] ??
        root['左']);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** 与服务端 normalizeEye 一致：LLM 可能用 sphere / S / cyl 等而不用 ds/dc */
function mergeRxAliasesIntoStandardKeys(o: Record<string, unknown>): Record<string, unknown> {
  const m = { ...o };
  const hasVal = (v: unknown) =>
    v != null &&
    (typeof v === 'number'
      ? Number.isFinite(v)
      : typeof v === 'string' && v.trim() !== '');
  if (!hasVal(m.ds)) {
    const v = m.sphere ?? m.S ?? m.sph ?? m['SPH'] ?? m['球镜'];
    if (hasVal(v)) m.ds = v;
  }
  if (!hasVal(m.dc)) {
    const v = m.cylinder ?? m.C ?? m.cyl ?? m['CYL'] ?? m['柱镜'];
    if (hasVal(v)) m.dc = v;
  }
  if (m.axis == null || m.axis === '') {
    const a = m.A ?? m['轴位'] ?? m['轴向'] ?? m['轴线'];
    if (hasVal(a)) m.axis = a;
  }
  return m;
}

/**
 * 总瞳距若超出常见区间：确认后才回填；确认且左右 pd 仍空时按总距对半写入（与单格总瞳距一致）。
 * 在区间内：直接返回左右载荷，不弹窗。
 * 用户点「取消」时仍回填球镜/柱镜/轴等，仅去掉本行的 pd，避免整单空着。
 */
function prepareRxOcrEyesOrAbandon(result: unknown): { right: Record<string, unknown>; left: Record<string, unknown> } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const right = mergeRxAliasesIntoStandardKeys(pickOcrResultEyeRecord(r, 'right'));
  const left = mergeRxAliasesIntoStandardKeys(pickOcrResultEyeRecord(r, 'left'));
  const t = inferBinocularPdTotalMm({ ...r, right, left });
  if (t != null && (t < PD_BINOCULAR_HUMANE_MIN_MM || t > PD_BINOCULAR_HUMANE_MAX_MM)) {
    const label = t < PD_BINOCULAR_HUMANE_MIN_MM ? '偏窄' : '偏宽';
    const ok = window.confirm(
      `识别到的瞳距总距约 ${t} mm，相对常见范围 ${PD_BINOCULAR_HUMANE_MIN_MM}–${PD_BINOCULAR_HUMANE_MAX_MM} mm ${label}。\n\n点「确定」仍按识别结果填入（单格总瞳距将拆成左右各一半）；点「取消」将跳过瞳距、其余度数仍会填入。`,
    );
    if (!ok) {
      const stripPd = (o: Record<string, unknown>) => {
        const n = { ...o };
        delete n.pd;
        return n;
      };
      return { right: stripPd(right), left: stripPd(left) };
    }
    const rr = parsePdMmFromOcrField(right.pd);
    const ll = parsePdMmFromOcrField(left.pd);
    if (rr == null && ll == null && Number.isFinite(t)) {
      const half = Number((t / 2).toFixed(2));
      right.pd = half;
      left.pd = half;
    }
  }
  return { right, left };
}

function ocrEyeRecordHasUsableValue(o: Record<string, unknown>): boolean {
  for (const v of Object.values(o)) {
    if (v == null) continue;
    if (typeof v === 'object') continue;
    if (typeof v === 'number' && Number.isFinite(v)) return true;
    if (typeof v === 'string' && v.trim() !== '') return true;
  }
  return false;
}

function ocrMergedEyesMeaningful(eyes: { right: Record<string, unknown>; left: Record<string, unknown> }): boolean {
  return ocrEyeRecordHasUsableValue(eyes.right) || ocrEyeRecordHasUsableValue(eyes.left);
}

function formatOcrNoAutofillMessage(rawText: string | undefined): string {
  const t = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!t) {
    return '已识别，但本单未解出可自动填入的球镜/柱镜/轴位。请重拍、提高对比度，或手填。';
  }
  const ex = t.length > 120 ? `${t.slice(0, 120)}…` : t;
  return `已识别，但本单未解出可自动填入的球镜/柱镜/轴位。取字片段供核对：${ex}`;
}

/** 仅覆盖 AI 返回的非空字符串字段，避免空结果冲掉已有输入 */
function patchRxEyeFromAiPayload(base: RxEye, src: Record<string, unknown> | undefined): RxEye {
  if (!src || typeof src !== 'object') return base;
  const next = { ...base };
  (['ds', 'dc', 'axis', 'va', 'pd', 'add'] as const).forEach((k) => {
    const v = src[k];
    if (typeof v === 'string' && v.trim() !== '') next[k] = v.trim();
    else if (typeof v === 'number' && Number.isFinite(v)) next[k] = String(v);
  });
  return next;
}

function normalizeCartRx(item: CartItem): CartItem {
  return {
    ...item,
    rx: {
      right: mergeRxEye(item.rx?.right),
      left: mergeRxEye(item.rx?.left),
    },
  };
}

function isLegacyQuickCartLine(item: CartItem): boolean {
  return Boolean(item.isQuickSale || (item.category || '').trim() === LEGACY_QUICK_CATEGORY);
}

function filterOutLegacyQuickSaleLines(cart: CartItem[]): CartItem[] {
  return cart.filter((item) => !isLegacyQuickCartLine(item));
}

type PaymentMethod = 'cash' | 'wechat' | 'alipay' | 'meituan_douyin';
type SaleStatus = '待加工' | '加工中' | '待取镜' | '已完成' | '售后' | '已退单';

type LastOrder = {
  store?: string;
  customer: { name: string; phone: string };
  items: CartItem[];
  total: number;
  time: string;
  saleNo: string;
  /** 本单首条 sales 行 id，印在二维码内 */
  primarySaleId: string;
  /** 取镜扫码用完整载荷 */
  orderQrPayload: string;
  paymentMethod?: PaymentMethod;
  /** 美团/抖音团购手动录入的券号（仅 meituan_douyin） */
  meituanVoucher?: string;
  /** 结算成功后构造并注入打印模板的订单对象 */
  orderObject: PrintOrder;
  /** 价目矩阵 SKU 校价后的行业小票载荷（热敏 / 兼容打印优先消费） */
  thermalReceiptPayload?: EyewearReceiptPayload | null;
  /** strict 适配失败原因（不阻断结算，仅提示） */
  thermalReceiptErrors?: string[];
};

type OrderLookupRow = {
  id: string;
  sale_no: string | null;
  sale_status: string | null;
  quantity: number;
  total_price: number | string;
  product_category: string | null;
  products?: { name?: string | null } | null;
};
type CashierDraft = {
  selectedStore: string;
  customerName: string;
  customerPhone: string;
  cart: CartItem[];
};

type PendingBill = {
  id: string;
  createdAt: string;
  note: string;
  draft: CashierDraft;
};

/** /api/voice/order-fill 返回的 result 结构 */
type VoiceOrderFillResult = {
  customerName?: string;
  customerPhone?: string;
  price?: string | number | null;
  right?: Record<string, unknown>;
  left?: Record<string, unknown>;
};
type QuerySale = {
  id: string;
  created_at: string;
  quantity: number;
  total_price: number | string;
  customer_name?: string | null;
  customer_phone?: string | null;
  sale_no?: string | null;
  product_category?: string | null;
  product_brand?: string | null;
  product_model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  sale_status?: string | null;
  refund_reason?: string | null;
  products?: { name?: string | null } | null;
  stores?: { name?: string | null } | null;
};

function querySaleLineLabel(row: QuerySale): string {
  if (row.products?.name) return row.products.name;
  if ((row.product_category || '').trim() === LEGACY_QUICK_CATEGORY && row.product_model?.trim()) {
    return row.product_model.trim();
  }
  if ((row.product_category || '').trim() === CUSTOM_COMBO_CATEGORY) {
    const m = row.product_model?.trim();
    return m ? `自主配镜 · ${m}` : '自主配镜';
  }
  return row.product_model?.trim() || '—';
}
const CASHIER_DRAFT_KEY = 'cashier_draft_v1';
const PENDING_BILLS_KEY = 'cashier_pending_bills_v1';
const SALE_STATUSES: SaleStatus[] = ['待加工', '加工中', '待取镜', '已完成', '售后', '已退单'];

/** 结算弹窗关闭后，按校验顺序找到第一个未满足的验光字段（用于自动聚焦，避免焦点落在 body 无法继续输入） */
function firstIncompleteRxField(rx: CartItem['rx']): { side: 'right' | 'left'; field: keyof RxEye } | null {
  for (const side of ['right', 'left'] as const) {
    const eye = rx[side];
    if (!String(eye.ds).trim()) return { side, field: 'ds' };
    if (!String(eye.pd).trim()) return { side, field: 'pd' };
    const dc = String(eye.dc).trim();
    if (dc !== '' && !String(eye.axis).trim()) return { side, field: 'axis' };
  }
  return null;
}

function bumpNumericString(raw: string, step: number, decimals = 2, min?: number, max?: number): string {
  const cur = Number.parseFloat(String(raw).trim());
  const base = Number.isFinite(cur) ? cur : 0;
  let next = Number((base + step).toFixed(decimals));
  if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
  const out = next.toFixed(decimals);
  return out.startsWith('-0') && Number(next) === 0 ? '0.00' : out;
}

function EyeRxBlock({
  title,
  eyeSide,
  eye,
  onPatch,
}: {
  title: string;
  eyeSide: 'right' | 'left';
  eye: RxEye;
  onPatch: (patch: Partial<RxEye>) => void;
}) {
  const dial = (
    key: keyof RxEye,
    label: string,
    step: number,
    options?: { decimals?: number; min?: number; max?: number; placeholder?: string },
  ) => {
    const decimals = options?.decimals ?? 2;
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-end justify-between gap-1.5">
          <label className="truncate text-[10px] font-medium text-gray-500">{label}</label>
          <span className="shrink-0 whitespace-nowrap text-[9px] text-gray-400">
            步进 {step > 0 ? '+' : ''}
            {step}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex h-10 w-8 shrink-0 items-center justify-center rounded border border-transparent bg-white text-base font-light text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
            onClick={() =>
              onPatch({
                [key]: bumpNumericString(eye[key], -Math.abs(step), decimals, options?.min, options?.max),
              } as Partial<RxEye>)
            }
          >
            −
          </button>
          <input
            data-rx-field={`${eyeSide}-${String(key)}`}
            value={eye[key]}
            onChange={(e) => onPatch({ [key]: e.target.value } as Partial<RxEye>)}
            className="h-10 min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 text-center font-mono text-base font-bold tabular-nums tracking-tight text-black shadow-sm outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-gray-400 hover:border-gray-400 focus:border-sky-600 focus:shadow-[0_0_0_1px_rgba(2,132,199,0.35),0_2px_8px_rgba(15,23,42,0.08)]"
            placeholder={options?.placeholder || '0.00'}
          />
          <button
            type="button"
            className="flex h-10 w-8 shrink-0 items-center justify-center rounded border border-transparent bg-white text-base font-light text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
            onClick={() =>
              onPatch({
                [key]: bumpNumericString(eye[key], Math.abs(step), decimals, options?.min, options?.max),
              } as Partial<RxEye>)
            }
          >
            +
          </button>
        </div>
      </div>
    );
  };

  const row = (key: keyof RxEye, label: string, ph: string, valueClass: string) => (
    <div className="min-w-0">
      <label className="mb-1.5 block truncate text-[10px] font-medium text-gray-500">{label}</label>
      <input
        data-rx-field={`${eyeSide}-${String(key)}`}
        value={eye[key]}
        onChange={(e) => onPatch({ [key]: e.target.value } as Partial<RxEye>)}
        className={`h-10 w-full rounded border border-gray-300 bg-white px-2.5 text-sm shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-gray-400 hover:border-gray-400 focus:border-sky-600 focus:shadow-[0_0_0_1px_rgba(2,132,199,0.35),0_2px_8px_rgba(15,23,42,0.08)] ${valueClass}`}
        placeholder={ph}
      />
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm sm:p-3.5">
      <p className="mb-0.5 text-sm font-bold tracking-tight text-gray-900">{title}</p>
      <p className="mb-2.5 text-[10px] leading-snug text-gray-500">
        球镜、瞳距必填；矫正视力选填；柱镜可不填；填了柱镜则轴位必填。ADD 选填。
      </p>
      <div className="rounded-lg border border-gray-200 bg-[#F9FAFB] p-2.5">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-400">屈光</p>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
          {dial('ds', '球镜 (DS) · 必填', 0.25, { decimals: 2, min: -30, max: 30, placeholder: '-6.00' })}
          {dial('dc', '柱镜 (DC) · 选填', 0.25, { decimals: 2, min: -12, max: 12, placeholder: '-1.25' })}
          {dial('axis', '轴位 (°)', 1, { decimals: 0, min: 0, max: 180, placeholder: '90' })}
        </div>
      </div>
      <div className="mt-2 rounded-lg border border-gray-200 bg-[#F9FAFB] p-2.5">
        <div className="max-w-md">{dial('add', '下加 (ADD) · 选填', 0.25, { decimals: 2, min: 0, max: 4, placeholder: '+1.50' })}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {row('va', '矫正视力 · 选填', '可选，如 1.0', 'font-medium text-gray-800')}
        {row('pd', '瞳距 (mm) · 必填', '如 32', 'font-bold text-black')}
      </div>
    </div>
  );
}

export default function CashierPage() {
  const { profile, session, hasPermission, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [receiptPrinting, setReceiptPrinting] = useState(false);
  const [receiptBtPrinting, setReceiptBtPrinting] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [queryKeyword, setQueryKeyword] = useState('');
  const [queryRows, setQueryRows] = useState<QuerySale[]>([]);
  const [querying, setQuerying] = useState(false);
  const [queryStatus, setQueryStatus] = useState<string>('全部');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paying, setPaying] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [rxEditorLineId, setRxEditorLineId] = useState<string | null>(null);
  /** 收起后验光单窗口以右侧条形式保留，便于平板继续操作主界面 */
  const [rxEditorMinimized, setRxEditorMinimized] = useState(false);
  const [rxFocusTarget, setRxFocusTarget] = useState<{
    lineId: string;
    side: 'right' | 'left';
    field: keyof RxEye;
  } | null>(null);
  const [rxPhotoFileName, setRxPhotoFileName] = useState('');
  const [rxRecognizing, setRxRecognizing] = useState(false);
  /** 视光矩阵 suggest 层：折射率导购话术（本地 hub 推导，零 RTT） */
  const [matrixRxSuggestHint, setMatrixRxSuggestHint] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showMeituanVerifyModal, setShowMeituanVerifyModal] = useState(false);
  const [meituanScanning, setMeituanScanning] = useState(false);
  const [meituanVerifySubmitting, setMeituanVerifySubmitting] = useState(false);
  const [meituanDetectedCode, setMeituanDetectedCode] = useState('');
  const [scanCode, setScanCode] = useState('');
  /** 美团/抖音：团购券码，主界面与扫码弹窗共用 */
  const [meituanVoucher, setMeituanVoucher] = useState('');
  const [refundTarget, setRefundTarget] = useState<QuerySale | null>(null);
  const [refundReasonInput, setRefundReasonInput] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const meituanVideoRef = useRef<HTMLVideoElement>(null);
  const meituanScanTimerRef = useRef<number | null>(null);
  const meituanStreamRef = useRef<MediaStream | null>(null);
  const checkoutLatestRef = useRef<{
    assertCanCheckout: (opts?: { lensRx?: 'enforce' | 'skip' }) => boolean;
    handleCheckout: () => Promise<void>;
  }>({
    assertCanCheckout: () => false,
    handleCheckout: async () => {},
  });
  /** 防止连续点击或扫码与现金交叉触发两次 finalizeSale */
  const finalizeSaleLockRef = useRef(false);
  const readonlyCartScrollRef = useRef<HTMLDivElement>(null);
  const [rxCheckoutHighlightIds, setRxCheckoutHighlightIds] = useState<Set<string>>(() => new Set());
  const scanCodeInputRef = useRef<HTMLInputElement>(null);
  const [customComboSummary, setCustomComboSummary] = useState('');
  const [customComboFrame, setCustomComboFrame] = useState('');
  const [customComboLens, setCustomComboLens] = useState('');
  const [customComboPrice, setCustomComboPrice] = useState('');
  const [customComboError, setCustomComboError] = useState<string | null>(null);
  /** 按分类弹窗浏览库存 SKU（主界面不再铺开展示商品卡片，减少滑动） */
  const [productInfoModalCategory, setProductInfoModalCategory] = useState<ProductQuickCategory | null>(null);
  /** 购物车「改价」输入中的字符串，失焦后再写入 overrideUnitPrice，避免受控 number 吞掉「12.」等中间态 */
  const [unitPriceDraftByLine, setUnitPriceDraftByLine] = useState<Record<string, string>>({});
  const [lensTintOptions, setLensTintOptions] = useState<LensTintPreset[]>([]);
  const [pendingBills, setPendingBills] = useState<PendingBill[]>([]);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [orderLookupOpen, setOrderLookupOpen] = useState(false);
  const [orderLookupTitle, setOrderLookupTitle] = useState('');
  const [orderLookupBody, setOrderLookupBody] = useState('');
  const [orderLookupLoading, setOrderLookupLoading] = useState(false);
  const orderScanBufRef = useRef('');
  const orderScanLastTsRef = useRef(0);
  /** 小票 + 定制生产单（加工单）打印根节点：交给 react-to-print 克隆进 iframe，避免整页 @media print 打出白纸 */
  const cashierPrintBundleRef = useRef<HTMLDivElement>(null);
  const printDocumentTitle = useCallback(() => {
    const o = lastOrder?.orderObject;
    const no = (o?.order_no ?? o?.orderNo ?? 'receipt') as string;
    return `镜售-${String(no)}`;
  }, [lastOrder?.orderObject]);
  const printCashierBundleReact = useReactToPrint({
    contentRef: cashierPrintBundleRef,
    documentTitle: printDocumentTitle,
    pageStyle: `@page { size: 80mm auto; margin: 0; }`,
  });

  useEffect(() => {
    setCashierBrowserPrintOverride(() => {
      if (cashierPrintBundleRef.current) printCashierBundleReact();
      else if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.setTimeout(() => window.print(), 0);
      }
    });
    return () => setCashierBrowserPrintOverride(null);
  }, [printCashierBundleReact]);

  const [voiceOrderRecording, setVoiceOrderRecording] = useState(false);
  const [voiceOrderBusy, setVoiceOrderBusy] = useState(false);
  /** 无麦克风/非 HTTPS 时：粘贴口述文字走同一套 AI 填单 */
  const [visualEntryOpen, setVisualEntryOpen] = useState(false);
  const [visualEntryLoading, setVisualEntryLoading] = useState(false);
  const [visualEntryPulse, setVisualEntryPulse] = useState(false);
  const [visualEntryError, setVisualEntryError] = useState<string | null>(null);
  const [customProductName, setCustomProductName] = useState('');
  const [customProductPrice, setCustomProductPrice] = useState('');
  const [customProductCategory, setCustomProductCategory] = useState('其他');
  const [customProductBusy, setCustomProductBusy] = useState(false);
  /** 镜框自定义：型号/刻字编码，可与「拍照识镜框」OCR 联动 */
  const [customFrameModel, setCustomFrameModel] = useState('');
  /** 最近一次自定义商品名称 OCR 的存证路径（写入新建商品并随购物车溯源） */
  const [customProductOcrEvidenceUrl, setCustomProductOcrEvidenceUrl] = useState<string | null>(null);
  /** 自定义商品名称「相机眼」OCR 进行中（仅调 /api/ocr，与库存列表/图片接口无关） */
  const [customAddNameOcrBusy, setCustomAddNameOcrBusy] = useState(false);
  /** 相册选图：隐藏 file；拍照走 `WebCameraCaptureModal`（getUserMedia），避免桌面端仅弹出「选取文件」 */
  const customAddOcrGalleryId = useId();
  const lensPackagingOcrGalleryId = useId();
  const customAddOcrGalleryRef = useRef<HTMLInputElement>(null);
  const lensPackagingOcrGalleryRef = useRef<HTMLInputElement>(null);
  const [cashierOcrWebCamOpen, setCashierOcrWebCamOpen] = useState(false);
  /** true = 镜片包装 OCR；false = 自定义商品（镜框等）名称 OCR */
  const [cashierOcrWebCamForLens, setCashierOcrWebCamForLens] = useState(false);

  useEffect(() => {
    if (productInfoModalCategory === null) setCashierOcrWebCamOpen(false);
  }, [productInfoModalCategory]);

  /** 镜片自定义：品牌（原「蔡司」位，自填其它品牌）+ 系列/折射率/膜层 */
  const [lensManualBrand, setLensManualBrand] = useState('');
  const [lensManualSeries, setLensManualSeries] = useState('');
  const [lensManualIndex, setLensManualIndex] = useState('');
  const [lensManualCoating, setLensManualCoating] = useState('');
  /** 镜片行：价目表选购（蔡司样例基线）与自由手工填报 */
  const [lensPriceMode, setLensPriceMode] = useState<LensPriceEntryMode>('catalog');
  const [zeissSearch, setZeissSearch] = useState('');
  const [zeissProductName, setZeissProductName] = useState('');
  const [zeissIndexStr, setZeissIndexStr] = useState('');
  const [zeissCoating, setZeissCoating] = useState('');
  /** 价目表选购：品牌 Tab（蔡司 / 依视路占位等） */
  const [lensCatalogBrand, setLensCatalogBrand] = useState<string>(
    () => listUniqueMatrixBrandKeys()[0] ?? 'ZEISS',
  );
  /** 价目表选购：染色服务（受矩阵 tintable 约束） */
  const [lensCatalogTint, setLensCatalogTint] = useState(false);
  /** 验光单保存时与价目册光度包络不符时的红色提示 */
  const [rxPowerValidationError, setRxPowerValidationError] = useState<string | null>(null);
  /** 平板视口（max-xl）：右侧结算轨 Slide-over */
  const [checkoutDrawerOpen, setCheckoutDrawerOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  /** 数据海关 / 行业小票载荷生成反馈（琥珀色） */
  const [matrixReceiptToast, setMatrixReceiptToast] = useState<string | null>(null);
  const voiceMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const visualEntryVideoRef = useRef<HTMLVideoElement>(null);
  const visualEntryStreamRef = useRef<MediaStream | null>(null);
  const rxEditorLineIdRef = useRef<string | null>(null);
  rxEditorLineIdRef.current = rxEditorLineId;

  useEffect(() => {
    if (!rxEditorLineId) setRxEditorMinimized(false);
  }, [rxEditorLineId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const closeIfDesktop = () => {
      if (mq.matches) setCheckoutDrawerOpen(false);
    };
    closeIfDesktop();
    mq.addEventListener('change', closeIfDesktop);
    return () => mq.removeEventListener('change', closeIfDesktop);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const openDrawer = () => setCheckoutDrawerOpen(true);
    window.addEventListener(CASHIER_OPEN_CHECKOUT_DRAWER_EVENT, openDrawer);
    return () => window.removeEventListener(CASHIER_OPEN_CHECKOUT_DRAWER_EVENT, openDrawer);
  }, []);

  const allowSalesEdit = hasPermission('sales.edit');
  const navigate = useAppNavigate();
  const selectedStoreId = isUuid(selectedStore) ? selectedStore : '';
  const localBypassMode =
    disableAuthMode ||
    (process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE === 'true' &&
      (profile?.user_id === 'local-dev-user' || !session?.user?.id));

  async function fetchData() {
    setDataLoading(true);
    try {
      // 在禁用认证模式下，初始化默认数据
      if (disableAuthMode) {
        const defaultStoreId = genId();
        const defaultStore = { id: defaultStoreId, name: '镜售总店' };
        setStores([defaultStore as Store]);
        setSelectedStore(defaultStoreId);

        const sampleProducts: Product[] = [
          { id: genId(), name: '防蓝光镜片', price: 299, stock: 100, category: '镜片' },
          { id: genId(), name: '金属镜架', price: 399, stock: 50, category: '镜架' },
          { id: genId(), name: '隐形眼镜', price: 199, stock: 200, category: '隐形眼镜' },
        ];
        try {
          const res = await fetch('/api/inventory/products/');
          const j = (await res.json()) as { ok?: boolean; data?: Product[] };
          if (j.ok && Array.isArray(j.data) && j.data.length > 0) {
            setProducts(j.data);
          } else {
            setProducts(sampleProducts);
          }
        } catch {
          setProducts(sampleProducts);
        }

        setDataLoading(false);
        return;
      }

      // 从本地缓存获取数据
      const [productsData, storesData] = await Promise.all([
        withTimeoutFallback(localCache.getProducts(), 1800, [] as Product[]),
        withTimeoutFallback(localCache.getStores(), 1800, [] as Store[]),
      ]);

      if (productsData && productsData.length > 0) {
        setProducts(productsData as Product[]);
      } else {
        try {
          const res = await fetch('/api/inventory/products/');
          const j = (await res.json()) as { ok?: boolean; data?: Product[] };
          if (res.ok && j.ok && Array.isArray(j.data)) {
            setProducts(j.data);
            await localCache.set('products:all', j.data);
          } else {
            setProducts([]);
          }
        } catch (e) {
          console.warn('[cashier] prisma products fallback:', e);
          setProducts([]);
        }
      }

      let normalizedStores: Store[] = [];
      if (storesData) {
        normalizedStores = (storesData as Store[]).filter((s) => isUuid(String(s.id)));

        // 自愈：owner 首次上线且无门店时，尝试经云端 REST 自动创建并重载。
        if (normalizedStores.length === 0 && profile?.role === 'owner' && isCloudRestConfigured) {
          const { error: createStoreError } = await cloudRest.from('stores').insert({ name: '镜售总店' });
          if (createStoreError) {
            console.warn('[cashier] auto create store:', createStoreError.message);
          } else {
            const { data: reloadedStores, error: reloadStoresError } = await cloudRest
              .from('stores')
              .select('id,name');
            if (reloadStoresError) {
              console.warn('[cashier] stores reload after create:', reloadStoresError.message);
            } else {
              normalizedStores = ((reloadedStores ?? []) as Store[]).filter((s) => isUuid(String(s.id)));
              if (normalizedStores.length > 0) {
                await localCache.set('stores:all', normalizedStores);
              }
            }
          }
        }
      }

      // 本地缓存无门店时：从服务端 RDS（Prisma）拉取，适配「仅 DATABASE_URL、不走云端 REST」的部署
      if (normalizedStores.length === 0) {
        try {
          const res = await fetch('/api/inventory/stores/');
          const j = (await res.json()) as { ok?: boolean; data?: Store[] };
          if (res.ok && j.ok && Array.isArray(j.data)) {
            normalizedStores = j.data.filter((s) => isUuid(String(s.id)));
            if (normalizedStores.length > 0) {
              await localCache.set('stores:all', normalizedStores);
            }
          }
        } catch (e) {
          console.warn('[cashier] prisma stores fallback:', e);
        }
      }

      // 仍无门店且为 owner：在 RDS 中建默认门店（不依赖云端 REST）
      if (normalizedStores.length === 0 && profile?.role === 'owner') {
        try {
          const res = await fetch('/api/inventory/stores/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '镜售总店' }),
          });
          const j = (await res.json()) as { ok?: boolean; data?: Store };
          if (res.ok && j.ok && j.data && isUuid(String(j.data.id))) {
            normalizedStores = [{ id: j.data.id, name: j.data.name ?? '镜售总店' }];
            await localCache.set('stores:all', normalizedStores);
          }
        } catch (e) {
          console.warn('[cashier] default store create (prisma):', e);
        }
      }

      // 账号已绑定 store_id 但列表中缺失时，补一条以便下拉框与结算校验一致
      const bound = profile?.store_id && isUuid(String(profile.store_id)) ? String(profile.store_id) : '';
      if (bound && !normalizedStores.some((s) => s.id === bound)) {
        normalizedStores = [{ id: bound, name: '我的门店' }, ...normalizedStores];
      }

      setStores(normalizedStores);
      if (normalizedStores.length > 0) {
        setSelectedStore((prev) => {
          const firstId = normalizedStores[0].id;
          if (!isUuid(firstId)) return '';
          if (bound && normalizedStores.some((s) => s.id === bound)) return bound;
          if (isUuid(prev) && normalizedStores.some((s) => s.id === prev)) return prev;
          return firstId;
        });
      } else {
        setSelectedStore('');
      }

      // 后台同步数据
      if (isCloudRestConfigured) {
        localCache.syncFromCloud().catch((error) => {
          console.warn('[cashier] syncFromCloud:', error);
        });
      }
    } catch (e) {
      console.warn('[cashier] fetchData:', e);
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [profile?.user_id]);

  /** 平板浏览器禁用系统下拉刷新，避免拉开菜单时整页刷新中断收银 */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverscroll = html.style.overscrollBehaviorY;
    const prevBodyOverscroll = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = 'none';
    body.style.overscrollBehaviorY = 'none';
    return () => {
      html.style.overscrollBehaviorY = prevHtmlOverscroll;
      body.style.overscrollBehaviorY = prevBodyOverscroll;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLensTintConfigClient()
      .then((cfg) => {
        if (cancelled) return;
        setLensTintOptions(Array.isArray(cfg.colors) ? cfg.colors : []);
      })
      .catch(() => {
        if (cancelled) return;
        setLensTintOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (productInfoModalCategory === null) return;
    setCustomProductName('');
    setCustomProductPrice('');
    setCustomFrameModel('');
    setCustomProductOcrEvidenceUrl(null);
    setCustomProductCategory(
      productInfoModalCategory === 'all' ? '其他' : categoryLabelForQuickModal(productInfoModalCategory),
    );
    setLensManualBrand('');
    setLensManualSeries('');
    setLensManualIndex('');
    setLensManualCoating('');
    setLensPriceMode('catalog');
    setZeissSearch('');
    const defaultBrand = listUniqueMatrixBrandKeys()[0] ?? 'ZEISS';
    setLensCatalogBrand(defaultBrand);
    setLensCatalogTint(false);
    const rowsInit = ZEISS_PRICE_MATRIX.filter((p) => matrixProductBrandKey(p) === defaultBrand);
    if (rowsInit.length > 0) {
      const p0 = rowsInit[0]!;
      setZeissProductName(p0.productName);
      const idxs = listIndicesForProduct(p0.productName);
      const i0 = idxs[0];
      if (i0 != null) {
        setZeissIndexStr(String(i0));
        setZeissCoating(listCoatingsForProductIndex(p0.productName, i0)[0] || '');
      } else {
        setZeissIndexStr('');
        setZeissCoating('');
      }
    } else {
      setZeissProductName('');
      setZeissIndexStr('');
      setZeissCoating('');
    }
  }, [productInfoModalCategory]);

  const showLensSkuUi = useMemo(() => {
    if (productInfoModalCategory === 'lens') return true;
    if (productInfoModalCategory === 'all' && customProductCategory === '镜片') return true;
    return false;
  }, [productInfoModalCategory, customProductCategory]);

  /** 与 /api/ocr custom_add 同步：当前弹窗对应的库存分类文案 */
  const customAddOcrCategory = useMemo(() => {
    if (productInfoModalCategory === null) return '其他';
    if (productInfoModalCategory === 'all') return customProductCategory.trim() || '其他';
    return categoryLabelForQuickModal(productInfoModalCategory);
  }, [productInfoModalCategory, customProductCategory]);

  const customAddSecondaryFieldIsFrameStyle = useMemo(() => {
    return customProductCategory.includes('镜框') || customProductCategory === '镜架';
  }, [customProductCategory]);

  const handleZeissProductNameChange = useCallback((name: string) => {
    setZeissProductName(name);
    const idxs = listIndicesForProduct(name);
    const i0 = idxs[0];
    if (i0 != null) {
      setZeissIndexStr(String(i0));
      setZeissCoating(listCoatingsForProductIndex(name, i0)[0] || '');
    } else {
      setZeissIndexStr('');
      setZeissCoating('');
    }
  }, []);

  const handleZeissIndexStrChange = useCallback(
    (v: string) => {
      setZeissIndexStr(v);
      const idx = Number(v);
      if (Number.isFinite(idx) && zeissProductName) {
        setZeissCoating(listCoatingsForProductIndex(zeissProductName, idx)[0] || '');
      }
    },
    [zeissProductName],
  );

  const handleLensCatalogBrandChange = useCallback((b: string) => {
    setLensCatalogBrand(b);
    const rows = ZEISS_PRICE_MATRIX.filter((p) => matrixProductBrandKey(p) === b);
    if (rows.length === 0) {
      setZeissProductName('');
      setZeissIndexStr('');
      setZeissCoating('');
      setCustomProductName('');
      setCustomProductPrice('');
      return;
    }
    const p0 = rows[0]!;
    setZeissProductName(p0.productName);
    const idxs = listIndicesForProduct(p0.productName);
    const i0 = idxs[0];
    if (i0 != null) {
      setZeissIndexStr(String(i0));
      setZeissCoating(listCoatingsForProductIndex(p0.productName, i0)[0] || '');
    } else {
      setZeissIndexStr('');
      setZeissCoating('');
    }
  }, []);

  useEffect(() => {
    if (!showLensSkuUi || lensPriceMode === 'catalog') return;
    const brand = lensManualBrand.trim();
    const tail = [lensManualSeries, lensManualIndex, lensManualCoating].map((s) => s.trim()).filter(Boolean);
    const head = brand ? `${brand}镜片` : '';
    if (!head && tail.length === 0) {
      setCustomProductName('');
      return;
    }
    const segs = [head, ...tail].filter(Boolean);
    setCustomProductName(segs.length ? segs.join(' · ') : '');
  }, [showLensSkuUi, lensPriceMode, lensManualBrand, lensManualSeries, lensManualIndex, lensManualCoating]);

  useEffect(() => {
    if (!showLensSkuUi || lensPriceMode !== 'catalog') return;
    const rowsForBrand = ZEISS_PRICE_MATRIX.filter((p) => matrixProductBrandKey(p) === lensCatalogBrand);
    if (rowsForBrand.length === 0) {
      setCustomProductName('');
      setCustomProductPrice('');
      return;
    }
    const p = zeissProductName.trim();
    const c = zeissCoating.trim();
    const idx = Number(zeissIndexStr);
    if (!p || !c || !Number.isFinite(idx)) {
      setCustomProductName('');
      setCustomProductPrice('');
      return;
    }
    const y = resolveMatrixRetailYuan(p, idx, c);
    setCustomProductName(formatMatrixLensDisplayName(p, c, String(idx)));
    if (y != null && Number.isFinite(y)) {
      setCustomProductPrice(String(y));
    } else {
      setCustomProductPrice('');
    }
  }, [showLensSkuUi, lensPriceMode, lensCatalogBrand, zeissProductName, zeissIndexStr, zeissCoating]);

  useEffect(() => {
    setRxPowerValidationError(null);
  }, [rxEditorLineId]);

  const prevShowLensSkuUiRef = useRef(false);
  useEffect(() => {
    if (productInfoModalCategory === null) {
      prevShowLensSkuUiRef.current = false;
      return;
    }
    if (prevShowLensSkuUiRef.current && !showLensSkuUi) {
      setCustomProductName('');
      setCustomProductPrice('');
      setCustomFrameModel('');
    }
    prevShowLensSkuUiRef.current = showLensSkuUi;
  }, [showLensSkuUi, productInfoModalCategory]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(PENDING_BILLS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PendingBill[];
      if (Array.isArray(parsed)) setPendingBills(parsed);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PENDING_BILLS_KEY, JSON.stringify(pendingBills));
    } catch {
      // ignore quota
    }
  }, [pendingBills]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CASHIER_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<CashierDraft>;
      if (draft.selectedStore && isUuid(draft.selectedStore)) setSelectedStore(draft.selectedStore);
      if (typeof draft.customerName === 'string') setCustomerName(draft.customerName);
      if (typeof draft.customerPhone === 'string') setCustomerPhone(draft.customerPhone);
      if (Array.isArray(draft.cart)) {
        setUnitPriceDraftByLine({});
        setCart(filterOutLegacyQuickSaleLines(draft.cart as CartItem[]).map(normalizeCartRx));
      }
    } catch {
      // ignore malformed local draft
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !draftLoaded) return;
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    // 防抖落盘：避免每次点击/输入都同步写 localStorage 造成卡顿
    draftSaveTimerRef.current = window.setTimeout(() => {
      const payload: CashierDraft = {
        selectedStore,
        customerName,
        customerPhone,
        cart,
      };
      window.localStorage.setItem(CASHIER_DRAFT_KEY, JSON.stringify(payload));
      draftSaveTimerRef.current = null;
    }, 280);

    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [selectedStore, customerName, customerPhone, cart, draftLoaded]);

  const handleOrderQrScan = useCallback(async (raw: string) => {
    const parsed = parseOrderQrPayload(raw);
    if (!parsed) return;
    setOrderLookupOpen(true);
    setOrderLookupLoading(true);
    setOrderLookupTitle('正在查询订单…');
    setOrderLookupBody('');
    try {
      const { data, error } = await cloudRest
        .from('sales')
        .select(
          'id,sale_no,sale_status,quantity,total_price,product_category,products(name)',
        )
        .eq('sale_no', parsed.saleNo)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as OrderLookupRow[];
      if (rows.length === 0) {
        setOrderLookupTitle('未找到订单');
        setOrderLookupBody(
          `单据号「${parsed.saleNo}」无销售记录，请核对小票或稍后在报表中查询。`,
        );
        return;
      }
      const idOk = rows.some((r) => r.id === parsed.primarySaleId);
      const statusLabels = [...new Set(rows.map((r) => (r.sale_status || '—').trim()))];
      const statusSummary = statusLabels.length === 1 ? statusLabels[0] : statusLabels.join(' · ');
      const lines: string[] = [
        `单据号：${parsed.saleNo}`,
        idOk ? '二维码校验：已匹配本单' : '提示：二维码内行 ID 与当前数据不完全一致，仍以单据号为准。',
        `加工状态汇总：${statusSummary}`,
        '',
        '—— 明细 ——',
        ...rows.map((r, i) => {
          const name = r.products?.name?.trim() || r.product_category || '—';
          const st = (r.sale_status || '—').trim();
          return `${i + 1}. ${name}  ×${r.quantity}  ｜ ${st}`;
        }),
      ];
      setOrderLookupTitle('取镜查询 · 加工状态');
      setOrderLookupBody(lines.join('\n'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOrderLookupTitle('查询失败');
      setOrderLookupBody(toChineseErrorMessage(msg));
    } finally {
      setOrderLookupLoading(false);
    }
  }, []);

  /**
   * Electron：捕获阶段识别取镜二维码载荷。
   * 普通输入框（验光、客人信息等）内必须跳过，否则会污染缓冲、表现为报错后无法再输入度数等。
   * 仅「先扫付款码」弹窗内的付款码输入框继续走本逻辑，供扫码枪楔入。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.electronApp?.isDesktop) return;
    const GAP_MS = 55;
    const prefix = `${ORDER_QR_MAGIC}|`;
    const onCap = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const rawTarget = e.target;
      if (rawTarget instanceof HTMLElement && rawTarget.isContentEditable) return;
      if (rawTarget instanceof Node) {
        const el = rawTarget instanceof Element ? rawTarget : rawTarget.parentElement;
        if (el?.closest('[data-rx-editor]')) return;
      }
      if (
        rawTarget instanceof HTMLInputElement ||
        rawTarget instanceof HTMLTextAreaElement ||
        rawTarget instanceof HTMLSelectElement
      ) {
        if (rawTarget !== scanCodeInputRef.current) return;
      }
      const now = Date.now();
      if (e.key === 'Enter') {
        const line = orderScanBufRef.current;
        orderScanBufRef.current = '';
        orderScanLastTsRef.current = 0;
        if (line.startsWith(prefix)) {
          e.preventDefault();
          e.stopPropagation();
          void handleOrderQrScan(line);
        }
        return;
      }
      if (now - orderScanLastTsRef.current > GAP_MS) orderScanBufRef.current = '';
      orderScanLastTsRef.current = now;
      if (e.key.length === 1) orderScanBufRef.current += e.key;
    };
    document.addEventListener('keydown', onCap, true);
    return () => document.removeEventListener('keydown', onCap, true);
  }, [handleOrderQrScan]);

  const addToCart = useCallback(
    (
      product: Product,
      options?: {
        ocrEvidenceUrlFallback?: string | null;
        zeissMatrixRxRef?: { productName: string; index: number; coating: string } | null;
      },
    ) => {
    const promoOk = product.allow_promo_price !== false;
    const promo =
      product.is_promo && promoOk && product.promo_price != null
        ? Number(product.promo_price)
        : null;
    const usePromo = promo !== null && Number.isFinite(promo) && promo >= 0;
    const ocr_evidence_url = mergeOcrEvidenceUrlForCart(product, options?.ocrEvidenceUrlFallback);
    const lineId = genId();
    setCart((prev) => [
      ...prev,
      {
        ...product,
        ocr_evidence_url,
        lineId,
        quantity: 1,
        rx: { right: emptyEye(), left: emptyEye() },
        discountPercent: 0,
        overrideUnitPrice: usePromo ? promo : null,
        tint_info: null,
        zeiss_matrix_rx_ref: options?.zeissMatrixRxRef ?? null,
      },
    ]);
    if (isLensProduct(product)) {
      setRxEditorLineId(lineId);
      setRxEditorMinimized(false);
      setRxFocusTarget(null);
      setRxPhotoFileName('');
      setRxRecognizing(false);
    }
  }, []);

  // MATRIX_PROTOCOL_V1 · 监听手册页「加入收银」：透传品牌/系列/折射率/膜层/价格/tintable/powerRange
  useEffect(() => {
    const off = onHandbookAddToCart((payload) => {
      const base = toCashierLensProduct(payload);
      addToCart(base as unknown as Product, {
        zeissMatrixRxRef: {
          productName: payload.productName,
          index: payload.index,
          coating: payload.coating,
        },
      });
    });
    return off;
  }, [addToCart]);

  const removeFromCart = useCallback((lineId: string) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
    setUnitPriceDraftByLine((p) => {
      if (!(lineId in p)) return p;
      const next = { ...p };
      delete next[lineId];
      return next;
    });
  }, []);

  const updateQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        const targetQty = item.quantity + delta;
        const maxQty =
          isCustomComboLine(item) ||
          !Number.isFinite(item.stock) ||
          item.stock <= 0
            ? targetQty
            : item.stock;
        const newQty = Math.max(1, Math.min(maxQty, targetQty));
        return { ...item, quantity: newQty };
      }),
    );
  };

  const patchRx = (lineId: string, side: 'right' | 'left', patch: Partial<RxEye>) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        const eye = item.rx[side];
        return {
          ...item,
          rx: {
            ...item.rx,
            [side]: { ...eye, ...patch },
          },
        };
      }),
    );
  };

  const applyRxFromOcr = useCallback(
    (lineId: string, side: 'right' | 'left', payload: Record<string, unknown>) => {
      patchRx(lineId, side, {
        ds: ocrScalarToRxString(payload.ds),
        dc: ocrScalarToRxString(payload.dc),
        axis: ocrScalarToRxString(
          payload.axis ?? (payload as Record<string, unknown>)['轴线'] ?? (payload as Record<string, unknown>)['轴向'],
        ),
        va: ocrScalarToRxString(payload.va),
        pd: ocrScalarToRxString(payload.pd),
        add: ocrScalarToRxString(payload.add),
      });
    },
    [],
  );

  /** 必须在引用它的 useCallback/useEffect 之前声明，否则依赖数组会触发 TDZ（Cannot access before initialization） */
  const editingRxItem = useMemo(
    () => (rxEditorLineId ? cart.find((item) => item.lineId === rxEditorLineId) ?? null : null),
    [cart, rxEditorLineId],
  );

  useEffect(() => {
    if (!editingRxItem || !isLensProduct(editingRxItem)) {
      setMatrixRxSuggestHint(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const { hints } = buildCashierRefractiveIndexHints({
        od_ds: editingRxItem.rx.right.ds,
        od_dc: editingRxItem.rx.right.dc,
        os_ds: editingRxItem.rx.left.ds,
        os_dc: editingRxItem.rx.left.dc,
      });
      setMatrixRxSuggestHint(hints[0] ?? null);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [editingRxItem]);

  const applyVoiceOrderResult = useCallback((result: VoiceOrderFillResult) => {
    if (typeof result.customerName === 'string' && result.customerName.trim()) {
      setCustomerName(result.customerName.trim());
    }
    if (typeof result.customerPhone === 'string' && result.customerPhone.trim()) {
      setCustomerPhone(result.customerPhone.trim());
    }

    const rawPrice = result.price;
    const priceNum =
      rawPrice === null || rawPrice === undefined || rawPrice === ''
        ? null
        : typeof rawPrice === 'number' && Number.isFinite(rawPrice)
          ? Math.max(0, rawPrice)
          : (() => {
              const n = Number(String(rawPrice).replace(/[^\d.]/g, ''));
              return Number.isFinite(n) && n >= 0 ? n : null;
            })();

    setCart((prev) => {
      const target = pickLensTargetLine(prev, rxEditorLineIdRef.current);
      if (priceNum !== null && !target) {
        queueMicrotask(() => setCustomComboPrice(sanitizePriceDraft(String(priceNum))));
      }
      if (!target) return prev;

      const hasRx =
        (result.right && typeof result.right === 'object') ||
        (result.left && typeof result.left === 'object');

      return prev.map((item) => {
        if (item.lineId !== target.lineId) return item;
        let next: CartItem = { ...item };
        if (priceNum !== null) {
          next = { ...next, overrideUnitPrice: priceNum };
        }
        if (hasRx) {
          next = {
            ...next,
            rx: {
              right: patchRxEyeFromAiPayload(next.rx.right, result.right),
              left: patchRxEyeFromAiPayload(next.rx.left, result.left),
            },
          };
        }
        return next;
      });
    });
  }, []);

  const finalizeVoiceOrderUpload = useCallback(
    async (blob: Blob) => {
      if (blob.size < 400) {
        window.alert('录音过短，请按住按钮多说明几句（姓名、电话、价格、度数等）。');
        return;
      }
      setVoiceOrderBusy(true);
      try {
        const form = new FormData();
        form.append('audio', blob, 'voice.webm');
        const resp = await fetch('/api/voice/order-fill', { method: 'POST', body: form });
        const data = (await resp.json()) as {
          ok?: boolean;
          error?: string;
          transcript?: string;
          result?: VoiceOrderFillResult;
        };
        if (!resp.ok || !data.ok || !data.result) {
          throw new Error(data.error || '语音开单失败');
        }
        applyVoiceOrderResult(data.result);
        const t = data.transcript?.trim();
        window.alert(
          `${t ? `识别原文：「${t}」\n\n` : ''}已尝试填充客人信息与购物车中镜片行的价格、验光字段。可继续口述补全或打开「填写验光单」核对。请核对后再结算。`,
        );
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setVoiceOrderBusy(false);
      }
    },
    [applyVoiceOrderResult],
  );

  const startVoiceOrderRecording = useCallback(async () => {
    if (voiceOrderBusy || voiceOrderRecording) return;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      window.alert(
        '当前页面无法使用麦克风：用「http://IP 或域名」访问时，浏览器会禁用录音；请使用 HTTPS，或在本机用 http://localhost 调试后再试「语音填单」。',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const preferred = 'audio/webm;codecs=opus';
      const mimeType = MediaRecorder.isTypeSupported(preferred)
        ? preferred
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      mr.onerror = () => {
        setVoiceOrderRecording(false);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        const blobType = mr.mimeType || 'audio/webm';
        const blob = new Blob(voiceChunksRef.current, { type: blobType });
        void finalizeVoiceOrderUpload(blob);
      };
      voiceMediaRecorderRef.current = mr;
      mr.start();
      setVoiceOrderRecording(true);
    } catch {
      window.alert('无法访问麦克风，请检查浏览器权限与 HTTPS 环境。');
    }
  }, [voiceOrderBusy, voiceOrderRecording, finalizeVoiceOrderUpload]);

  const stopVoiceOrderRecording = useCallback(() => {
    const mr = voiceMediaRecorderRef.current;
    setVoiceOrderRecording(false);
    voiceMediaRecorderRef.current = null;
    if (!mr || mr.state === 'inactive') {
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
      return;
    }
    try {
      mr.stop();
    } catch {
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
    }
  }, []);

  const stopVisualEntryCamera = useCallback(() => {
    visualEntryStreamRef.current?.getTracks().forEach((t) => t.stop());
    visualEntryStreamRef.current = null;
    const v = visualEntryVideoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const startVisualEntryCamera = useCallback(async () => {
    setVisualEntryError(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVisualEntryError('当前环境不支持摄像头，请改用拍照上传。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: false,
      });
      visualEntryStreamRef.current = stream;
      const v = visualEntryVideoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
    } catch (err) {
      setVisualEntryError(err instanceof Error ? err.message : '摄像头打开失败');
    }
  }, []);

  const runVisualEntryRecognition = useCallback(async () => {
    if (!editingRxItem) {
      setVisualEntryError('请先打开验光单编辑并选中要填写的镜片行，再使用摄像头识别。');
      return;
    }
    const video = visualEntryVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setVisualEntryError('摄像头预览未就绪，请稍后再试。');
      return;
    }
    setVisualEntryLoading(true);
    setVisualEntryError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法读取视频帧');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('无法导出截图'));
        }, 'image/jpeg', 0.9);
      });

      const { result, rawText } = await runServerCashierOcr(blob, 'frame.jpg');
      const eyes = prepareRxOcrEyesOrAbandon(result);
      if (!eyes) return;
      if (!ocrMergedEyesMeaningful(eyes)) {
        setVisualEntryError(formatOcrNoAutofillMessage(rawText));
        return;
      }
      applyRxFromOcr(editingRxItem.lineId, 'right', eyes.right);
      applyRxFromOcr(editingRxItem.lineId, 'left', eyes.left);
      setVisualEntryPulse(true);
      window.setTimeout(() => setVisualEntryPulse(false), 1200);
      window.alert('识别完成，已自动回填右眼/左眼度数。请核对后保存。');
    } catch (err) {
      setVisualEntryError(err instanceof Error ? err.message : '视觉识别失败');
    } finally {
      setVisualEntryLoading(false);
    }
  }, [editingRxItem, applyRxFromOcr]);

  useEffect(() => {
    if (!visualEntryOpen) {
      stopVisualEntryCamera();
      return;
    }
    void startVisualEntryCamera();
    return () => {
      stopVisualEntryCamera();
    };
  }, [visualEntryOpen, startVisualEntryCamera, stopVisualEntryCamera]);

  /**
   * 自定义添加「商品名称」相机：经隐藏 file 的 onChange 进入；仅 FormData → `runServerCashierCustomAddOcr` → `/api/ocr`（Paddle + AI）。
   * 禁止在此链接库存图片检索（如 getInventoryImages）；与 `POST /api/inventory/products` 无关。
   */
  const runCustomAddNameOcrFromBlob = useCallback(async (blob: Blob) => {
    setCustomAddNameOcrBusy(true);
    setCustomProductOcrEvidenceUrl(null);
    try {
      const { productName, modelLine, model, rawText, evidenceUrl, ocrMode } = await runServerCashierCustomAddOcr(
        blob,
        'custom.jpg',
        customAddOcrCategory,
      );
      const ev = typeof evidenceUrl === 'string' && evidenceUrl.trim() ? evidenceUrl.trim() : null;
      setCustomProductOcrEvidenceUrl(ev);
      if (productName) setCustomProductName(productName);
      if (modelLine) setCustomFrameModel(modelLine);
      else if (model) setCustomFrameModel(model);
      if (!productName && !modelLine && !model) {
        window.alert(`未识别到可用的名称或型号。原文节选：${(rawText ?? '').slice(0, 160)}`);
      } else if (ev) {
        console.info(`[自定义商品OCR:${ocrMode}] 原图已存证`, ev);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomAddNameOcrBusy(false);
    }
  }, [customAddOcrCategory]);

  const onCustomAddOcrFileInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const blob = await compressImageFileToJpegBlob(file, { maxBytes: 1_800_000 });
        await runCustomAddNameOcrFromBlob(blob);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
    [runCustomAddNameOcrFromBlob],
  );

  const runLensPackagingOcrFromBlob = useCallback(async (blob: Blob) => {
    setCustomAddNameOcrBusy(true);
    setCustomProductOcrEvidenceUrl(null);
    try {
      const extracted = await runServerCashierCustomAddOcr(blob, 'lens_box.jpg', '镜片');
      const ev =
        typeof extracted.evidenceUrl === 'string' && extracted.evidenceUrl.trim()
          ? extracted.evidenceUrl.trim()
          : null;
      setCustomProductOcrEvidenceUrl(ev);
      applyLensPackagingOcrToManualFields(extracted, {
        setLensManualBrand,
        setLensManualSeries,
        setLensManualIndex,
        setLensManualCoating,
      });
      const hasAny =
        extracted.productName?.trim() ||
        extracted.modelLine?.trim() ||
        extracted.brand?.trim() ||
        extracted.model?.trim();
      if (!hasAny) {
        window.alert(`未识别到可用的镜片信息。原文节选：${(extracted.rawText ?? '').slice(0, 160)}`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomAddNameOcrBusy(false);
    }
  }, []);

  const onLensPackagingOcrFileInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const blob = await compressImageFileToJpegBlob(file, { maxBytes: 1_800_000 });
        await runLensPackagingOcrFromBlob(blob);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
    [runLensPackagingOcrFromBlob],
  );

  const handleCashierOcrWebCamCapture = useCallback(
    async (blob: Blob) => {
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      const jpegBlob = await compressImageFileToJpegBlob(file, { maxBytes: 1_800_000 });
      if (cashierOcrWebCamForLens) {
        await runLensPackagingOcrFromBlob(jpegBlob);
      } else {
        await runCustomAddNameOcrFromBlob(jpegBlob);
      }
    },
    [cashierOcrWebCamForLens, runLensPackagingOcrFromBlob, runCustomAddNameOcrFromBlob],
  );

  const createCustomProductAndAddToCart = useCallback(async () => {
    if (showLensSkuUi) {
      if (lensPriceMode === 'catalog') {
        const rowsBrand = ZEISS_PRICE_MATRIX.filter((p) => matrixProductBrandKey(p) === lensCatalogBrand);
        if (rowsBrand.length === 0) {
          window.alert('当前品牌在价目矩阵中暂无产品，请更换品牌或改用「自由填报」');
          return;
        }
        if (ZEISS_PRICE_MATRIX.length === 0) {
          window.alert('视光价目矩阵未加载，请改用「自由填报」或检查 src/data/zeissPriceMatrix.ts 数据源');
          return;
        }
        const p = zeissProductName.trim();
        const c = zeissCoating.trim();
        const idx = Number(zeissIndexStr);
        if (!p || !c || !Number.isFinite(idx)) {
          window.alert('请完成价目表：品种、折射率、膜层');
          return;
        }
        const y = resolveMatrixRetailYuan(p, idx, c);
        if (y == null || !Number.isFinite(y) || y < 0) {
          window.alert('当前组合在价目中无零售价，请更换选项或改用自由填报');
          return;
        }
      } else {
        if (!lensManualBrand.trim()) {
          window.alert('请填写品牌（门店所用镜片品牌）');
          return;
        }
        if (!lensManualSeries.trim() || !lensManualIndex.trim() || !lensManualCoating.trim()) {
          window.alert('请填写系列、折射率、膜层');
          return;
        }
      }
    }
    const name = customProductName.trim();
    const price = Number(customProductPrice);
    if (!name) {
      window.alert('请填写商品名称');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      window.alert('请填写有效价格');
      return;
    }
    if (customProductBusy) return;
    setCustomProductBusy(true);
    try {
      const cat = customProductCategory.trim() || '其他';
      const payload: Record<string, unknown> = {
        name,
        price,
        stock: 0,
        store_id: selectedStoreId || null,
        category: cat,
      };
      if ((cat.includes('镜框') || cat === '镜架') && customFrameModel.trim()) {
        const m = customFrameModel.trim();
        payload.model = m;
        payload.frame_type = m;
      }
      if (showLensSkuUi && lensPriceMode === 'catalog') {
        payload.brand = matrixBrandDisplayLabel(lensCatalogBrand);
        payload.model = zeissProductName.trim();
        payload.lens_type = `${zeissIndexStr} / ${zeissCoating.trim()}`;
      }
      const evUrl = customProductOcrEvidenceUrl?.trim();
      if (!showLensSkuUi && evUrl) {
        payload.ocr_evidence_url = evUrl;
      }
      const res = await fetch('/api/inventory/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; data?: Product };
      if (!res.ok || !j.ok || !j.data) {
        throw new Error(j.error || '创建商品失败');
      }
      const row = j.data;
      const p: Product = {
        ...row,
        category: cat,
        brand:
          showLensSkuUi && lensPriceMode === 'catalog'
            ? matrixBrandDisplayLabel(lensCatalogBrand)
            : row.brand ?? null,
        lens_type:
          cat.includes('镜片') || cat === '套餐'
            ? row.lens_type ||
              (showLensSkuUi && lensPriceMode === 'catalog'
                ? `${zeissIndexStr} / ${zeissCoating}`
                : '通用')
            : row.lens_type ?? null,
        frame_type:
          cat.includes('镜框') || cat === '镜架' || cat === '套餐'
            ? row.frame_type || '通用'
            : row.frame_type ?? null,
        ocr_evidence_url: row.ocr_evidence_url ?? (evUrl || null),
      };
      const idxRef = Number(zeissIndexStr);
      addToCart(p, {
        ocrEvidenceUrlFallback: evUrl || null,
        zeissMatrixRxRef:
          showLensSkuUi &&
          lensPriceMode === 'catalog' &&
          zeissProductName.trim() &&
          zeissCoating.trim() &&
          Number.isFinite(idxRef)
            ? {
                productName: zeissProductName.trim(),
                index: idxRef,
                coating: zeissCoating.trim(),
              }
            : null,
      });
      setCustomProductName('');
      setCustomProductPrice('');
      setCustomFrameModel('');
      setCustomProductOcrEvidenceUrl(null);
      setProductInfoModalCategory(null);
      try {
        const reload = await fetch('/api/inventory/products/');
        const jr = (await reload.json()) as { ok?: boolean; data?: Product[] };
        if (jr.ok && Array.isArray(jr.data)) setProducts(jr.data);
      } catch {
        /* ignore */
      }
      window.alert('已写入库存并加入购物车（当前库存 0，结算后将按售出数量扣减）。');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomProductBusy(false);
    }
  }, [
    showLensSkuUi,
    lensPriceMode,
    lensManualBrand,
    lensManualSeries,
    lensManualIndex,
    lensManualCoating,
    zeissProductName,
    zeissIndexStr,
    zeissCoating,
    lensCatalogBrand,
    customProductName,
    customProductPrice,
    customProductCategory,
    customProductBusy,
    customFrameModel,
    customProductOcrEvidenceUrl,
    selectedStoreId,
    addToCart,
  ]);

  const patchDiscount = (lineId: string, discountPercent: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        if (item.allow_discount === false) return item;
        return { ...item, discountPercent: Math.min(100, Math.max(0, discountPercent || 0)) };
      }),
    );
  };

  const addCustomComboLine = () => {
    setCustomComboError(null);
    
    const amount = Number(customComboPrice);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCustomComboError('请输入正确的成套价格');
      return;
    }
    const frame = customComboFrame.trim();
    const lens = customComboLens.trim();
    const summary = customComboSummary.trim();
    const title = summary ? `自主配镜 · ${summary}` : '自主配镜';
    const line: CartItem = {
      id: '',
      name: title,
      price: amount,
      stock: 999999,
      category: CUSTOM_COMBO_CATEGORY,
      brand: null,
      model: summary || null,
      frame_type: frame || null,
      lens_type: lens || null,
      lineId: genId(),
      quantity: 1,
      rx: { right: emptyEye(), left: emptyEye() },
      discountPercent: 0,
      overrideUnitPrice: null,
      isCustomCombo: true,
      allow_discount: true,
      allow_points: true,
    };
    setCart((prev) => [...prev, line]);
    if (isLensProduct(line)) {
      setRxEditorLineId(line.lineId);
      setRxEditorMinimized(false);
      setRxFocusTarget(null);
      setRxPhotoFileName('');
      setRxRecognizing(false);
    } else {
      setRxEditorLineId(null);
      setRxFocusTarget(null);
      setRxPhotoFileName('');
      setRxRecognizing(false);
    }
    setCustomComboSummary('');
    setCustomComboFrame('');
    setCustomComboLens('');
    setCustomComboPrice('');
  };

  const savePendingBill = () => {
    if (cart.length === 0) {
      window.alert('购物车为空，无需挂单');
      return;
    }
    const note = window.prompt('挂单备注（可选，例如：客人暂离、先去验光）', '') ?? '';
    const bill: PendingBill = {
      id: genId(),
      createdAt: new Date().toISOString(),
      note: note.trim(),
      draft: {
        selectedStore,
        customerName,
        customerPhone,
        cart: cart.map((c) => ({ ...c })),
      },
    };
    setPendingBills((p) => [bill, ...p]);
    setCart([]);
    setUnitPriceDraftByLine({});
    setCustomerName('');
    setCustomerPhone('');
    window.alert('已挂单。可从「取单」恢复本单。');
  };

  const restorePendingBill = (bill: PendingBill) => {
    if (cart.length > 0) {
      const ok = window.confirm('当前购物车有商品，取回挂单将替换当前购物车与客人信息，是否继续？');
      if (!ok) return;
    }
    setSelectedStore(bill.draft.selectedStore);
    setCustomerName(bill.draft.customerName);
    setCustomerPhone(bill.draft.customerPhone);
    setUnitPriceDraftByLine({});
    setCart(filterOutLegacyQuickSaleLines(bill.draft.cart as CartItem[]).map(normalizeCartRx));
    setPendingBills((p) => p.filter((x) => x.id !== bill.id));
    setShowPendingModal(false);
  };

  const removePendingBill = (id: string) => {
    setPendingBills((p) => p.filter((x) => x.id !== id));
  };

  const patchOwnerPrice = (lineId: string, value: string) => {
    const parsed = value === '' ? null : Number(value);
    setCart((prev) =>
      prev.map((item) =>
        item.lineId === lineId
          ? { ...item, overrideUnitPrice: parsed === null || Number.isNaN(parsed) ? null : Math.max(0, parsed) }
          : item,
      ),
    );
  };

  const patchTintInfo = (lineId: string, tintId: string) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.lineId !== lineId) return item;
        if (!tintId) {
          return {
            ...item,
            tint_info: null,
          };
        }
        const preset = lensTintOptions.find((x) => x.id === tintId);
        if (!preset) return item;
        return {
          ...item,
          tint_info: {
            id: preset.id,
            name: preset.name,
            hex: preset.hex,
            surchargeYuan:
              typeof preset.surchargeYuan === 'number' && Number.isFinite(preset.surchargeYuan)
                ? Math.max(0, preset.surchargeYuan)
                : 0,
          },
          lens_type: `${(item.lens_type || '通用').replace(/\s*\/\s*染色:.+$/u, '')} / 染色:${preset.name}`,
        };
      }),
    );
  };

  const clearCartItems = useCallback(() => {
    if (cart.length === 0) return;
    if (!window.confirm('清空购物车全部商品？')) return;
    setCart([]);
    setUnitPriceDraftByLine({});
  }, [cart.length]);

  const openRxEditor = useCallback((lineId: string) => {
    setRxEditorLineId(lineId);
    setRxEditorMinimized(false);
    setRxPhotoFileName('');
    setRxRecognizing(false);
    setRxCheckoutHighlightIds((prev) => {
      if (!prev.has(lineId)) return prev;
      const next = new Set(prev);
      next.delete(lineId);
      return next;
    });
  }, []);

  const closeRxEditorFull = useCallback(() => {
    setRxEditorLineId(null);
    setRxFocusTarget(null);
    setRxPhotoFileName('');
    setRxRecognizing(false);
    setVisualEntryOpen(false);
    setVisualEntryLoading(false);
    setVisualEntryError(null);
    setVisualEntryPulse(false);
    setRxEditorMinimized(false);
    setRxPowerValidationError(null);
  }, []);

  const confirmRxEditorSave = useCallback(() => {
    if (!editingRxItem) {
      setRxEditorLineId(null);
      setRxFocusTarget(null);
      setRxEditorMinimized(false);
      setRxPowerValidationError(null);
      return;
    }
    const v = validateCartLineRxPowerEnvelope(editingRxItem);
    if (!v.ok) {
      setRxPowerValidationError(`${v.title}\n\n${v.body}`);
      return;
    }
    setRxPowerValidationError(null);
    setRxEditorLineId(null);
    setRxFocusTarget(null);
    setRxEditorMinimized(false);
  }, [editingRxItem]);

  const minimizeRxEditor = useCallback(() => {
    setRxEditorMinimized(true);
    setVisualEntryOpen(false);
    setVisualEntryLoading(false);
    setVisualEntryError(null);
    setVisualEntryPulse(false);
  }, []);

  /** 收起后入口放在「快捷结算」右侧栏 / 平板侧滑结算轨内，避免贴屏边的 fixed 浮条 */
  const renderRxMinimizedInCheckoutRail = () =>
    editingRxItem && rxEditorMinimized ? (
      <button
        type="button"
        onClick={() => setRxEditorMinimized(false)}
        className="w-full rounded-md border border-sky-300 bg-sky-50 px-2 py-1.5 text-center text-[11px] font-semibold leading-snug text-sky-950 hover:bg-sky-100 touch-manipulation"
      >
        验光单已收起 · 点击展开填写
      </button>
    ) : null;

  const getBaseUnitPrice = useCallback((item: CartItem) => {
    return (
      typeof item.overrideUnitPrice === 'number'
        ? item.overrideUnitPrice
        : Number((item.price * (1 - (item.discountPercent || 0) / 100)).toFixed(2))
    );
  }, []);

  const getFinalUnitPrice = useCallback((item: CartItem) => {
    const base =
      typeof item.overrideUnitPrice === 'number'
        ? item.overrideUnitPrice
        : Number((item.price * (1 - (item.discountPercent || 0) / 100)).toFixed(2));
    const tintSurcharge = Number(item.tint_info?.surchargeYuan || 0);
    return Number((base + (Number.isFinite(tintSurcharge) ? tintSurcharge : 0)).toFixed(2));
  }, []);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + getFinalUnitPrice(item) * item.quantity, 0),
    [cart, getFinalUnitPrice],
  );

  const rxReadonlyHighlightKey = useMemo(
    () => (rxCheckoutHighlightIds.size === 0 ? '' : [...rxCheckoutHighlightIds].sort().join(',')),
    [rxCheckoutHighlightIds],
  );

  useEffect(() => {
    setRxCheckoutHighlightIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      let removed = false;
      for (const id of prev) {
        const it = cart.find((c) => c.lineId === id);
        if (it && isLensProduct(it) && !isRxComplete(it.rx)) next.add(id);
        else removed = true;
      }
      if (!removed && next.size === prev.size) return prev;
      return next;
    });
  }, [cart]);

  /** 需验光的行与未填齐数量，用于提示「填在哪」与结算前引导 */
  const rxCartSummary = useMemo(() => {
    const rxLines = cart.filter((item) => isLensProduct(item));
    const incomplete = rxLines.filter((item) => !isRxComplete(item.rx));
    return { rxLineCount: rxLines.length, incompleteCount: incomplete.length };
  }, [cart]);

  const productInfoModalProducts = useMemo(() => {
    if (productInfoModalCategory == null) return [];
    return filterProductsByQuickCategory(products, productInfoModalCategory);
  }, [products, productInfoModalCategory]);

  const handleSearchCustomers = async () => {
    const keyword = queryKeyword.trim();
    if (!keyword) {
      setQueryRows([]);
      return;
    }
    if (!isCloudRestConfigured && !disableAuthMode) {
      window.alert(cloudRestConfigHint);
      return;
    }
    if (!isCloudRestConfigured && disableAuthMode) {
      setQueryRows([]);
      return;
    }
    setQuerying(true);
    let q = cloudRest
      .from('sales')
      .select(
        `
        id,
        created_at,
        quantity,
        total_price,
        customer_name,
        customer_phone,
        sale_no,
        product_category,
        product_brand,
        product_model,
        frame_type,
        lens_type,
        sale_status,
        refund_reason,
        products (name),
        stores (name)
      `,
      )
      .or(`customer_name.ilike.%${keyword}%,customer_phone.ilike.%${keyword}%,sale_no.ilike.%${keyword}%`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (queryStatus !== '全部') q = q.eq('sale_status', queryStatus);
    const { data, error } = await q;
    setQuerying(false);
    if (error) {
      window.alert('查询失败：' + toChineseErrorMessage(error.message));
      return;
    }
    setQueryRows((data ?? []) as QuerySale[]);
  };

  const reopenByCustomer = (row: QuerySale) => {
    const ok = window.confirm('将清空当前购物车，并回填该客人信息用于重开单，是否继续？');
    if (!ok) return;
    setCart([]);
    setUnitPriceDraftByLine({});
    setCustomerName((row.customer_name || '').trim());
    setCustomerPhone((row.customer_phone || '').trim());
    setPaymentMethod('cash');
  };

  const openRefundModal = (row: QuerySale) => {
    setRefundTarget(row);
    setRefundReasonInput('');
  };

  const submitRefund = async () => {
    if (!refundTarget) return;
    const reason = refundReasonInput.trim();
    if (!reason) {
      window.alert('请填写退单原因');
      return;
    }
    if (!isCloudRestConfigured && !disableAuthMode) {
      window.alert(cloudRestConfigHint);
      return;
    }
    if (!isCloudRestConfigured && disableAuthMode) {
      window.alert('演示模式下不支持退单（未连接云端销售数据）。');
      return;
    }
    setRefundSaving(true);
    const { error } = await cloudRest
      .from('sales')
      .update({
        sale_status: '已退单',
        refund_reason: reason,
      })
      .eq('id', refundTarget.id);
    setRefundSaving(false);
    if (error) {
      window.alert('退单失败：' + toChineseErrorMessage(error.message));
      return;
    }
    setRefundTarget(null);
    setRefundReasonInput('');
    await handleSearchCustomers();
  };

  /** alert 关闭后焦点常在 body，Electron 全局 keydown 会污染取镜码缓冲；聚焦第一个未填项并清空缓冲 */
  const focusAfterIncompleteRxAlert = useCallback((lineId: string, rx: CartItem['rx']) => {
    window.setTimeout(() => {
      orderScanBufRef.current = '';
      orderScanLastTsRef.current = 0;
      const miss = firstIncompleteRxField(rx);
      if (!miss) return;
      setRxEditorLineId(lineId);
      setRxEditorMinimized(false);
      setRxFocusTarget({ lineId, side: miss.side, field: miss.field });
    }, 0);
  }, []);

  useEffect(() => {
    if (!rxEditorLineId) return;
    if (editingRxItem) return;
    setRxEditorLineId(null);
    setRxFocusTarget(null);
    setRxPhotoFileName('');
    setRxRecognizing(false);
    setVisualEntryOpen(false);
    setVisualEntryLoading(false);
    setVisualEntryError(null);
    setVisualEntryPulse(false);
  }, [editingRxItem, rxEditorLineId]);

  useEffect(() => {
    if (!rxFocusTarget) return;
    const selector = `[data-rx-editor="${rxFocusTarget.lineId}"] [data-rx-field="${rxFocusTarget.side}-${String(rxFocusTarget.field)}"]`;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLInputElement)) return;
      const isCoarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
      if (isCoarsePointer) {
        el.focus({ preventScroll: true });
      } else {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setRxFocusTarget(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rxFocusTarget, rxEditorLineId]);

  /** 出单前校验（购物车、门店、客人、镜片验光） */
  const assertCanCheckout = (opts?: { lensRx?: 'enforce' | 'skip' }): boolean => {
    const lensRx = opts?.lensRx ?? 'enforce';
    if (!session?.user?.id && !localBypassMode && !disableAuthMode) {
      window.alert('请先登录云端账号后再结算（当前会话无效）。');
      return false;
    }
    if (cart.length === 0) {
      window.alert('购物车为空');
      return false;
    }
    if (!selectedStoreId && !localBypassMode && !disableAuthMode) {
      window.alert(
        stores.length === 0
          ? '未找到可用门店：请确认数据库中已有门店记录，或刷新页面后重试。若刚完成部署，请检查 DATABASE_URL 与 stores 表数据。'
          : '请选择有效门店：请在上方「当前门店」下拉框中重新选择一项后再结算。',
      );
      return false;
    }
    // RLS：非所有权账号必须绑定门店，且收银所选门店须与 profile.store_id 一致，否则会报「没有操作权限」
    if (profile && profile.role !== 'owner') {
      if (!profile.store_id) {
        window.alert(
          '当前账号未绑定所属门店，无法保存销售与扣库存。请联系部署管理员，在数据库 user_profiles 中为该账号设置 store_id 后重新登录。',
        );
        return false;
      }
      if (selectedStoreId !== profile.store_id) {
        window.alert(
          '收银台所选门店与您的所属门店不一致，云端策略会拒绝保存。请改选您的门店，或使用所有权账号操作。',
        );
        return false;
      }
    }
    if (lensRx === 'enforce') {
      const incomplete = cart.find((item) => isLensProduct(item) && !isRxComplete(item.rx));
      if (incomplete) {
        window.alert(
          `商品「${incomplete.name}」的屈光度数未按规则填完整。\n每只眼须填：球镜(DS)、瞳距(mm)；矫正视力选填。\n柱镜(DC)可不填；若填写了柱镜，则必须填写轴位。\n下加(ADD)选填。`,
        );
        focusAfterIncompleteRxAlert(incomplete.lineId, incomplete.rx);
        return false;
      }
    }
    return true;
  };

  const scheduleThermalReceiptFeedback = (r: MatrixThermalReceiptBuildResult) => {
    window.setTimeout(() => {
      if (r.payload) {
        setMatrixReceiptToast(
          'StandardEye：行业小票载荷已生成（价目矩阵 SKU 已校价），打印将优先使用专票版式。',
        );
        window.setTimeout(() => setMatrixReceiptToast(null), 4200);
      } else if (r.errors.length > 0) {
        setMatrixReceiptToast(`数据海关：${r.errors.join('；')}（仍可使用销售小票打印）`);
        window.setTimeout(() => setMatrixReceiptToast(null), 6800);
      }
    }, 0);
  };

  /**
   * 落库销售并扣库存。
   * @param skipOptionalPaymentLog 为 true 时不写 payment_transactions（已由扫码流程写入，或用户选择不记流水）
   */
  const finalizeSale = async (skipOptionalPaymentLog = false, paymentMethodForSale?: PaymentMethod) => {
    const pm = paymentMethodForSale ?? paymentMethod;
    if (!selectedStoreId && !localBypassMode && !disableAuthMode) {
      window.alert('结算失败：门店ID无效，请重新选择门店后重试。');
      return false;
    }
    if (!localBypassMode && !disableAuthMode && !stores.some((s) => s.id === selectedStoreId)) {
      window.alert('结算失败：当前门店不存在或已变更，请重新选择门店后重试。');
      return false;
    }

    if (finalizeSaleLockRef.current) {
      return false;
    }
    finalizeSaleLockRef.current = true;
    const saleCart = snapshotCartForSale(cart);
    const totalSnap = saleCart.reduce((sum, item) => sum + getFinalUnitPrice(item) * item.quantity, 0);

    try {
    const meituanVoucherSnap = pm === 'meituan_douyin' ? meituanVoucher.trim() : '';
    // 生成单据号：门店 + 日期 + 当天序号（同一笔结算写入多条销售明细，sale_no 相同）
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const ymd = `${yyyy}${mm}${dd}`;
    const storeCode = String(selectedStoreId).replace(/-/g, '').slice(0, 4).toUpperCase();
    const localSaleNo = `${storeCode || 'LOCAL'}-${ymd}-${String(Date.now()).slice(-4)}`;
    const saleStatus: SaleStatus = saleCart.some((item) => isLensProduct(item)) ? '待加工' : '已完成';

    if (localBypassMode || disableAuthMode) {
      const primarySaleId = genId();
      const orderQrPayload = buildOrderQrPayload(localSaleNo, primarySaleId);
      const settledOrderObject: PrintOrder = {
        order_no: localSaleNo,
        created_at: new Date().toISOString(),
        store_name: resolveStoreDisplayName(stores.find((s) => s.id === selectedStoreId)?.name),
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        payment_method: pm,
        meituan_voucher: pm === 'meituan_douyin' ? meituanVoucherSnap : '',
        total_amount: totalSnap,
        items: saleCart.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unit_price: getFinalUnitPrice(item),
          line_total: getFinalUnitPrice(item) * item.quantity,
          rx: isLensProduct(item) ? item.rx : null,
          tintInfo: item.tint_info || null,
        })),
      };
      const thermalMeta: ReceiptMeta = {
        storeName: String(settledOrderObject.store_name || '').trim() || '门店',
        orderNo: localSaleNo,
        createdAt: String(settledOrderObject.created_at || ''),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
      };
      const thermalBuild = tryBuildEyewearReceiptFromMatrixCart({
        cart: saleCart,
        meta: thermalMeta,
        getFinalUnitPrice,
      });
      setLastOrder({
        store: stores.find((s) => s.id === selectedStoreId)?.name,
        customer: { name: customerName.trim(), phone: customerPhone.trim() },
        items: [...saleCart],
        total: totalSnap,
        time: new Date().toLocaleString(),
        saleNo: localSaleNo,
        primarySaleId,
        orderQrPayload,
        paymentMethod: pm,
        meituanVoucher: pm === 'meituan_douyin' ? meituanVoucherSnap : undefined,
        orderObject: settledOrderObject,
        thermalReceiptPayload: thermalBuild.payload,
        thermalReceiptErrors: thermalBuild.errors.length ? thermalBuild.errors : undefined,
      });
      scheduleThermalReceiptFeedback(thermalBuild);
      setShowReceipt(true);
      setCart([]);
      setUnitPriceDraftByLine({});
      setCustomerName('');
      setCustomerPhone('');
      setMeituanVoucher('');
      if (typeof window !== 'undefined') window.localStorage.removeItem(CASHIER_DRAFT_KEY);

      return true;
    }

    // 本地唯一单号：避免结算时依赖云端查询历史序号，减少点击「确定结算」等待
    const saleNo = `${storeCode}-${ymd}-${String(Date.now()).slice(-6)}`;

    // 1) 扣减库存：优先走 Prisma（无记录则自动建档，库存记为 -售出数量）；失败且已配置云端 REST 时再走网关直连库存逻辑
    const qtyByProductId = new Map<string, number>();
    for (const item of saleCart) {
      if (!isUuid(item.id)) continue;
      qtyByProductId.set(item.id, (qtyByProductId.get(item.id) || 0) + item.quantity);
    }

    const productIds = Array.from(qtyByProductId.keys());
    const prismaSaleLines = saleCart
      .filter((item) => isUuid(item.id))
      .map((item) => ({
        product_id: item.id,
        quantity: item.quantity,
        name: item.name,
        price: getFinalUnitPrice(item),
        store_id: selectedStoreId || null,
      }));

    let stockAppliedViaPrisma = false;
    if (prismaSaleLines.length > 0) {
      try {
        const resp = await fetch('/api/inventory/sale-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: prismaSaleLines }),
        });
        const j = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (resp.ok && j.ok) {
          stockAppliedViaPrisma = true;
        } else if (resp.status !== 503) {
          window.alert('扣减库存失败：' + (j.error || resp.statusText));
          return false;
        }
      } catch (e) {
        console.warn('[cashier] sale-stock:', e);
      }
    }

    if (!stockAppliedViaPrisma && isCloudRestConfigured && productIds.length > 0) {
      const productsData = await localCache.getProducts();
      const stockMap = new Map<string, number>();
      for (const product of productsData) {
        if (productIds.includes(product.id)) {
          stockMap.set(product.id, product.stock || 0);
        }
      }

      if (stockMap.size === 0) {
        const { data: stockRows, error: stockError } = await cloudRest
          .from('products')
          .select('id,stock')
          .in('id', productIds);

        if (stockError) {
          window.alert('库存检查失败：' + toChineseErrorMessage(stockError.message));
          return false;
        }

        for (const row of stockRows ?? []) stockMap.set(row.id, row.stock);
      }

      const revertStocks = new Map<string, number>(stockMap);
      const stockDecrementResults = await Promise.all(
        productIds.map(async (id) => {
          const prev = revertStocks.get(id) ?? 0;
          const next = prev - (qtyByProductId.get(id) || 0);
          return cloudRest.from('products').update({ stock: next }).eq('id', id);
        }),
      );
      const decrementErr = stockDecrementResults.find((r) => r.error)?.error;
      if (decrementErr) {
        window.alert('扣减库存失败：' + toChineseErrorMessage(decrementErr.message));
        return false;
      }
    } else if (!stockAppliedViaPrisma && !isCloudRestConfigured && productIds.length > 0) {
      window.alert('扣减库存失败：请配置 DATABASE_URL（Prisma 库存）或 ALIYUN_REST_URL / ALIYUN_REST_ANON_KEY（云端 REST）。');
      return false;
    }

    // 2) 落库销售明细：处方只给“镜片商品”；自主配镜等非 UUID 行 product_id 为空
    const salesData = saleCart.map((item) => ({
      product_id: isUuid(item.id) ? item.id : null,
      store_id: selectedStoreId,
      sale_no: saleNo,
      sale_status: saleStatus,
      quantity: item.quantity,
      total_price: getFinalUnitPrice(item) * item.quantity,
      original_unit_price: item.price,
      final_unit_price: getFinalUnitPrice(item),
      discount_percent: item.discountPercent || 0,
      prescription: isLensProduct(item) ? item.rx : null,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      product_category: isCustomComboLine(item)
        ? CUSTOM_COMBO_CATEGORY
        : item.category?.trim() || null,
      product_brand: isCustomComboLine(item) ? null : item.brand?.trim() || null,
      product_model: isCustomComboLine(item)
        ? item.model?.trim() || item.name.trim() || '自主配镜'
        : item.model?.trim() || null,
      frame_type: item.frame_type?.trim() || null,
      lens_type: item.tint_info?.name
        ? `${(item.lens_type || '').replace(/\s*\/\s*染色:.+$/u, '').trim() || '通用'} / 染色:${item.tint_info.name}`
        : item.lens_type?.trim() || null,
    }));

    // 保存到本地缓存（并发写入，避免逐条 await 导致卡顿）
    await Promise.all(salesData.map((saleData) => localCache.saveSale(saleData)));

    // 云端写入改为后台异步：不阻塞结算完成与打印
    if (isCloudRestConfigured) {
      void (async () => {
        try {
          const { error } = await withTimeoutFallback(
            cloudRest.from('sales').insert(salesData).select('id'),
            2200,
            { error: { message: 'timeout' } } as any,
          );
          if (error) {
            console.warn('写入销售单到云端失败：', error.message || error);
          }
        } catch (e) {
          console.warn('写入销售单到云端异常：', e);
        }
      })();
    }

    // 生成本地ID作为备用
    const primarySaleId = genId();
    const orderQrPayload = buildOrderQrPayload(saleNo, primarySaleId);

    // 微信/支付宝：出单成功后尽力记一笔流水（与真实通道无关，便于对账；失败不阻卖出）
    if (!skipOptionalPaymentLog && pm !== 'cash' && isCloudRestConfigured) {
      void (async () => {
        try {
          const { error: payErr } = await withTimeoutFallback(
            cloudRest.from('payment_transactions').insert({
              store_id: selectedStoreId,
              channel: pm,
              amount: totalSnap,
              status: 'paid',
              customer_name: customerName.trim(),
              customer_phone: customerPhone.trim(),
              cart_snapshot: saleCart,
              external_txn_no: `${saleNo}-${pm}`,
              paid_at: new Date().toISOString(),
            }),
            1800,
            { error: { message: 'timeout' } } as any,
          );
          if (payErr) {
            console.warn('[cashier] payment_transactions:', payErr.message || payErr);
          }
        } catch (e) {
          console.warn('[cashier] payment_transactions exception:', e);
        }
      })();
    }

    const settledOrderObject: PrintOrder = {
      order_no: saleNo,
      created_at: new Date().toISOString(),
      store_name: resolveStoreDisplayName(stores.find((s) => s.id === selectedStoreId)?.name),
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      payment_method: pm,
      meituan_voucher: pm === 'meituan_douyin' ? meituanVoucherSnap : '',
      total_amount: totalSnap,
      items: saleCart.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit_price: getFinalUnitPrice(item),
        line_total: getFinalUnitPrice(item) * item.quantity,
        rx: isLensProduct(item) ? item.rx : null,
        tintInfo: item.tint_info || null,
      })),
    };

    const thermalMetaCloud: ReceiptMeta = {
      storeName: String(settledOrderObject.store_name || '').trim() || '门店',
      orderNo: saleNo,
      createdAt: String(settledOrderObject.created_at || ''),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
    };
    const thermalBuildCloud = tryBuildEyewearReceiptFromMatrixCart({
      cart: saleCart,
      meta: thermalMetaCloud,
      getFinalUnitPrice,
    });

    setLastOrder({
      store: stores.find((s) => s.id === selectedStoreId)?.name,
      customer: { name: customerName.trim(), phone: customerPhone.trim() },
      items: [...saleCart],
      total: totalSnap,
      time: new Date().toLocaleString(),
      saleNo,
      primarySaleId,
      orderQrPayload,
      paymentMethod: pm,
      meituanVoucher: pm === 'meituan_douyin' ? meituanVoucherSnap : undefined,
      orderObject: settledOrderObject,
      thermalReceiptPayload: thermalBuildCloud.payload,
      thermalReceiptErrors: thermalBuildCloud.errors.length ? thermalBuildCloud.errors : undefined,
    });
    scheduleThermalReceiptFeedback(thermalBuildCloud);
    setShowReceipt(true);
    setCart([]);
    setUnitPriceDraftByLine({});
    setCustomerName('');
    setCustomerPhone('');
    setMeituanVoucher('');
    if (typeof window !== 'undefined') window.localStorage.removeItem(CASHIER_DRAFT_KEY);
    void fetchData();

    return true;
    } finally {
      finalizeSaleLockRef.current = false;
    }
  };

  /** 一键现金：不经过「选结算方式」；落库方式固定为 cash */
  const handleCashCheckout = async () => {
    if (!assertCanCheckout({ lensRx: 'skip' })) return;
    const incompleteLens = cart.filter((item) => isLensProduct(item) && !isRxComplete(item.rx));
    if (incompleteLens.length > 0) {
      setRxCheckoutHighlightIds(new Set(incompleteLens.map((i) => i.lineId)));
      const firstId = incompleteLens[0].lineId;
      requestAnimationFrame(() => {
        readonlyCartScrollRef.current
          ?.querySelector(`#cashier-readonly-line-${firstId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return;
    }
    setRxCheckoutHighlightIds(new Set());
    if (checkoutSubmitting) return;
    setCheckoutSubmitting(true);
    try {
      const ok = await finalizeSale(false, 'cash');
      if (ok) {
        setPaymentMethod('cash');
        setMeituanVoucher('');
        setRxCheckoutHighlightIds(new Set());
        setSuccessToast('现金收款成功');
        window.setTimeout(() => setSuccessToast(null), 2200);
      }
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  checkoutLatestRef.current = { assertCanCheckout, handleCheckout: handleCashCheckout };

  /** 自动填入测试客人 + 一条非镜片行并走与「生成账单」相同的结算与预览（便于反复试打） */
  const handleTestOneClickCheckout = () => {
    if (!TEST_ONE_CLICK_CHECKOUT_ENABLED) return;
    if (checkoutSubmitting || paying) return;

    const resolveTestStoreSelection = (): string | null => {
      if (localBypassMode || disableAuthMode) {
        if (selectedStoreId) return selectedStore;
        return stores[0]?.id ?? '';
      }
      if (profile && profile.role !== 'owner') {
        return profile.store_id || null;
      }
      if (selectedStoreId) return selectedStore;
      return stores[0]?.id ?? null;
    };

    const nextStoreRaw = resolveTestStoreSelection();
    const nextStore = nextStoreRaw && isUuid(nextStoreRaw) ? nextStoreRaw : '';

    if (!localBypassMode && !disableAuthMode) {
      if (!nextStore) {
        window.alert('无法测试出单：请先配置门店或选择门店后再试。');
        return;
      }
      if (!stores.some((s) => s.id === nextStore)) {
        window.alert('当前账号绑定门店不在门店列表中，请刷新页面后重试。');
        return;
      }
    }

    const testLine: CartItem = {
      id: 'local-test-checkout-line',
      name: '【测试】消费单',
      price: 0.01,
      stock: 999999,
      category: '其他',
      lineId: genId(),
      quantity: 1,
      rx: { right: emptyEye(), left: emptyEye() },
      discountPercent: 0,
    };

    flushSync(() => {
      if (nextStore) setSelectedStore(nextStore);
      setCustomerName('测试客人');
      setCustomerPhone('13800000000');
      setPaymentMethod('cash');
      setMeituanVoucher('');
      setUnitPriceDraftByLine({});
      setCart([testLine]);
    });

    window.setTimeout(() => {
      void checkoutLatestRef.current.handleCheckout();
    }, 0);
  };

  const handleManualReceiptPrint = useCallback(async () => {
    if (!lastOrder || receiptPrinting) return;
    const receiptForPrint = lastOrder.thermalReceiptPayload ?? lastOrder.orderObject;
    if (!receiptForPrint) return;
    setReceiptPrinting(true);
    try {
      const hasElectronBridge =
        typeof window !== 'undefined' &&
        Boolean((window as any).electronAPI?.print || (window as any).electronAPI?.glassOrderPrintTest);
      const supportsWebBluetooth = hasWebBluetooth();
      const isCoarsePointer =
        typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
      if (!hasElectronBridge && supportsWebBluetooth && isCoarsePointer) {
        await printReceiptViaWebBluetooth(receiptForPrint);
        return;
      }
      if (!hasElectronBridge && isCoarsePointer && !supportsWebBluetooth) {
        if (!cashierPrintBundleRef.current) {
          window.alert('打印区域未就绪，请稍候再试或关闭预览后重新结算打开。');
          return;
        }
        printCashierBundleReact();
        return;
      }
      await printReceiptWithElectronPreference(receiptForPrint);
    } catch (e) {
      console.error('手动打印失败:', e);
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`打印失败：${toChineseErrorMessage(msg)}`);
    } finally {
      setReceiptPrinting(false);
    }
  }, [lastOrder, receiptPrinting, printCashierBundleReact]);

  const handleBluetoothReceiptPrint = useCallback(async () => {
    if (!lastOrder || receiptBtPrinting) return;
    const receiptForPrint = lastOrder.thermalReceiptPayload ?? lastOrder.orderObject;
    if (!receiptForPrint) return;
    setReceiptBtPrinting(true);
    try {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        window.alert('蓝牙打印需要 HTTPS（或 localhost）环境。当前不是安全上下文，浏览器会拦截设备选择弹窗。');
        return;
      }
      const noBt = webBluetoothUnavailableReason();
      if (noBt) {
        window.alert(noBt);
        return;
      }
      await printReceiptViaWebBluetooth(receiptForPrint);
    } catch (e) {
      console.error('蓝牙打印失败:', e);
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`蓝牙打印失败：${toChineseErrorMessage(msg)}`);
    } finally {
      setReceiptBtPrinting(false);
    }
  }, [lastOrder, receiptBtPrinting]);

  const stopMeituanScanner = useCallback(() => {
    if (meituanScanTimerRef.current) {
      window.clearInterval(meituanScanTimerRef.current);
      meituanScanTimerRef.current = null;
    }
    if (meituanStreamRef.current) {
      for (const track of meituanStreamRef.current.getTracks()) track.stop();
      meituanStreamRef.current = null;
    }
    setMeituanScanning(false);
  }, []);

  const submitMeituanVerify = useCallback(
    async (voucherCode: string) => {
      const code = voucherCode.trim();
      if (!code) return;
      if (!selectedStoreId) {
        window.alert('请先选择门店后再进行美团核销。');
        return;
      }
      if (meituanVerifySubmitting) return;
      setMeituanVerifySubmitting(true);
      try {
        const resp = await fetch('/api/meituan/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voucherCode: code,
            storeId: selectedStoreId,
            amount: total,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
          }),
        });
        const json = (await resp.json()) as { ok?: boolean; error?: string; message?: string };
        if (!resp.ok || !json.ok) {
          window.alert(`核销失败：${toChineseErrorMessage(String(json.error ?? `HTTP ${resp.status}`))}`);
          return;
        }
        setMeituanVoucher(code);
        setPaymentMethod('meituan_douyin');
        window.alert(json.message || '核销成功');
        setShowMeituanVerifyModal(false);
        stopMeituanScanner();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(`核销失败：${toChineseErrorMessage(msg)}`);
      } finally {
        setMeituanVerifySubmitting(false);
      }
    },
    [customerName, customerPhone, meituanVerifySubmitting, selectedStoreId, stopMeituanScanner, total],
  );

  const openMeituanVerifyModal = useCallback(async () => {
    setShowMeituanVerifyModal(true);
    setMeituanDetectedCode('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      meituanStreamRef.current = stream;
      const videoEl = meituanVideoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      setMeituanScanning(true);

      type BarcodeResult = { rawValue?: string };
      type BarcodeDetectorInstance = { detect: (input: HTMLVideoElement) => Promise<BarcodeResult[]> };
      type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorInstance;
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Detector) {
        const detector = new Detector({ formats: ['qr_code', 'ean_13', 'code_128'] });
        meituanScanTimerRef.current = window.setInterval(async () => {
          if (meituanVerifySubmitting) return;
          const el = meituanVideoRef.current;
          if (!el) return;
          try {
            const found = await detector.detect(el);
            const value = String(found?.[0]?.rawValue ?? '').trim();
            if (!value) return;
            setMeituanDetectedCode(value);
            await submitMeituanVerify(value);
          } catch {
            // ignore detect frame errors
          }
        }, 500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMeituanScanning(false);
      window.alert(`无法打开摄像头：${toChineseErrorMessage(msg)}\n可在弹窗中手工输入券码核销。`);
    }
  }, [meituanVerifySubmitting, submitMeituanVerify]);

  /** 需要先扫顾客付款码并把码写入流水时再打开弹窗（与「确认结算」一键出单分离） */
  const openScanPayModal = () => {
    if (checkoutSubmitting || paying) return;
    if (!assertCanCheckout()) return;
    const wasCash = paymentMethod === 'cash';
    if (wasCash) flushSync(() => setPaymentMethod('wechat'));
    const pm = wasCash ? 'wechat' : paymentMethod;
    if (pm !== 'meituan_douyin') setScanCode('');
    setShowScanModal(true);
  };

  const handleScanPay = async () => {
    if (!scanCode.trim() && paymentMethod !== 'meituan_douyin') {
      window.alert('请用扫码枪扫描顾客付款码，或点击「线下已收款，直接完成订单」。');
      scanCodeInputRef.current?.focus();
      return;
    }
    const extNo =
      (paymentMethod === 'meituan_douyin' ? meituanVoucher.trim() : scanCode.trim()) ||
      (paymentMethod === 'meituan_douyin' ? `meituan-douyin-manual-${Date.now()}` : '');
    setPaying(true);
    let insertError: { message: string } | null = null;
    try {
      const { error } = await cloudRest.from('payment_transactions').insert({
        store_id: selectedStoreId,
        channel: paymentMethod,
        amount: total,
        status: 'paid',
        customer_name: customerName,
        customer_phone: customerPhone,
        cart_snapshot: cart,
        external_txn_no: extNo,
        paid_at: new Date().toISOString(),
      });
      insertError = error;
    } finally {
      setPaying(false);
    }
    if (insertError) {
      const raw = insertError.message || '';
      const hint =
        /permission|policy|row level|RLS|42501|violates/i.test(raw) || /权限|策略/i.test(raw)
          ? '\n\n提示：请确认账号所属门店与收银台所选门店一致；或未执行 payment_transactions 相关迁移。也可使用下方「线下已收款」直接完成销售。'
          : '';
      window.alert('收款流水记账失败：' + toChineseErrorMessage(raw) + hint);
      orderScanBufRef.current = '';
      orderScanLastTsRef.current = 0;
      setShowScanModal(false);
      setScanCode('');
      return;
    }
    setCheckoutSubmitting(true);
    try {
      const ok = await finalizeSale(true);
      if (ok) {
        setShowScanModal(false);
        setScanCode('');
      }
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  /** 弹窗内：已线下收款，不重复记流水，直接出单 */
  const completeSaleSkipPaymentLog = async () => {
    const ok = window.confirm(
      '确认顾客已完成付款（现金、刷卡或其他方式）？\n将直接生成销售单；若刚才未扫付款码，则本笔不会另记支付流水。',
    );
    if (!ok) return;
    if (checkoutSubmitting) return;
    setCheckoutSubmitting(true);
    try {
      const done = await finalizeSale(true);
      if (done) {
        setShowScanModal(false);
        setScanCode('');
      }
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  const resetByFixedTemplate = () => {
    const ok = window.confirm('将按固定模板清空当前单据，所有信息需要重选，是否继续？');
    if (!ok) return;
    setSelectedStore('');
    setCustomerName('');
    setCustomerPhone('');
    setCart([]);
    setUnitPriceDraftByLine({});
    setPaymentMethod('cash');
    setQueryKeyword('');
    setQueryRows([]);
    setShowScanModal(false);
    setScanCode('');
    setMeituanVoucher('');
    setCustomComboSummary('');
    setCustomComboFrame('');
    setCustomComboLens('');
    setCustomComboPrice('');
    if (typeof window !== 'undefined') window.localStorage.removeItem(CASHIER_DRAFT_KEY);
  };

  if (authLoading) {
    return (
      <div className="flex justify-center items-center h-64 text-gray-600">正在加载账号与权限…</div>
    );
  }
  if (!hasPermission('cashier.view')) {
    const roleLabel = profile?.role ? roleNameMap[profile.role] : '未识别';
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-amber-200 bg-amber-50/90 p-6 text-sm text-amber-950 space-y-3">
        <h2 className="text-lg font-bold text-amber-900">无法使用收银台</h2>
        <p>
          当前登录角色为「{roleLabel}」，账号未开通收银台权限（<code className="text-xs bg-white/80 px-1 rounded">cashier.view</code>
          ）。
        </p>
        <p className="text-xs text-amber-800/90">
          若侧栏菜单中看不到「收银台」，可在侧栏菜单设置中勾选显示；若入口可见但仍提示无权限，请按下方说明开通 <code className="text-[11px]">cashier.view</code>。
        </p>
        <p className="text-xs text-amber-800/90">
          若已开启正式登录（<code className="text-[11px]">NEXT_PUBLIC_ENABLE_AUTH=true</code>），请部署管理员在数据库 / 策略中为该角色开启{' '}
          <code className="text-[11px]">cashier.view</code>。
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="w-full py-2.5 rounded-xl bg-amber-700 text-white font-medium hover:bg-amber-800"
        >
          返回工作台
        </button>
      </div>
    );
  }
  if (dataLoading) {
    return (
      <div className="flex justify-center items-center h-64 text-gray-600">正在加载商品与门店…</div>
    );
  }

  const preferBluetoothPrimaryPrint =
    typeof window !== 'undefined' &&
    hasWebBluetooth() &&
    !Boolean((window as any).electronAPI?.print || (window as any).electronAPI?.glassOrderPrintTest) &&
    Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const isCoarsePointerDevice = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const hasElectronBridgeRender =
    typeof window !== 'undefined' &&
    Boolean((window as any).electronAPI?.print || (window as any).electronAPI?.glassOrderPrintTest);
  const webBtUnavailableHint = typeof window !== 'undefined' ? webBluetoothUnavailableReason() : null;

  return (
    <div className="space-y-4 xl:space-y-6 overscroll-y-none max-xl:pb-[max(0.75rem,env(safe-area-inset-bottom))] xl:pb-0 min-h-0 print:h-auto print:min-h-0 print:max-h-none print:overflow-visible">
      <AnimatePresence>
        {successToast ? (
          <motion.div
            key="cashier-success-toast"
            role="status"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            className="fixed top-3 left-1/2 z-[55] max-w-[min(92vw,20rem)] -translate-x-1/2 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg"
          >
            {successToast}
          </motion.div>
        ) : null}
        {matrixReceiptToast ? (
          <motion.div
            key="cashier-matrix-receipt-toast"
            role="status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed top-[3.25rem] left-1/2 z-[55] max-w-[min(94vw,26rem)] -translate-x-1/2 rounded-lg bg-amber-700 px-3 py-2 text-center text-xs font-semibold leading-snug text-white shadow-lg"
          >
            {matrixReceiptToast}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:items-center">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800">收银台</h1>
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Library className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>可查价格手册（数字化价目）；配镜厚度工具见光学实验室</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/catalog')}
            className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 font-semibold inline-flex items-center gap-1.5"
          >
            <Library className="h-4 w-4 shrink-0" aria-hidden />
            价格手册
          </button>
          <button
            type="button"
            onClick={() => navigate('/lens-physics')}
            className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100 font-semibold"
          >
            光学实验室
          </button>
          <button
            type="button"
            onClick={resetByFixedTemplate}
            className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          >
            固定模板（全部重选）
          </button>
          {TEST_ONE_CLICK_CHECKOUT_ENABLED ? (
            <>
              <button
                type="button"
                onClick={() => handleTestOneClickCheckout()}
                disabled={paying || checkoutSubmitting}
                title="自动填入测试客人与一条测试商品，现金结算并打开小票预览（不落 SKU 库存）"
                className="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-950 font-semibold hover:bg-amber-100 disabled:opacity-50"
              >
                测试一键出单
              </button>
              <button
                type="button"
                onClick={() => window.alert(runCashierAdapterDemoMissingPd())}
                disabled={paying || checkoutSubmitting}
                title="触发 MissingFieldError：无瞳距 PD"
                className="min-h-[44px] px-2 py-2 text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-900 font-semibold hover:bg-rose-100 disabled:opacity-50"
              >
                模拟 PD 缺失
              </button>
              <button
                type="button"
                onClick={() => window.alert(runCashierAdapterDemoInvalidSphereStep())}
                disabled={paying || checkoutSubmitting}
                title="触发 InvalidFieldError：球镜非 0.25 步进"
                className="min-h-[44px] px-2 py-2 text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-900 font-semibold hover:bg-rose-100 disabled:opacity-50"
              >
                模拟步进错误
              </button>
            </>
          ) : null}
          <span className="text-sm text-gray-500">当前门店：</span>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <StandardLayout
        variant="cashier-two"
        className="h-auto min-h-0 xl:h-[calc(100dvh-12rem)] xl:min-h-[640px] max-xl:gap-3 print:h-auto print:min-h-0 print:max-h-none print:overflow-visible xl:print:h-auto xl:print:max-h-none"
      >
        <StandardLayout.LeftSlot className="space-y-4 print:overflow-visible print:max-h-none">
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按分类打开库存商品弹窗">
              {([
                { id: 'frame', label: '镜框' },
                { id: 'lens', label: '镜片' },
                { id: 'package', label: '套餐' },
                { id: 'other', label: '其他' },
              ] as Array<{ id: Exclude<ProductQuickCategory, 'all'>; label: string }>).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setProductInfoModalCategory(x.id)}
                  className="px-4 py-2 text-sm rounded-lg border font-semibold bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                >
                  {x.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setProductInfoModalCategory('all')}
                className="px-3 py-2 text-xs rounded-lg border font-semibold bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              >
                全部
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-2 space-y-1.5">
            <div className="flex items-center gap-1 text-[11px] font-bold text-violet-900">
              <Glasses className="h-3.5 w-3.5 shrink-0" />
              自主配镜
            </div>
            <input
              value={customComboSummary}
              onChange={(e) => {
                setCustomComboSummary(e.target.value);
                setCustomComboError(null);
              }}
              className="w-full rounded-md border border-violet-200/80 bg-white px-2 py-1.5 text-xs"
              placeholder="摘要（可选）"
            />
            <input
              value={customComboFrame}
              onChange={(e) => {
                setCustomComboFrame(e.target.value);
                setCustomComboError(null);
              }}
              className={`w-full rounded-md border bg-white px-2 py-1.5 text-xs ${
                customComboError ? 'border-red-400' : 'border-violet-200/80'
              }`}
              placeholder="镜框（选填）"
            />
            <input
              value={customComboLens}
              onChange={(e) => {
                setCustomComboLens(e.target.value);
                setCustomComboError(null);
              }}
              className={`w-full rounded-md border bg-white px-2 py-1.5 text-xs ${
                customComboError ? 'border-red-400' : 'border-violet-200/80'
              }`}
              placeholder="镜片（选填）"
            />
            <div className="flex flex-wrap items-stretch gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={customComboPrice}
                onChange={(e) => {
                  setCustomComboPrice(sanitizePriceDraft(e.target.value));
                  setCustomComboError(null);
                }}
                className={`min-w-0 flex-1 rounded-md border bg-white px-2 py-1.5 text-xs sm:max-w-[7rem] ${
                  customComboError ? 'border-red-400' : 'border-violet-200/80'
                }`}
                placeholder="成套价"
              />
              <button
                type="button"
                onClick={addCustomComboLine}
                className="shrink-0 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
              >
                加入
              </button>
            </div>
            {customComboError ? (
              <p className="text-[11px] leading-snug text-red-700">{customComboError}</p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white p-2 xl:p-3">
            <div className="mb-1.5 flex shrink-0 items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">已选明细</h3>
              <span className="text-[11px] text-gray-500">
                {cart.length} 项 · 核对摘要 · 镜片行可点击填验光
              </span>
            </div>
            <div
              ref={readonlyCartScrollRef}
              className="min-h-0 max-xl:max-h-[min(42vh,20rem)] xl:max-h-[min(50vh,24rem)] overflow-y-auto overscroll-y-contain pr-0.5"
            >
              <ReadonlyCartBlock
                cart={cart}
                getFinalUnitPrice={getFinalUnitPrice}
                getBaseUnitPrice={getBaseUnitPrice}
                highlightLineIdsKey={rxReadonlyHighlightKey}
                onEditRx={openRxEditor}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white p-2 xl:p-3">
            <div className="mb-1.5 flex shrink-0 items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">行内操作</h3>
              <span className="text-[11px] text-gray-500">数量 · 折扣 · 改价 · 染色 · 验光</span>
            </div>
            <CartLineOperations
              cart={cart}
              profile={profile}
              allowSalesEdit={allowSalesEdit}
              lensTintOptions={lensTintOptions}
              unitPriceDraftByLine={unitPriceDraftByLine}
              setUnitPriceDraftByLine={setUnitPriceDraftByLine}
              sanitizePriceDraft={sanitizePriceDraft}
              updateQuantity={updateQuantity}
              patchDiscount={patchDiscount}
              patchOwnerPrice={patchOwnerPrice}
              patchTintInfo={patchTintInfo}
              openRxEditor={openRxEditor}
            />
          </div>
        </StandardLayout.LeftSlot>

        <StandardLayout.RightSlot className="max-xl:hidden h-full min-h-0 print:h-auto print:min-h-0 print:max-h-none print:overflow-visible">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm [contain:layout_paint]">
            <div className="sticky top-0 z-[2] shrink-0 space-y-1 border-b border-gray-100 bg-white/95 px-2 pb-1.5 pt-2 leading-none backdrop-blur sm:px-2.5">
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={savePendingBill}
                  className="inline-flex min-h-[2rem] items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold leading-none text-amber-900 hover:bg-amber-100"
                >
                  <ClipboardList className="h-3 w-3 shrink-0" />
                  挂单
                </button>
                <button
                  type="button"
                  onClick={() => setShowPendingModal(true)}
                  disabled={pendingBills.length === 0}
                  className="inline-flex min-h-[2rem] items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold leading-none text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  取单
                  {pendingBills.length > 0 ? (
                    <span className="min-w-[1.1rem] rounded-full bg-slate-800 px-1 text-center text-[9px] leading-none text-white">
                      {pendingBills.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={clearCartItems}
                  disabled={cart.length === 0}
                  className="inline-flex min-h-[2rem] items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold leading-none text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                >
                  清空
                </button>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-gray-400">快捷结算</p>
                <span className="text-[10px] font-medium text-gray-400">固定操作位</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] leading-none"
                  placeholder="客人姓名（选填）"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] leading-none"
                  placeholder="联系电话（选填）"
                />
              </div>
              {renderRxMinimizedInCheckoutRail()}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-0.5 [content-visibility:auto] sm:px-2.5 xl:[scrollbar-gutter:stable]">
              <QuickCheckoutList
                cart={cart}
                density="dense"
                getFinalUnitPrice={getFinalUnitPrice}
                onRemove={removeFromCart}
              />
            </div>
            <div className="shrink-0 space-y-2 border-t border-gray-200 bg-white p-2.5 sm:p-3">
              <div className="flex items-end justify-between gap-2">
                <span className="text-xs text-gray-500">总金额</span>
                <span className="text-xl font-bold tabular-nums tracking-tight text-gray-900">￥{total.toFixed(2)}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCashCheckout()}
                disabled={paying || checkoutSubmitting || cart.length === 0}
                className="w-full min-h-[44px] rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {checkoutSubmitting ? '结算中…' : '现金结算'}
              </button>
              <button
                type="button"
                onClick={openScanPayModal}
                disabled={paying || checkoutSubmitting || cart.length === 0}
                className="w-full min-h-[44px] rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                扫码支付并结算
              </button>
              <button
                type="button"
                onClick={() => void openMeituanVerifyModal()}
                disabled={checkoutSubmitting || meituanVerifySubmitting}
                className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              >
                {meituanVerifySubmitting ? '核销中…' : '扫券核销（美团）'}
              </button>
            </div>
          </div>
        </StandardLayout.RightSlot>
      </StandardLayout>

      <div className="xl:hidden">
        {checkoutDrawerOpen ? (
          <div
            role="presentation"
            className="fixed inset-0 z-[43] bg-black/40"
            onClick={() => setCheckoutDrawerOpen(false)}
          />
        ) : null}
        <div
          className={`fixed right-0 top-1/2 z-[44] flex max-h-[min(92dvh,900px)] w-[min(calc(100vw-0.5rem),22rem)] -translate-y-1/2 will-change-transform transition-transform duration-300 ease-out motion-reduce:transition-none ${
            checkoutDrawerOpen ? 'translate-x-0' : 'translate-x-[calc(100%-2.5rem)]'
          }`}
        >
          <button
            type="button"
            onClick={() => setCheckoutDrawerOpen((o) => !o)}
            aria-expanded={checkoutDrawerOpen}
            className="flex h-28 w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-l-xl border border-r-0 border-gray-200 bg-white py-2 text-gray-700 shadow-lg touch-manipulation"
          >
            <PanelRight className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-[10px] font-semibold leading-tight text-gray-600 [writing-mode:vertical-rl]">
              结算
            </span>
          </button>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-l-xl border border-gray-200 border-r-0 bg-white shadow-2xl [contain:layout_paint]">
            <div className="sticky top-0 z-[2] shrink-0 space-y-1 border-b border-gray-100 bg-white/95 px-2 pb-1.5 pt-2 leading-none backdrop-blur">
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={savePendingBill}
                  className="inline-flex min-h-[2rem] items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold leading-none text-amber-900 hover:bg-amber-100"
                >
                  <ClipboardList className="h-3 w-3 shrink-0" />
                  挂单
                </button>
                <button
                  type="button"
                  onClick={() => setShowPendingModal(true)}
                  disabled={pendingBills.length === 0}
                  className="inline-flex min-h-[2rem] items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold leading-none text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  取单
                  {pendingBills.length > 0 ? (
                    <span className="min-w-[1.1rem] rounded-full bg-slate-800 px-1 text-center text-[9px] leading-none text-white">
                      {pendingBills.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={clearCartItems}
                  disabled={cart.length === 0}
                  className="inline-flex min-h-[2rem] items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold leading-none text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                >
                  清空
                </button>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-gray-400">快捷结算</p>
                <span className="text-[10px] font-medium text-gray-400">固定操作位</span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] leading-none"
                  placeholder="客人姓名（选填）"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] leading-none"
                  placeholder="联系电话（选填）"
                />
              </div>
              {renderRxMinimizedInCheckoutRail()}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-0.5 [content-visibility:auto] [scrollbar-gutter:stable]">
              <QuickCheckoutList
                cart={cart}
                density="dense"
                getFinalUnitPrice={getFinalUnitPrice}
                onRemove={removeFromCart}
              />
            </div>
            <div className="shrink-0 space-y-2 border-t border-gray-200 bg-white p-2.5">
              <div className="flex items-end justify-between gap-2">
                <span className="text-xs text-gray-500">总金额</span>
                <span className="text-xl font-bold tabular-nums tracking-tight text-gray-900">￥{total.toFixed(2)}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCashCheckout()}
                disabled={paying || checkoutSubmitting || cart.length === 0}
                className="w-full min-h-[44px] rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {checkoutSubmitting ? '结算中…' : '现金结算'}
              </button>
              <button
                type="button"
                onClick={openScanPayModal}
                disabled={paying || checkoutSubmitting || cart.length === 0}
                className="w-full min-h-[44px] rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                扫码支付并结算
              </button>
              <button
                type="button"
                onClick={() => void openMeituanVerifyModal()}
                disabled={checkoutSubmitting || meituanVerifySubmitting}
                className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              >
                {meituanVerifySubmitting ? '核销中…' : '扫券核销（美团）'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AppModal
        open={Boolean(refundTarget)}
        onClose={() => {
          setRefundTarget(null);
          setRefundReasonInput('');
        }}
        title="销售退单"
        maxWidthClassName="max-w-md"
        zIndexClassName="z-[60]"
        bodyClassName="p-5 space-y-4"
      >
        {refundTarget ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-800">销售退单</h3>
              <button
                type="button"
                onClick={() => {
                  setRefundTarget(null);
                  setRefundReasonInput('');
                }}
                className="p-1.5 rounded-full hover:bg-gray-100"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <p className="text-xs text-gray-600">
              单据：{refundTarget.sale_no || refundTarget.id.slice(0, 8)} · {querySaleLineLabel(refundTarget)}
            </p>
            <label className="block text-xs text-gray-500">
              <span className="text-red-600">*</span> 退单原因（必填）
              <textarea
                value={refundReasonInput}
                onChange={(e) => setRefundReasonInput(e.target.value)}
                rows={3}
                required
                className={`mt-1 w-full px-3 py-2 text-sm border rounded-lg ${
                  !refundReasonInput.trim() ? 'border-red-300' : 'border-gray-200'
                }`}
                placeholder="例如：顾客取消、错单、库存问题等"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRefundTarget(null);
                  setRefundReasonInput('');
                }}
                className="min-h-[44px] py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitRefund()}
                disabled={refundSaving || !refundReasonInput.trim()}
                className="min-h-[44px] py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm disabled:opacity-60"
              >
                {refundSaving ? '提交中...' : '确认退单'}
              </button>
            </div>
          </>
        ) : null}
      </AppModal>

      <DraggableCashierModal
        open={productInfoModalCategory !== null}
        onClose={() => setProductInfoModalCategory(null)}
        title={
          productInfoModalCategory
            ? `${productQuickCategoryLabel(productInfoModalCategory)} · 商品信息（${productInfoModalProducts.length} 件）`
            : '商品信息'
        }
        maxWidthClassName="max-w-lg"
      >
        {productInfoModalCategory !== null ? (
          <div className="p-3 space-y-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-900">自定义添加（写入库存并加入购物车）</p>
                {productInfoModalCategory === 'all' ? (
                  <label className="block text-[11px] text-gray-600">
                    分类
                    <select
                      value={customProductCategory}
                      onChange={(e) => setCustomProductCategory(e.target.value)}
                      className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                    >
                      <option value="镜框">镜框</option>
                      <option value="镜片">镜片</option>
                      <option value="套餐">套餐</option>
                      <option value="其他">其他</option>
                    </select>
                  </label>
                ) : (
                  <p className="text-[11px] text-gray-600">
                    将记为「{customProductCategory}」类（可在「全部」弹窗里自选分类）。
                  </p>
                )}
                {showLensSkuUi ? (
                  <div className="space-y-2">
                    <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setLensPriceMode('catalog')}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                          lensPriceMode === 'catalog' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        价目表选购
                      </button>
                      <button
                        type="button"
                        onClick={() => setLensPriceMode('freeform')}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                          lensPriceMode === 'freeform' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        自由填报
                      </button>
                    </div>
                    {lensPriceMode === 'catalog' ? (
                      <LensSelectionSection
                        brand={lensCatalogBrand}
                        onBrandChange={handleLensCatalogBrandChange}
                        search={zeissSearch}
                        onSearchChange={setZeissSearch}
                        productName={zeissProductName}
                        onProductNameChange={handleZeissProductNameChange}
                        indexStr={zeissIndexStr}
                        onIndexStrChange={handleZeissIndexStrChange}
                        coating={zeissCoating}
                        onCoatingChange={setZeissCoating}
                        lensCatalogTint={lensCatalogTint}
                        onLensCatalogTintChange={setLensCatalogTint}
                        previewName={customProductName}
                        previewPrice={customProductPrice}
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-2 py-2 space-y-1.5">
                          <p className="text-[10px] font-semibold text-blue-900">镜片包装 · 拍照识别（选填）</p>
                          <div className="flex flex-wrap items-center gap-1">
                            <input
                              ref={lensPackagingOcrGalleryRef}
                              id={lensPackagingOcrGalleryId}
                              type="file"
                              accept="image/*"
                              disabled={customAddNameOcrBusy || customProductBusy}
                              className="sr-only"
                              tabIndex={-1}
                              aria-hidden
                              onChange={(e) => void onLensPackagingOcrFileInputChange(e)}
                            />
                            <button
                              type="button"
                              disabled={customAddNameOcrBusy || customProductBusy}
                              onClick={() => {
                                const el = lensPackagingOcrGalleryRef.current;
                                if (el) el.value = '';
                                lensPackagingOcrGalleryRef.current?.click();
                              }}
                              className="inline-flex items-center gap-0.5 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                            >
                              <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              相册选图
                            </button>
                            <button
                              type="button"
                              disabled={customAddNameOcrBusy || customProductBusy}
                              onClick={() => {
                                setCashierOcrWebCamForLens(true);
                                setCashierOcrWebCamOpen(true);
                              }}
                              className="inline-flex items-center gap-0.5 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                              title="打开实时摄像头抓拍（非系统选文件）"
                            >
                              <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              拍照识别
                            </button>
                          </div>
                          <p className="text-[9px] text-gray-600 leading-snug">
                            「相册选图」为本机文件；「拍照识别」为<strong>实时摄像头</strong>。走本机{' '}
                            <code className="text-[9px]">/api/ocr</code>，结果填入下方四格，请核对。
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <input
                            value={lensManualBrand}
                            onChange={(e) => setLensManualBrand(e.target.value)}
                            placeholder="品牌（必填，如：明月、依视路、蔡司）"
                            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                          />
                          <input
                            value={lensManualSeries}
                            onChange={(e) => setLensManualSeries(e.target.value)}
                            placeholder="系列（必填）"
                            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                          />
                          <input
                            value={lensManualIndex}
                            onChange={(e) => setLensManualIndex(e.target.value)}
                            placeholder="折射率（必填，如 1.67）"
                            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                          />
                          <input
                            value={lensManualCoating}
                            onChange={(e) => setLensManualCoating(e.target.value)}
                            placeholder="膜层（必填）"
                            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                          />
                          <p className="text-[10px] text-gray-500 leading-snug">
                            名称格式：「品牌镜片 · 系列 · 折射率 · 膜层」；单价请在下方填写。
                          </p>
                        </div>
                        <input
                          value={customProductPrice}
                          onChange={(e) => setCustomProductPrice(sanitizePriceDraft(e.target.value))}
                          placeholder="单价（必填）"
                          inputMode="decimal"
                          className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                        />
                        {customProductName.trim() ? (
                          <p className="text-[10px] text-gray-600">
                            将创建：<span className="font-medium text-gray-800">{customProductName.trim()}</span>
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="block text-[11px] text-gray-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>商品名称</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <input
                            ref={customAddOcrGalleryRef}
                            id={customAddOcrGalleryId}
                            type="file"
                            accept="image/*"
                            disabled={customAddNameOcrBusy || customProductBusy}
                            className="sr-only"
                            tabIndex={-1}
                            aria-hidden
                            onChange={(e) => void onCustomAddOcrFileInputChange(e)}
                          />
                          <button
                            type="button"
                            disabled={customAddNameOcrBusy || customProductBusy}
                            onClick={() => {
                              const el = customAddOcrGalleryRef.current;
                              if (el) el.value = '';
                              customAddOcrGalleryRef.current?.click();
                            }}
                            className="inline-flex items-center gap-0.5 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                            title="从相册选图识别（镜框包装/镜腿等）"
                          >
                            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            相册
                          </button>
                          <button
                            type="button"
                            disabled={customAddNameOcrBusy || customProductBusy}
                            onClick={() => {
                              setCashierOcrWebCamForLens(false);
                              setCashierOcrWebCamOpen(true);
                            }}
                            className="inline-flex items-center gap-0.5 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                            title="打开实时摄像头抓拍（非系统选文件）"
                          >
                            <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            拍照
                          </button>
                        </div>
                      </div>
                      <input
                        value={customProductName}
                        onChange={(e) => setCustomProductName(e.target.value)}
                        placeholder="商品名称（必填，可拍照识别包装或镜腿）"
                        className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg py-1.5 px-2"
                      />
                      {customProductOcrEvidenceUrl ? (
                        <p className="mt-1 text-[10px] text-emerald-800 leading-snug">
                          OCR 原图已存证，将随本商品写入库存与购物车：
                          <code className="ml-0.5 text-[10px]">{customProductOcrEvidenceUrl}</code>
                        </p>
                      ) : null}
                    </div>
                    <label className="block text-[11px] text-gray-600">
                      {customAddSecondaryFieldIsFrameStyle ? '型号 / 刻字编码' : '规格 / 货号（可选）'}
                      <input
                        value={customFrameModel}
                        onChange={(e) => setCustomFrameModel(e.target.value)}
                        placeholder={
                          customAddSecondaryFieldIsFrameStyle
                            ? '型号（可选，可由识别带出）'
                            : '规格、货号等（可选，可由识别带出）'
                        }
                        className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                      />
                    </label>
                    <input
                      value={customProductPrice}
                      onChange={(e) => setCustomProductPrice(sanitizePriceDraft(e.target.value))}
                      placeholder="单价（必填）"
                      inputMode="decimal"
                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                    />
                  </>
                )}
                <button
                  type="button"
                  disabled={
                    customProductBusy ||
                    (showLensSkuUi &&
                      lensPriceMode === 'catalog' &&
                      (ZEISS_PRICE_MATRIX.filter((p) => matrixProductBrandKey(p) === lensCatalogBrand).length === 0 ||
                        ZEISS_PRICE_MATRIX.length === 0))
                  }
                  onClick={() => void createCustomProductAndAddToCart()}
                  className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {customProductBusy ? '提交中…' : '创建并加入购物车'}
                </button>
                <p className="text-[10px] text-gray-500 leading-snug">
                  结算时若库里尚无此 SKU，会自动按本单扣减；无记录则新建商品并将库存记为负的售出数量。
                </p>
              </div>

              {productInfoModalProducts.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">该分类下暂无已有商品，可用上方自定义添加。</p>
              ) : (
                productInfoModalProducts.map((p) => {
                  const promoOk = p.allow_promo_price !== false;
                  const hasPromo =
                    p.is_promo && promoOk && p.promo_price != null && Number(p.promo_price) >= 0;
                  const showPrice = hasPromo ? Number(p.promo_price) : Number(p.price);
                  const tagBits: string[] = [];
                  if (p.is_hot) tagBits.push('热卖');
                  if (p.is_promo) tagBits.push('促销');
                  if (p.allow_discount === false) tagBits.push('不可改价折扣');
                  if (p.allow_points === false) tagBits.push('不参与积分');
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-gray-100 bg-gray-50/90 p-3 text-sm space-y-2"
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <p className="font-semibold text-gray-900 leading-snug">{p.name}</p>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-blue-600">￥{showPrice.toFixed(2)}</p>
                          {hasPromo ? (
                            <p className="text-[11px] text-gray-400 line-through">￥{Number(p.price).toFixed(2)}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 space-y-0.5">
                        <p>
                          <span className="text-gray-500">分类</span> {String(p.category || '').trim() || '—'}
                          {' · '}
                          <span className="text-gray-500">库存</span> {p.stock}
                          {p.low_stock_threshold != null && p.low_stock_threshold > 0 ? (
                            <span className="text-amber-700">（预警≤{p.low_stock_threshold}）</span>
                          ) : null}
                        </p>
                        {String(p.brand || '').trim() ? (
                          <p>
                            <span className="text-gray-500">品牌</span> {String(p.brand).trim()}
                          </p>
                        ) : null}
                        {String(p.model || '').trim() ? (
                          <p>
                            <span className="text-gray-500">型号</span> {String(p.model).trim()}
                          </p>
                        ) : null}
                        {String(p.frame_type || '').trim() ? (
                          <p>
                            <span className="text-gray-500">镜框属性</span> {String(p.frame_type).trim()}
                          </p>
                        ) : null}
                        {String(p.lens_type || '').trim() ? (
                          <p>
                            <span className="text-gray-500">镜片属性</span> {String(p.lens_type).trim()}
                          </p>
                        ) : null}
                        {tagBits.length > 0 ? (
                          <p className="text-[11px] text-violet-800 pt-0.5">{tagBits.join(' · ')}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          addToCart(p);
                          setProductInfoModalCategory(null);
                        }}
                        className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        加入购物车
                      </button>
                    </div>
                  );
                })
              )}
            </div>
        ) : null}
      </DraggableCashierModal>

      <DraggableCashierModal
        open={showPendingModal}
        onClose={() => setShowPendingModal(false)}
        title="挂单列表"
        maxWidthClassName="max-w-lg"
      >
            <div className="space-y-2 p-3">
              {pendingBills.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">暂无挂单</p>
              ) : (
                pendingBills.map((bill) => {
                  const n = bill.draft.cart?.length ?? 0;
                  const sum = (bill.draft.cart || []).reduce((s, it) => {
                    const unit =
                      typeof it.overrideUnitPrice === 'number' && it.overrideUnitPrice >= 0
                        ? it.overrideUnitPrice
                        : Number(it.price || 0) * (1 - (it.discountPercent || 0) / 100);
                    return s + unit * (it.quantity || 1);
                  }, 0);
                  return (
                    <div
                      key={bill.id}
                      className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 flex flex-col gap-2"
                    >
                      <div className="flex justify-between gap-2 text-xs text-gray-600">
                        <span>{new Date(bill.createdAt).toLocaleString('zh-CN')}</span>
                        <span>
                          {n} 行 · 约 ￥{sum.toFixed(2)}
                        </span>
                      </div>
                      {bill.note ? <p className="text-xs text-gray-700">备注：{bill.note}</p> : null}
                      <p className="text-xs text-gray-600">
                        客人：{bill.draft.customerName?.trim() || '—'} / {bill.draft.customerPhone?.trim() || '—'}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => restorePendingBill(bill)}
                          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                        >
                          取回此单
                        </button>
                        <button
                          type="button"
                          onClick={() => removePendingBill(bill.id)}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
      </DraggableCashierModal>

      <DraggableCashierModal
        open={showScanModal}
        onClose={() => setShowScanModal(false)}
        title="收银结算"
        maxWidthClassName="max-w-5xl"
      >
          <div className="grid max-h-[min(88dvh,880px)] w-full grid-rows-[auto_1fr_auto] overflow-hidden border-0 bg-white">
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-3 py-2 sm:px-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">收款通道</p>
              <div className="flex flex-wrap gap-1.5">
                {(['wechat', 'alipay', 'meituan_douyin'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(ch);
                      if (ch !== 'meituan_douyin') setMeituanVoucher('');
                    }}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                      paymentMethod === ch
                        ? 'bg-slate-800 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {ch === 'wechat' ? '微信' : ch === 'alipay' ? '支付宝' : '美团/抖音'}
                  </button>
                ))}
              </div>
              <p className="text-xs font-semibold text-slate-800">
                {paymentMethod === 'meituan_douyin'
                  ? '美团/抖音团购收款'
                  : paymentMethod === 'wechat'
                    ? '微信扫码收款'
                    : '支付宝扫码收款'}
              </p>
            </div>

            <div className="flex min-h-0 max-h-[min(72dvh,720px)] flex-1 flex-col overflow-y-auto lg:flex-row">
              {/* 左侧：订单明细 */}
              <div className="flex min-h-0 flex-col border-b border-slate-100 bg-slate-50/80 lg:basis-[40%] lg:min-w-[18rem] lg:max-w-[26rem] lg:border-b-0 lg:border-r lg:border-slate-100">
                <div className="border-b border-slate-100/80 px-4 py-3 sm:px-5">
                  <p className="text-xs font-semibold text-slate-500">订单明细</p>
                  <div className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div>
                      <p className="font-medium text-slate-900">{customerName.trim() || '—'}</p>
                      <p className="text-xs text-slate-500">{customerPhone.trim() || '—'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        门店：{resolveStoreDisplayName(stores.find((s) => s.id === selectedStoreId)?.name)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
                  <ul className="space-y-2.5">
                    {cart.map((item) => {
                      const unit = getFinalUnitPrice(item);
                      const line = unit * item.quantity;
                      return (
                        <li
                          key={item.lineId}
                          className="flex justify-between gap-3 rounded-lg border border-white bg-white/90 px-3 py-2.5 text-sm shadow-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-800">{item.name}</p>
                            <p className="text-xs text-slate-500">
                              ￥{unit.toFixed(2)} × {item.quantity}
                            </p>
                          </div>
                          <p className="shrink-0 font-mono font-semibold text-slate-900">￥{line.toFixed(2)}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="border-t border-slate-200/80 bg-white px-4 py-4 sm:px-5">
                  <div className="flex items-end justify-between">
                    <span className="text-sm font-medium text-slate-600">应付合计</span>
                    <span className="font-mono text-2xl font-bold tracking-tight text-[#0f3468]">
                      ￥{total.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 右侧：支付操作 */}
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-8 sm:px-8">
                {paymentMethod === 'meituan_douyin' ? (
                  <>
                    <p className="max-w-md text-center text-sm text-slate-600 leading-relaxed">
                      请先在 <strong>美团开店宝</strong> 或 <strong>抖音来客</strong> 完成验券。下方可扫描或粘贴券码，写入本店流水备注（可留空直接确认）。
                    </p>
                    <div className="flex h-40 w-full max-w-md flex-col items-center justify-center rounded-2xl border-2 border-dashed border-amber-200/80 bg-amber-50/40 px-4 text-center text-sm text-amber-900/85">
                      团购券码（可选）
                    </div>
                  </>
                ) : paymentMethod === 'alipay' ? (
                  <button
                    type="button"
                    onClick={() => {
                      scanCodeInputRef.current?.focus();
                    }}
                    className="w-full rounded-2xl bg-[#1677FF] py-5 text-center text-xl font-bold tracking-wide text-white shadow-lg shadow-[#1677FF]/35 transition hover:bg-[#0e6de8] active:scale-[0.99]"
                    title="点击后请在下方输入框用扫码枪扫描顾客付款码，再点「确认收款」"
                  >
                    支付宝扫码支付
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      scanCodeInputRef.current?.focus();
                    }}
                    className="w-full rounded-2xl bg-[#07C160] py-5 text-center text-xl font-bold tracking-wide text-white shadow-lg shadow-[#07C160]/30 transition hover:bg-[#06ad56] active:scale-[0.99]"
                    title="点击后请在下方输入框用扫码枪扫描顾客付款码，再点「确认收款」"
                  >
                    微信扫码支付
                  </button>
                )}
                {paymentMethod !== 'meituan_douyin' ? (
                  <p className="max-w-md text-center text-[11px] leading-relaxed text-slate-500 -mt-2">
                    主扫码图未对接时：请用扫码枪扫顾客付款码，输入框获得焦点后扫描即可填入。
                  </p>
                ) : null}

                {paymentMethod !== 'meituan_douyin' ? (
                  <div
                    className={`flex h-52 w-52 flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-slate-50/50 sm:h-56 sm:w-56 ${
                      paymentMethod === 'alipay' ? 'border-[#1677FF]/35' : 'border-[#07C160]/35'
                    }`}
                  >
                    <QrCode
                      className={`h-16 w-16 sm:h-20 sm:w-20 ${
                        paymentMethod === 'alipay' ? 'text-[#1677FF]/40' : 'text-[#07C160]/40'
                      }`}
                      strokeWidth={1.25}
                    />
                    <p className="mt-3 px-4 text-center text-xs font-medium text-slate-500">
                      模拟收款二维码区域
                    </p>
                    <p className="mt-1 px-4 text-center text-[10px] leading-relaxed text-slate-400">
                      正式环境由支付宝开放平台生成预下单链接并渲染码图
                    </p>
                  </div>
                ) : null}

                <div className="w-full space-y-2">
                  <label className="block text-xs font-medium text-slate-600">
                    {paymentMethod === 'meituan_douyin'
                      ? '券码或备注（可选，用于支付流水）'
                      : '或：扫码枪扫顾客付款码（被扫）'}
                  </label>
                  <input
                    ref={scanCodeInputRef}
                    autoFocus={!isCoarsePointerDevice}
                    value={paymentMethod === 'meituan_douyin' ? meituanVoucher : scanCode}
                    onChange={(e) =>
                      paymentMethod === 'meituan_douyin'
                        ? setMeituanVoucher(e.target.value)
                        : setScanCode(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleScanPay();
                    }}
                    className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-mono text-sm focus:outline-none focus:ring-2 ${
                      paymentMethod === 'meituan_douyin'
                        ? 'focus:border-amber-500 focus:ring-amber-500/20'
                        : 'focus:border-[#1677FF] focus:ring-[#1677FF]/20'
                    }`}
                    placeholder={
                      paymentMethod === 'meituan_douyin' ? '可扫描或粘贴团购券码（可空）' : '请扫描顾客出示的付款码'
                    }
                  />
                  <p className="text-[11px] text-slate-400">
                    {paymentMethod === 'meituan_douyin'
                      ? '无券码也可点「确认收款」记账；验券以美团/抖音后台为准。'
                      : '扫码枪一般带自动回车，回车即尝试确认收款。'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={paying}
                  onClick={() => void completeSaleSkipPaymentLog()}
                  className="w-full min-h-[44px] rounded-xl border border-dashed border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
                >
                  {checkoutSubmitting ? '结算提交中...' : '线下已收款，直接完成订单（不记支付流水）'}
                </button>
                <div className="flex w-full gap-3">
                  <button
                    type="button"
                    onClick={() => setShowScanModal(false)}
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleScanPay()}
                    disabled={paying || checkoutSubmitting}
                    className={`flex-1 min-h-[44px] rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60 ${
                      paymentMethod === 'alipay'
                        ? 'bg-[#1677FF] hover:bg-[#0e6de8]'
                        : paymentMethod === 'meituan_douyin'
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-[#07C160] hover:bg-[#06ad56]'
                    }`}
                  >
                    {paying ? '收款中...' : checkoutSubmitting ? '结算提交中...' : '确认收款'}
                  </button>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50/90 px-4 py-3 text-center">
              <p className="text-[11px] leading-relaxed text-slate-500">
                {paymentMethod === 'meituan_douyin' ? (
                  <>美团/抖音团购以平台订单与验券结果为准；本窗口仅作店内流水备注。</>
                ) : paymentMethod === 'alipay' ? (
                  <>
                    由 <span className="font-semibold text-[#1677FF]">支付宝</span> 官方提供支付技术支持
                  </>
                ) : (
                  <>
                    由 <span className="font-semibold text-[#07C160]">微信支付</span> 提供支付技术支持
                  </>
                )}
              </p>
            </div>
          </div>
      </DraggableCashierModal>

      <DraggableCashierModal
        open={showMeituanVerifyModal}
        onClose={() => {
          setShowMeituanVerifyModal(false);
          stopMeituanScanner();
        }}
        title="美团扫券核销"
        maxWidthClassName="max-w-lg"
      >
          <div className="space-y-3 p-3">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-black">
              <video ref={meituanVideoRef} className="h-64 w-full object-cover" autoPlay muted playsInline />
            </div>
            <p className="text-xs text-gray-500">
              {meituanScanning ? '请将券码对准摄像头。' : '摄像头未就绪，可直接手动输入券码核销。'}
            </p>
            <div className="flex gap-2">
              <input
                value={meituanDetectedCode}
                onChange={(e) => setMeituanDetectedCode(e.target.value)}
                placeholder="手动输入券码"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void submitMeituanVerify(meituanDetectedCode)}
                disabled={meituanVerifySubmitting}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                核销
              </button>
            </div>
          </div>
      </DraggableCashierModal>

      <DraggableRxEditorModal
        open={Boolean(editingRxItem) && !rxEditorMinimized}
        onClose={closeRxEditorFull}
        onMinimize={minimizeRxEditor}
        title="验光单填写窗口"
        maxWidthClassName="max-w-2xl"
      >
        {editingRxItem ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-[#F9FAFB] px-4 py-3 sm:px-5 sm:py-3.5">
              <div className="relative rounded-lg border border-gray-200 bg-white p-2.5 text-gray-800 shadow-sm">
                {rxRecognizing || visualEntryLoading ? (
                  <div
                    className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 rounded-lg bg-white/85 px-4 text-center backdrop-blur-[1px]"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-8 w-8 shrink-0 animate-spin text-sky-600" aria-hidden />
                    <p className="text-xs font-semibold text-gray-800">验光图识别中</p>
                    <p className="text-[10px] leading-snug text-gray-500">
                      图片经本机 Next 转发至 Paddle（8866）取字，再由 AI 解析球镜 / 柱镜 / 轴位并填入下方表单，请稍候…
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 max-w-[min(100%,28rem)] text-[11px] leading-snug text-gray-600">
                    手写验光单：<span className="font-semibold text-gray-900">先打开摄像头</span>
                    ，对准预览后点「抓拍并 AI 识别」；或「相册选图」上传已拍照片。
                  </p>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setVisualEntryOpen((v) => !v)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        visualEntryOpen
                          ? 'border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-200'
                          : 'border-gray-300 bg-white text-gray-900 hover:border-sky-500 hover:bg-sky-50'
                      }`}
                    >
                      {visualEntryOpen ? '关闭摄像头' : '打开摄像头拍手写单'}
                    </button>
                    <label
                      title="选用手机里已拍好的验光单照片；电脑上会打开图片选择器"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:border-sky-500 hover:bg-sky-50"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {rxRecognizing ? '识别中…' : '相册选图识别'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={rxRecognizing}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (!editingRxItem) {
                            window.alert('请先打开验光单编辑并选中要填写的镜片行，再使用相册选图。');
                            e.currentTarget.value = '';
                            return;
                          }
                          setRxPhotoFileName(file.name);
                          setRxRecognizing(true);
                          try {
                            const jpegBlob = await compressImageFileToJpegBlob(file, {
                              maxBytes: 600 * 1024,
                              maxEdge: 2048,
                            });
                            const { result, rawText } = await runServerCashierOcr(jpegBlob, 'rx.jpg');
                            const eyes = prepareRxOcrEyesOrAbandon(result);
                            if (!eyes) return;
                            if (!ocrMergedEyesMeaningful(eyes)) {
                              window.alert(formatOcrNoAutofillMessage(rawText));
                              return;
                            }
                            applyRxFromOcr(editingRxItem.lineId, 'right', eyes.right);
                            applyRxFromOcr(editingRxItem.lineId, 'left', eyes.left);
                            window.alert('识别完成，已自动回填右眼/左眼度数。请核对后保存。');
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            window.alert('识别失败：' + msg);
                          } finally {
                            setRxRecognizing(false);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={voiceOrderBusy || rxRecognizing}
                      onPointerDown={(ev) => {
                        ev.preventDefault();
                        void startVoiceOrderRecording();
                      }}
                      onPointerUp={() => stopVoiceOrderRecording()}
                      onPointerLeave={() => {
                        if (voiceOrderRecording) stopVoiceOrderRecording();
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold ${
                        voiceOrderRecording
                          ? 'border-red-300 bg-red-600 text-white hover:bg-red-700'
                          : 'border-gray-300 bg-white text-gray-900 hover:border-sky-500 hover:bg-sky-50'
                      } disabled:opacity-50`}
                    >
                      <Mic className="h-3.5 w-3.5" />
                      {voiceOrderBusy ? '语音处理中' : voiceOrderRecording ? '松开结束' : '语音填单'}
                    </button>
                  </div>
                </div>

                {visualEntryOpen ? (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-[#F9FAFB] p-2">
                    <div className="relative overflow-hidden rounded-md border border-gray-300 bg-black">
                      <video ref={visualEntryVideoRef} className="h-44 w-full object-cover" autoPlay muted playsInline />
                      <div
                        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-sky-400 to-transparent opacity-80"
                        style={{ animation: 'scanline 2s linear infinite' }}
                      />
                      {visualEntryPulse ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="h-20 w-20 rounded-full bg-emerald-400/35 animate-ping" />
                          <div className="absolute rounded-full border border-emerald-600 bg-white/90 px-2 py-1 text-xs font-bold text-emerald-800">
                            识别成功
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={visualEntryLoading}
                        onClick={() => void runVisualEntryRecognition()}
                        className="rounded-md border border-sky-700 bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                      >
                        {visualEntryLoading ? 'AI 识别中…' : '抓拍当前画面 · AI 识别'}
                      </button>
                      <span className="text-[10px] text-gray-500">验光图（服务端 8866 Paddle + AI 蒸馏）</span>
                    </div>
                    {visualEntryError ? <p className="mt-2 text-xs text-red-600">{visualEntryError}</p> : null}
                  </div>
                ) : null}

                {rxPhotoFileName ? <p className="mt-2 text-[11px] text-gray-600">已选择：{rxPhotoFileName}</p> : null}
              </div>

              <div className="space-y-2" data-rx-editor={editingRxItem.lineId}>
                <EyeRxBlock
                  title="右眼 (OD)"
                  eyeSide="right"
                  eye={editingRxItem.rx.right}
                  onPatch={(p) => patchRx(editingRxItem.lineId, 'right', p)}
                />
                <EyeRxBlock
                  title="左眼 (OS)"
                  eyeSide="left"
                  eye={editingRxItem.rx.left}
                  onPatch={(p) => patchRx(editingRxItem.lineId, 'left', p)}
                />
                {matrixRxSuggestHint ? (
                  <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
                    <span className="font-semibold text-sky-900">视光建议（suggest）</span>：{matrixRxSuggestHint}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              {rxPowerValidationError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 whitespace-pre-line"
                >
                  {rxPowerValidationError}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeRxEditorFull}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  稍后填写
                </button>
                <button
                  type="button"
                  onClick={confirmRxEditorSave}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  保存并返回
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </DraggableRxEditorModal>

      {showReceipt && lastOrder && (
        <div className="cashier-print-preview-root fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50 p-2 sm:items-center sm:p-4 print:p-0 print:bg-white print:static print:inset-auto print:block print:h-auto print:min-h-0 print:max-h-none print:overflow-visible">
          <div className="cashier-print-preview-card bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-w-3xl w-full overflow-y-auto overflow-x-hidden flex flex-col max-h-[min(92dvh,920px)] print:shadow-none print:max-w-none print:w-full print:rounded-none print:block print:h-auto print:min-h-0 print:max-h-none print:overflow-visible print:flex-none">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center print:hidden">
              <div className="flex items-center space-x-2 text-gray-800">
                <Printer className="w-5 h-5" />
                <h3 className="font-bold">小票打印预览</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReceipt(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-all"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="cashier-print-preview-scroll flex-1 overflow-y-auto overscroll-y-contain touch-pan-y p-6 flex justify-center bg-gray-50 print:block print:flex-none print:h-auto print:min-h-0 print:max-h-none print:overflow-visible print:bg-white print:p-0 print:overscroll-auto [-webkit-overflow-scrolling:touch]">
              <ReceiptPrintBundle ref={cashierPrintBundleRef} order={lastOrder.orderObject} />
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 space-y-3 print:hidden">
              {webBtUnavailableHint ? (
                <p className="text-xs leading-relaxed text-amber-950 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {webBtUnavailableHint}
                </p>
              ) : null}
              <ReceiptDesktopPrinterBar />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => void handleManualReceiptPrint()}
                  disabled={receiptPrinting}
                  className="flex-1 min-h-[44px] min-w-0 py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-60 transition-all touch-manipulation"
                >
                  {receiptPrinting
                    ? '打印中...'
                    : preferBluetoothPrimaryPrint
                      ? '蓝牙选机并打印'
                      : isCoarsePointerDevice && !hasElectronBridgeRender
                        ? '系统打印 / AirPrint'
                        : '立即打印'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (webBtUnavailableHint) window.alert(webBtUnavailableHint);
                    else void handleBluetoothReceiptPrint();
                  }}
                  disabled={receiptBtPrinting}
                  className={`flex-1 min-h-[44px] min-w-0 py-3 px-4 rounded-xl font-bold transition-all touch-manipulation ${
                    webBtUnavailableHint
                      ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      : 'bg-violet-600 text-white hover:bg-violet-700'
                  } disabled:opacity-50`}
                >
                  {receiptBtPrinting ? '蓝牙连接中…' : webBtUnavailableHint ? '蓝牙打印说明' : '蓝牙打印（安卓）'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReceipt(false)}
                  className="flex-1 min-h-[44px] min-w-0 py-3 px-4 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-100 transition-all touch-manipulation"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AppModal
        open={orderLookupOpen}
        onClose={() => setOrderLookupOpen(false)}
        title={orderLookupTitle || '订单查询'}
        maxWidthClassName="max-w-md"
        zIndexClassName="z-[60]"
        bodyClassName="p-0"
      >
          <div className="w-full rounded-t-2xl xl:rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-y-auto overflow-x-hidden max-h-[min(88dvh,760px)]">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
              <h2 id="order-lookup-title" className="text-base font-bold text-gray-900">
                {orderLookupTitle}
              </h2>
              <button
                type="button"
                onClick={() => setOrderLookupOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[min(70vh,420px)] overflow-y-auto">
              {orderLookupLoading ? (
                <p className="text-sm text-gray-600">加载中…</p>
              ) : (
                <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                  {orderLookupBody}
                </pre>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setOrderLookupOpen(false)}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
              >
                关闭
              </button>
            </div>
          </div>
      </AppModal>

      <WebCameraCaptureModal
        open={cashierOcrWebCamOpen}
        onClose={() => setCashierOcrWebCamOpen(false)}
        title={cashierOcrWebCamForLens ? '镜片包装 · 摄像头拍照' : '自定义商品 · 摄像头拍照'}
        onCapture={handleCashierOcrWebCamCapture}
      />
    </div>
  );
}
