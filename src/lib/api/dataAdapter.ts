/**
 * StandardEye · 数据海关（Data Adapter）
 *
 * 职责：把拍照 / OCR / 手工录入的散乱结果，规约为系统标准的「眼镜行业专用数据模型」：
 *   - 镜片维度：品牌 / 系列 / 折射率 / 膜层 / SPH / CYL / AXIS / ADD / PD
 *   - 价格维度：建议零售价 / 折后价 / 加工费
 * 设计：
 *   - 严禁 `any`；对外暴露带判别标签的联合类型与具名错误类；
 *   - 预留 `LensSkuMatcher` 协议，插拔式地与 82 页蔡司价目表做 SKU 精确匹配；
 *   - 关键字段缺失（SPH / CYL / AXIS / PD / 折射率）即抛出 `MissingFieldError`，
 *     绝不做静默默认，避免把错误订单送进收银。
 */

import {
  findZeissMatrixRow,
  findZeissProductMatrix,
  type ZeissPriceRow,
  type ZeissSeriesSubset,
} from '@/data/zeissPriceMatrix';
import { findEssilorMatrixRow, findEssilorProductMatrix } from '@/data/essilorPriceMatrix';

// ─── 基础枚举与类型 ─────────────────────────────────────────────────────────

/** 系统支持的镜片品牌键（大写英文，与 `ZEISS_PRICE_MATRIX.brand` 对齐） */
export type LensBrandKey = 'ZEISS' | 'ESSILOR' | 'HOYA' | 'NIKON' | 'CHEMI' | 'OTHER';

/** 标准折射率档位（与 `ZeissRefractiveIndex` 一致，供多品牌矩阵共享列） */
export type RefractiveIndex = 1.5 | 1.56 | 1.59 | 1.6 | 1.67 | 1.74;

/** 膜层代号或展示名（与蔡司 `ZeissCoatingCode` 兼容；多品牌扩展时原样透传） */
export type CoatingIdentifier = string;

/** 单眼处方（OD=右，OS=左） */
export interface EyePrescription {
  /** 球镜 SPH，单位 diopter；近视为负，远视为正 */
  sphere: number;
  /** 柱镜 CYL，diopter；默认负柱（若 OCR 为正柱需调用侧自行翻转并交换轴位） */
  cylinder: number;
  /** 轴位 AXIS，0–180，整数（任何小数由 adapter 四舍五入） */
  axis: number;
  /** 渐进片附加度 ADD，diopter；单光镜片请勿填写 */
  addPower?: number;
  /** 单眼 PD（瞳距），毫米 */
  pdMm?: number;
}

export interface LensPrescription {
  od: EyePrescription;
  os: EyePrescription;
  /** 双眼 PD（毫米）。若单眼 pdMm 均不可得，必须提供本字段，否则 adapter 抛错。 */
  pdBinocularMm?: number;
  /** 渐进/双焦镜所需瞳高（FH），毫米（单光可省略） */
  fittingHeightMm?: number;
}

/** 镜片规格（用于 SKU 匹配与下单） */
export interface LensSpec {
  brand: LensBrandKey;
  /** 产品系列名（蔡司：与 `ZeissProductMatrix.productName` 完全一致，例如「智锐单光」） */
  series: string;
  /** 子系列（蔡司：与 `ZeissSeriesSubset.name` 一致；如「标配」「偏光」「焕色」） */
  subset?: string;
  /** 折射率 */
  index: RefractiveIndex;
  /** 膜层代号或展示名 */
  coating: CoatingIdentifier;
  /** 变色 / 偏光 / 染色等特性标签（非规格锚点，仅备注） */
  features?: readonly string[];
  /** 镜片设计类型（SingleVision / Progressive / Digital-PAL / MyopiaControl） */
  lensType?: 'SingleVision' | 'Progressive' | 'Digital-PAL' | 'MyopiaControl';
}

/** 订单价格三元组（币种固定 CNY，单位元） */
export interface PriceBreakdown {
  /** 建议零售价（MSRP） */
  retailYuan: number;
  /** 折后价：实收价；若 OCR 无可走 `retailYuan` 作为缺省（adapter 会明示 inferred） */
  discountedYuan: number;
  /** 加工费：磨边 / 染色 / 二次加工；缺省 0 */
  processingFeeYuan: number;
  currency: 'CNY';
}

/** 标准订单行：一副眼镜 = 处方 + 镜片规格 + 价格三元组 */
export interface EyewearOrderItem {
  prescription: LensPrescription;
  lens: LensSpec;
  price: PriceBreakdown;
  remark?: string;
}

// ─── OCR 原始输入 ───────────────────────────────────────────────────────────

/** OCR 送入 adapter 的结构化字段键（大小写不敏感，adapter 做 normalize） */
export type OcrFieldKey =
  | 'BRAND'
  | 'SERIES'
  | 'SUBSET'
  | 'INDEX'
  | 'COATING'
  | 'LENS_TYPE'
  | 'OD_SPH'
  | 'OD_CYL'
  | 'OD_AXIS'
  | 'OD_ADD'
  | 'OD_PD'
  | 'OS_SPH'
  | 'OS_CYL'
  | 'OS_AXIS'
  | 'OS_ADD'
  | 'OS_PD'
  | 'PD_BINOCULAR'
  | 'FITTING_HEIGHT'
  | 'RETAIL_YUAN'
  | 'DISCOUNTED_YUAN'
  | 'PROCESSING_FEE_YUAN';

export type OcrFieldValue = string | number | null | undefined;

/** OCR 载荷（不允许 `any`；全文文本可放在 `rawText`） */
export interface OcrRawPayload {
  source: 'image' | 'pdf' | 'manual' | 'barcode';
  /** 结构化字段（推荐） */
  fields?: Partial<Record<OcrFieldKey, OcrFieldValue>>;
  /** 全文文本（可选，供 adapter 做兜底正则抽取；未实现抽取时被忽略） */
  rawText?: string;
}

/** Adapter 运行配置与默认值 */
export interface AdapterDefaults {
  brand?: LensBrandKey;
  series?: string;
  subset?: string;
  coating?: CoatingIdentifier;
  processingFeeYuan?: number;
  /** ADD 必填时（Progressive / Digital-PAL）为 true；默认按 `lensType` 自动判定 */
  requireAdd?: boolean;
}

export interface AdaptInput {
  ocr: OcrRawPayload;
  defaults?: AdapterDefaults;
}

/** Adapter 输出 */
export interface AdaptResult {
  order: EyewearOrderItem;
  /** 关键字段命中程度：high=全量 OCR；medium=用到默认值；low=SKU 匹配失败仅走字段校验 */
  confidence: 'high' | 'medium' | 'low';
  /** 处理过程说明（日志 / 回显） */
  reasons: readonly string[];
  /** 若 SKU 匹配命中，附带矩阵行引用（价格可优先取自此处） */
  skuMatch?: LensSkuMatch;
}

// ─── 错误类 ─────────────────────────────────────────────────────────────────

export type DataAdapterErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'UNSUPPORTED_BRAND'
  | 'UNSUPPORTED_INDEX'
  | 'SKU_NOT_FOUND';

export class DataAdapterError extends Error {
  readonly code: DataAdapterErrorCode;
  constructor(code: DataAdapterErrorCode, message: string) {
    super(message);
    this.name = 'DataAdapterError';
    this.code = code;
  }
}

export class MissingFieldError extends DataAdapterError {
  readonly field: string;
  constructor(field: string, message?: string) {
    super('MISSING_FIELD', message ?? `OCR 缺少关键字段：${field}`);
    this.name = 'MissingFieldError';
    this.field = field;
  }
}

export class InvalidFieldError extends DataAdapterError {
  readonly field: string;
  readonly raw: OcrFieldValue;
  constructor(field: string, raw: OcrFieldValue, message?: string) {
    super('INVALID_FIELD', message ?? `OCR 字段值不合法：${field}=${String(raw)}`);
    this.name = 'InvalidFieldError';
    this.field = field;
    this.raw = raw;
  }
}

export class SkuNotFoundError extends DataAdapterError {
  readonly spec: LensSpec;
  constructor(spec: LensSpec, message?: string) {
    super(
      'SKU_NOT_FOUND',
      message ??
        `价目矩阵未命中：${spec.brand}/${spec.series}/${spec.subset ?? '*'}/${spec.index}/${spec.coating}`,
    );
    this.name = 'SkuNotFoundError';
    this.spec = spec;
  }
}

// ─── 字段抽取与解析工具 ─────────────────────────────────────────────────────

const NUM_RE = /-?\d+(?:\.\d+)?/;

function readField(fields: AdaptInput['ocr']['fields'], key: OcrFieldKey): OcrFieldValue {
  if (!fields) return undefined;
  const direct = fields[key];
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  const upper = key.toUpperCase() as OcrFieldKey;
  const alt = fields[upper];
  return alt ?? undefined;
}

function isNil(v: OcrFieldValue): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function parseNumber(raw: OcrFieldValue, field: string): number {
  if (isNil(raw)) throw new MissingFieldError(field);
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new InvalidFieldError(field, raw);
    return raw;
  }
  const s = String(raw)
    .replace(/[＋]/g, '+')
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '');
  const m = s.match(NUM_RE);
  if (!m) throw new InvalidFieldError(field, raw);
  const n = Number(m[0]);
  if (!Number.isFinite(n)) throw new InvalidFieldError(field, raw);
  return n;
}

function parseOptionalNumber(raw: OcrFieldValue, field: string): number | undefined {
  if (isNil(raw)) return undefined;
  return parseNumber(raw, field);
}

function parseDiopter(raw: OcrFieldValue, field: string, range: readonly [number, number]): number {
  const n = parseNumber(raw, field);
  if (n < range[0] || n > range[1]) {
    throw new InvalidFieldError(field, raw, `${field} 需在 ${range[0]}–${range[1]} 之间，当前=${n}`);
  }
  // 屈光度对齐到 0.25 步进（允许容差 0.01）
  const snapped = Math.round(n * 4) / 4;
  if (Math.abs(snapped - n) > 0.01) {
    throw new InvalidFieldError(field, raw, `${field} 非 0.25 步进，当前=${n}`);
  }
  return snapped;
}

function parseAxis(raw: OcrFieldValue): number {
  const n = parseNumber(raw, 'AXIS');
  if (n < 0 || n > 180) throw new InvalidFieldError('AXIS', raw, `AXIS 需在 0–180，当前=${n}`);
  return Math.round(n);
}

function parsePdMm(raw: OcrFieldValue, field: string): number {
  const n = parseNumber(raw, field);
  if (n < 20 || n > 80) throw new InvalidFieldError(field, raw, `${field} 超出 20–80mm，当前=${n}`);
  // PD 保留 0.5mm 步进
  return Math.round(n * 2) / 2;
}

const SUPPORTED_INDEX: readonly RefractiveIndex[] = [1.5, 1.56, 1.59, 1.6, 1.67, 1.74];

function parseIndex(raw: OcrFieldValue): RefractiveIndex {
  const n = parseNumber(raw, 'INDEX');
  const hit = SUPPORTED_INDEX.find((v) => Math.abs(v - n) < 0.005);
  if (!hit) {
    throw new DataAdapterError(
      'UNSUPPORTED_INDEX',
      `不支持的折射率：${n}；当前仅支持 ${SUPPORTED_INDEX.join(' / ')}`,
    );
  }
  return hit;
}

const BRAND_ALIASES: Readonly<Record<string, LensBrandKey>> = {
  ZEISS: 'ZEISS',
  蔡司: 'ZEISS',
  ESSILOR: 'ESSILOR',
  依视路: 'ESSILOR',
  HOYA: 'HOYA',
  豪雅: 'HOYA',
  NIKON: 'NIKON',
  尼康: 'NIKON',
  CHEMI: 'CHEMI',
  凯米: 'CHEMI',
};

function parseBrand(raw: OcrFieldValue, fallback: LensBrandKey | undefined): LensBrandKey {
  if (isNil(raw)) {
    if (fallback) return fallback;
    throw new MissingFieldError('BRAND');
  }
  const s = String(raw).trim();
  const upper = s.toUpperCase();
  if (BRAND_ALIASES[upper]) return BRAND_ALIASES[upper];
  if (BRAND_ALIASES[s]) return BRAND_ALIASES[s];
  throw new DataAdapterError('UNSUPPORTED_BRAND', `未登记的镜片品牌：${s}`);
}

function parseString(raw: OcrFieldValue, field: string, fallback?: string): string {
  if (isNil(raw)) {
    if (fallback !== undefined) return fallback;
    throw new MissingFieldError(field);
  }
  const s = String(raw).trim();
  if (!s) {
    if (fallback !== undefined) return fallback;
    throw new MissingFieldError(field);
  }
  return s;
}

function parseLensType(raw: OcrFieldValue): LensSpec['lensType'] | undefined {
  if (isNil(raw)) return undefined;
  const s = String(raw).trim();
  const n = s.toLowerCase();
  if (/single|单光/.test(n)) return 'SingleVision';
  if (/digital|数码/.test(n)) return 'Digital-PAL';
  if (/myopia|近视管理/.test(n)) return 'MyopiaControl';
  if (/prog|渐进|pal/.test(n)) return 'Progressive';
  return undefined;
}

// ─── SKU 匹配协议 ───────────────────────────────────────────────────────────

export interface LensSkuMatch {
  /** 命中价目矩阵行的零售价（元） */
  retailYuan: number;
  /** 是否可叠加染色服务（与 `ZeissPriceRow.tintable` 一致） */
  tintable: boolean;
  /** 原始矩阵行（只读） */
  row: Readonly<ZeissPriceRow>;
  /** 原始子系列（只读，便于展示 `features` / `colorsBy`） */
  subset: Readonly<ZeissSeriesSubset>;
}

/** SKU 匹配器：不同品牌可实现各自价目查找 */
export interface LensSkuMatcher {
  readonly brand: LensBrandKey;
  match(spec: LensSpec): LensSkuMatch | null;
}

/** 蔡司实现：依赖 `@/data/zeissPriceMatrix` 的 `findZeissMatrixRow` */
export const zeissSkuMatcher: LensSkuMatcher = {
  brand: 'ZEISS',
  match(spec) {
    if (spec.brand !== 'ZEISS') return null;
    const product = findZeissProductMatrix(spec.series);
    if (!product) return null;
    const hit = findZeissMatrixRow(spec.series, spec.index, spec.coating);
    if (!hit) return null;
    return {
      retailYuan: Number(hit.row.retailYuan),
      tintable: Boolean(hit.row.tintable),
      row: hit.row,
      subset: hit.subset,
    };
  },
};

export const essilorSkuMatcher: LensSkuMatcher = {
  brand: 'ESSILOR',
  match(spec) {
    if (spec.brand !== 'ESSILOR') return null;
    const product = findEssilorProductMatrix(spec.series);
    if (!product) return null;
    const hit = findEssilorMatrixRow(spec.series, spec.index, spec.coating);
    if (!hit) return null;
    return {
      retailYuan: Number(hit.row.retailYuan),
      tintable: Boolean(hit.row.tintable),
      row: hit.row,
      subset: hit.subset,
    };
  },
};

/** 未来多品牌按 `brand` 分发；`OTHER` 始终返回 `null`（由人工定价） */
export const defaultSkuMatcherRegistry: Readonly<Partial<Record<LensBrandKey, LensSkuMatcher>>> = {
  ZEISS: zeissSkuMatcher,
  ESSILOR: essilorSkuMatcher,
};

export function resolveSkuMatcher(
  brand: LensBrandKey,
  registry: Readonly<Partial<Record<LensBrandKey, LensSkuMatcher>>> = defaultSkuMatcherRegistry,
): LensSkuMatcher | null {
  return registry[brand] ?? null;
}

// ─── 顶层：OCR → 标准订单行 ─────────────────────────────────────────────────

function inferLensTypeDefault(series: string, explicit: LensSpec['lensType']): LensSpec['lensType'] | undefined {
  if (explicit) return explicit;
  const s = series.toLowerCase();
  if (/单光|sv|single/.test(s)) return 'SingleVision';
  if (/数码|digital/.test(s)) return 'Digital-PAL';
  if (/近视管理|myopia|乐圆|成长怡/.test(s)) return 'MyopiaControl';
  if (/渐进|睐光|pal/.test(s)) return 'Progressive';
  return undefined;
}

function adaptEye(
  fields: AdaptInput['ocr']['fields'],
  side: 'OD' | 'OS',
  requireAdd: boolean,
): EyePrescription {
  const prefix = side;
  const sphere = parseDiopter(readField(fields, `${prefix}_SPH` as OcrFieldKey), `${prefix}_SPH`, [-30, 30]);
  const cylinder = parseDiopter(readField(fields, `${prefix}_CYL` as OcrFieldKey), `${prefix}_CYL`, [-10, 10]);
  const axis = parseAxis(readField(fields, `${prefix}_AXIS` as OcrFieldKey));
  const addRaw = readField(fields, `${prefix}_ADD` as OcrFieldKey);
  const addPower =
    requireAdd
      ? parseDiopter(addRaw, `${prefix}_ADD`, [0.25, 4])
      : parseOptionalNumber(addRaw, `${prefix}_ADD`);
  const pdMm = parseOptionalNumber(readField(fields, `${prefix}_PD` as OcrFieldKey), `${prefix}_PD`);
  return {
    sphere,
    cylinder,
    axis,
    addPower,
    pdMm: pdMm !== undefined ? parsePdMm(pdMm, `${prefix}_PD`) : undefined,
  };
}

function ensurePdPresent(px: LensPrescription): void {
  if (px.pdBinocularMm !== undefined) return;
  const hasMono = px.od.pdMm !== undefined && px.os.pdMm !== undefined;
  if (!hasMono) {
    throw new MissingFieldError('PD', 'OCR 未提供瞳距 PD（需要 PD_BINOCULAR 或 OD_PD + OS_PD）');
  }
}

/**
 * 顶层入口：OCR 原始字段 → 标准订单行。缺字段立即抛错。
 */
export function adaptOcrToOrderItem(input: AdaptInput): AdaptResult {
  const { ocr, defaults } = input;
  const fields = ocr.fields ?? {};
  const reasons: string[] = [];

  // 1. 镜片规格
  const brand = parseBrand(readField(fields, 'BRAND'), defaults?.brand);
  const series = parseString(readField(fields, 'SERIES'), 'SERIES', defaults?.series);
  const subsetRaw = readField(fields, 'SUBSET');
  const subset = !isNil(subsetRaw)
    ? parseString(subsetRaw, 'SUBSET', defaults?.subset)
    : defaults?.subset;
  const index = parseIndex(readField(fields, 'INDEX'));
  const coating = parseString(readField(fields, 'COATING'), 'COATING', defaults?.coating);
  const lensType = inferLensTypeDefault(series, parseLensType(readField(fields, 'LENS_TYPE')));

  const spec: LensSpec = {
    brand,
    series,
    subset,
    index,
    coating,
    lensType,
  };

  // 2. 处方（ADD 是否必填由 lensType 判定，或由 defaults 覆写）
  const requireAdd =
    defaults?.requireAdd ??
    (lensType === 'Progressive' || lensType === 'Digital-PAL');
  const od = adaptEye(fields, 'OD', requireAdd);
  const os = adaptEye(fields, 'OS', requireAdd);
  const pdBinocular = parseOptionalNumber(readField(fields, 'PD_BINOCULAR'), 'PD_BINOCULAR');
  const fittingHeight = parseOptionalNumber(readField(fields, 'FITTING_HEIGHT'), 'FITTING_HEIGHT');
  const prescription: LensPrescription = {
    od,
    os,
    pdBinocularMm: pdBinocular !== undefined ? parsePdMm(pdBinocular, 'PD_BINOCULAR') : undefined,
    fittingHeightMm: fittingHeight !== undefined ? parsePdMm(fittingHeight, 'FITTING_HEIGHT') : undefined,
  };
  ensurePdPresent(prescription);

  if (requireAdd && (od.addPower == null || os.addPower == null)) {
    throw new MissingFieldError('ADD', '渐进 / 数码型镜片必须提供双眼 ADD');
  }

  // 3. 价格（允许从 SKU 匹配反填；显式 OCR 字段覆盖匹配结果）
  const skuMatch = resolveSkuMatcher(brand)?.match(spec) ?? null;

  const retailFromOcr = parseOptionalNumber(readField(fields, 'RETAIL_YUAN'), 'RETAIL_YUAN');
  const retailYuan = retailFromOcr ?? skuMatch?.retailYuan;
  if (retailYuan === undefined) {
    throw new MissingFieldError(
      'RETAIL_YUAN',
      '零售价无法确定：OCR 未提供 RETAIL_YUAN 且 SKU 未在价目矩阵命中',
    );
  }
  if (retailFromOcr === undefined && skuMatch) {
    reasons.push(`retail-from-matrix:${spec.series}/${spec.index}/${spec.coating}→¥${skuMatch.retailYuan}`);
  }

  const discountedYuan =
    parseOptionalNumber(readField(fields, 'DISCOUNTED_YUAN'), 'DISCOUNTED_YUAN') ?? retailYuan;
  if (discountedYuan > retailYuan) {
    throw new InvalidFieldError('DISCOUNTED_YUAN', discountedYuan, '折后价不得高于零售价');
  }
  if (discountedYuan < 0) {
    throw new InvalidFieldError('DISCOUNTED_YUAN', discountedYuan, '折后价不得为负');
  }

  const processingFeeYuan =
    parseOptionalNumber(readField(fields, 'PROCESSING_FEE_YUAN'), 'PROCESSING_FEE_YUAN') ??
    defaults?.processingFeeYuan ??
    0;
  if (processingFeeYuan < 0) {
    throw new InvalidFieldError('PROCESSING_FEE_YUAN', processingFeeYuan, '加工费不得为负');
  }

  const price: PriceBreakdown = {
    retailYuan,
    discountedYuan,
    processingFeeYuan,
    currency: 'CNY',
  };

  const order: EyewearOrderItem = { lens: spec, prescription, price };

  const confidence: AdaptResult['confidence'] = skuMatch
    ? retailFromOcr !== undefined
      ? 'high'
      : 'medium'
    : 'low';

  return {
    order,
    confidence,
    reasons,
    skuMatch: skuMatch ?? undefined,
  };
}

/**
 * 严格模式：SKU 必须在价目矩阵命中，否则抛 `SkuNotFoundError`。
 * 适用于「收银不允许人工改价」的场景。
 */
export function adaptOcrToOrderItemStrict(input: AdaptInput): AdaptResult {
  const r = adaptOcrToOrderItem(input);
  if (!r.skuMatch) {
    throw new SkuNotFoundError(r.order.lens);
  }
  return r;
}

/** 类型守卫：窄化到 `DataAdapterError` */
export function isDataAdapterError(e: unknown): e is DataAdapterError {
  return e instanceof DataAdapterError;
}

// ─── 打印桥接 ───────────────────────────────────────────────────────────────

/** 小票元数据（门店 / 单号 / 时间 / 客户），不在 `EyewearOrderItem` 内 */
export interface ReceiptMeta {
  storeName: string;
  orderNo: string;
  /** ISO 或 `YYYY-MM-DD HH:mm:ss`；缺省取当前时间 */
  createdAt?: string;
  customerName?: string;
  customerPhone?: string;
}

/** 眼镜行业小票载荷（`receiptElectronPrint` 直接消费此结构） */
export interface EyewearReceiptPayload {
  readonly kind: 'eyewear-v1';
  storeName: string;
  orderNo: string;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
  items: readonly EyewearOrderItem[];
}

/** 类型守卫：识别眼镜行业小票载荷（避免 `as any`） */
export function isEyewearReceiptPayload(o: unknown): o is EyewearReceiptPayload {
  if (!o || typeof o !== 'object') return false;
  const k = (o as { kind?: unknown }).kind;
  return k === 'eyewear-v1';
}

/** 合计（折后价 + 加工费之和），单位元 */
export function computeOrderItemTotalYuan(item: EyewearOrderItem): number {
  return Number(item.price.discountedYuan) + Number(item.price.processingFeeYuan);
}

export function computeReceiptTotalYuan(payload: EyewearReceiptPayload): number {
  return payload.items.reduce((acc, it) => acc + computeOrderItemTotalYuan(it), 0);
}

function nowStampCN(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** AdaptResult → 可打印的眼镜小票载荷 */
export function toEyewearReceiptPayload(
  adapt: AdaptResult,
  meta: ReceiptMeta,
): EyewearReceiptPayload {
  return {
    kind: 'eyewear-v1',
    storeName: meta.storeName.trim() || '门店',
    orderNo: meta.orderNo.trim(),
    createdAt: meta.createdAt?.trim() || nowStampCN(),
    customerName: meta.customerName?.trim() || undefined,
    customerPhone: meta.customerPhone?.trim() || undefined,
    items: [adapt.order],
  };
}

/** 多订单行组装（收银台一单多镜片时使用） */
export function composeEyewearReceiptPayload(
  items: readonly EyewearOrderItem[],
  meta: ReceiptMeta,
): EyewearReceiptPayload {
  return {
    kind: 'eyewear-v1',
    storeName: meta.storeName.trim() || '门店',
    orderNo: meta.orderNo.trim(),
    createdAt: meta.createdAt?.trim() || nowStampCN(),
    customerName: meta.customerName?.trim() || undefined,
    customerPhone: meta.customerPhone?.trim() || undefined,
    items,
  };
}
