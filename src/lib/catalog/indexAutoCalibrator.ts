/**
 * IndexAutoCalibrator — 物理页索引校准（MATRIX_PROTOCOL_V1）
 *
 * 插件：
 * 1. Filename-Anchor：四段 hyphen 规约（`品牌-系列-功能-页码.ext`）。
 * 2. **Visual-Text-Anchor（插件 A）**：MatchScore 三级优先语义 ——
 *    L1 文件名强匹配（含 ASCII slug，如 `A-Series-Progressive`，**无视文件名内页码**）；
 *    L2 标题 / OCR / 预设关键词（文件名无语义命中时）；
 *    L3 仅当前两项失效时：`physicalIndex + pageOffset`（来自 hyphen 四段末段或视觉锚 `pageHint`）。
 * 3. Schema 完整性扫描：对比矩阵与导航 / 手册行，生成待补全列表。
 */

import { ZEISS_PRICE_MATRIX } from '@/data/zeissPriceMatrix';
import {
  findFirstPdfPageForProduct,
  getPageByPdfIndex,
  ZEISS_HANDBOOK_PAGE_MAP,
} from '@/data/zeissHandbookPageMap';
import {
  assessHandbookMarketingIndexMeta,
  type HandbookMarketingIndexMeta,
} from '@/lib/catalog/handbookMarketingPage';
import { assessZeissHandbookScanFilter, type ZeissHandbookScanFilterHit } from '@/lib/catalog/zeissHandbookScanFilter';

export type { ZeissHandbookScanFilterHit } from '@/lib/catalog/zeissHandbookScanFilter';
export type { HandbookMarketingIndexMeta } from '@/lib/catalog/handbookMarketingPage';

// ─── Filename-Anchor 规约 ───────────────────────────────────────────────

/** 人读说明：机器解析用 `FILENAME_ANCHOR_REGEX` */
export const HANDBOOK_PAGE_ASSET_FILENAME_CONVENTION =
  '蔡司手册页资源 basename 必须为四段 hyphen 分隔、末段为物理页码：`品牌-系列-功能-页码.jpg`（或 .jpeg / .png / .webp）；' +
  '前三段内**不得**再含未转义的 `-`（若需连字符请用下划线 `_`）。示例：`ZEISS-智锐单光-价目-014.jpg`。';

/**
 * 严格四段式：`品牌-系列-功能-页码.ext`
 * - 页码：十进制整数，与 manifest 物理序一致（1-based 与 `pdfPage` 对齐由调用方约定）。
 */
export const FILENAME_ANCHOR_REGEX =
  /^([^-]+)-([^-]+)-([^-]+)-(\d+)\.(jpe?g|png|webp)$/i;

export type FilenameAnchorParse = {
  brand: string;
  series: string;
  feature: string;
  /** 文件名中的页码段（通常为物理页） */
  pageSegment: number;
  extension: string;
  /** 供指纹 / 全文检索拼接 */
  fingerprints: string[];
  raw: string;
};

export function extractBasenameFromUrlOrPath(input: string): string {
  const noQuery = input.split('?')[0]?.split('#')[0] ?? input;
  return noQuery.replace(/\\/g, '/').split('/').pop() ?? noQuery;
}

export function parseFilenameAnchor(filenameOrUrl: string | null | undefined): FilenameAnchorParse | null {
  if (!filenameOrUrl) return null;
  const base = extractBasenameFromUrlOrPath(filenameOrUrl.trim());
  const m = base.match(FILENAME_ANCHOR_REGEX);
  if (!m) return null;
  const brand = m[1]!.trim();
  const series = m[2]!.trim();
  const feature = m[3]!.trim();
  const pageSegment = Number(m[4]);
  if (!Number.isFinite(pageSegment) || pageSegment < 1) return null;
  const extension = (m[5] ?? '').toLowerCase();
  return {
    brand,
    series,
    feature,
    pageSegment,
    extension,
    fingerprints: [brand, series, feature, `P${pageSegment}`],
    raw: base,
  };
}

export function isHandbookPageAssetFilenameCompliant(filenameOrUrl: string | null | undefined): boolean {
  return parseFilenameAnchor(filenameOrUrl) != null;
}

export type FilenameConventionViolation = {
  source: string;
  basename: string;
  reason: string;
};

export function scanFilenameConventionViolations(urlsOrPaths: readonly string[]): FilenameConventionViolation[] {
  const out: FilenameConventionViolation[] = [];
  for (const s of urlsOrPaths) {
    const basename = extractBasenameFromUrlOrPath(s);
    if (!parseFilenameAnchor(basename)) {
      out.push({
        source: s,
        basename,
        reason: `不符合 ${HANDBOOK_PAGE_ASSET_FILENAME_CONVENTION.slice(0, 80)}…`,
      });
    }
  }
  return out;
}

// ─── Visual-Text-Anchor（插件 A）──────────────────────────────────────────

export const VISUAL_TEXT_ANCHOR_FILENAME_CONVENTION =
  '可选「视觉文本锚」basename：`P{页码}_{语义}_{语义}.ext`（下划线分段，ext 为 jpg/jpeg/png/webp）。' +
  '示例：`P26_A系列_渐进.jpg` — 页码段可与 manifest 物理序交叉校验，语义段参与矩阵 productName 子串匹配。';

/** `P26_A系列_渐进.jpg` */
const VISUAL_TEXT_ANCHOR_RE_P = /^P(\d+)_(.+)\.(jpe?g|png|webp)$/i;
/** `26_A系列_渐进.jpg`（无 P 前缀） */
const VISUAL_TEXT_ANCHOR_RE_NUM = /^(\d{1,4})_(.+)\.(jpe?g|png|webp)$/i;
/** `page_026_A系列_渐进.jpg` — 物理序文件名上叠语义（可选） */
const VISUAL_TEXT_PAGESTEM_RE = /^page_(\d+)_(.+)\.(jpe?g|png|webp)$/i;

export type VisualTextAnchorParse = {
  /** 文件名中的页码提示（印刷或物理，由资产管线约定） */
  pageHint: number;
  tokens: string[];
  fingerprints: string[];
  raw: string;
};

/**
 * 从 manifest URL / 磁盘路径解析「视觉文本锚」；与四段 hyphen 规约互斥时可并存（本函数独立识别）。
 */
export function parseVisualTextAnchorFilename(filenameOrUrl: string | null | undefined): VisualTextAnchorParse | null {
  if (!filenameOrUrl) return null;
  const base = extractBasenameFromUrlOrPath(filenameOrUrl.trim());
  let pageHint: number;
  let body: string;
  const mP = base.match(VISUAL_TEXT_ANCHOR_RE_P);
  const mStem = base.match(VISUAL_TEXT_PAGESTEM_RE);
  const mNum = base.match(VISUAL_TEXT_ANCHOR_RE_NUM);
  if (mP) {
    pageHint = Number(mP[1]);
    body = mP[2]!;
  } else if (mStem) {
    pageHint = Number(mStem[1]);
    body = mStem[2]!;
  } else if (mNum) {
    pageHint = Number(mNum[1]);
    body = mNum[2]!;
  } else {
    return null;
  }
  if (!Number.isFinite(pageHint) || pageHint < 1) return null;
  const tokens = body
    .split('_')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const joined = tokens.join('');
  const fingerprints = [`P${pageHint}`, ...tokens, joined];
  return { pageHint, tokens, fingerprints, raw: base };
}

// ─── Index 校准 · MatchScore（优先语义）──────────────────────────────────

export type CalibratorInput = {
  pdfIndex1Based: number;
  pageTitle?: string | null;
  ocrTextSnippet?: string | null;
  /** manifest URL 末段或本地路径 */
  assetFilename?: string | null;
};

/** L1 文件名断言 > L2 标题/OCR > L3 页码偏移兜底 */
export type MatchLevel = 1 | 2 | 3;

export type MatchScore = {
  level: MatchLevel;
  /** 0–100，越高越可信 */
  score: number;
  /** 人读标签，如 `L1:slug:A-Series-Progressive` */
  label: string;
};

/** 供 `FORCE_SYNC_ANCHOR` 类 action 消费的最终锚点 */
export type CorrectedAnchor = {
  pdfIndex1Based: number;
  /** L1/L2 锁到的矩阵行；L3 可能仅从手册页反推 */
  productName: string | null;
  matchScore: MatchScore;
  /** L3：`correctedPdf - physicalPdf`；与矩阵校准有关，**与** StandardEye 物理侧栏（`tab:{pdfPage}`）无关 */
  pageOffset: number;
};

export type CalibratorResult = {
  pdfIndex1Based: number;
  confidence: 'high' | 'medium' | 'low';
  matchScore: MatchScore;
  correctedAnchor: CorrectedAnchor;
  reasons: readonly string[];
  filenameAnchor: FilenameAnchorParse | null;
  visualTextAnchor: VisualTextAnchorParse | null;
  /** 蔡司品牌宣传等非价目挂载页：宿主应跳过矩阵逻辑页覆盖 */
  zeissScanFilter?: ZeissHandbookScanFilterHit;
  /** 自动索引：MarketingPage 与快速翻阅权重（与页表 quickNavWeight 取 min 由宿主决定） */
  marketingIndexMeta?: HandbookMarketingIndexMeta;
};

/** 与 reducer 对齐的 action type（宿主侧自行 dispatch） */
export const FORCE_SYNC_ANCHOR = 'FORCE_SYNC_ANCHOR' as const;

const HANDBOOK_MAX_PDF = ZEISS_HANDBOOK_PAGE_MAP.length;

function clampPdfPage(n: number): number {
  return Math.min(Math.max(1, Math.floor(n)), HANDBOOK_MAX_PDF);
}

function normalizeAsciiSlugFromBasename(filenameOrUrl: string): string {
  const base = extractBasenameFromUrlOrPath(filenameOrUrl.trim());
  return base
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp)$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeAsciiSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const MATRIX_PRODUCT_NAME_SET: ReadonlySet<string> = new Set(
  ZEISS_PRICE_MATRIX.map((p) => p.productName.trim()),
);

/**
 * L1：ASCII 文件名 slug → 矩阵 `productName`（可随资产管线扩展）。
 * 仅保留 JSON 中真实存在的 productName。
 */
const FILENAME_STRONG_SLUG_RULES: readonly Readonly<{ slug: string; productName: string }>[] = (() => {
  const raw: { slug: string; productName: string }[] = [
    /** 压力测试 / manifest 短指纹：normalize 后为 `aprog` */
    { slug: 'a-prog', productName: '睐光2.0 D渐进' },
    { slug: 'a-series-progressive', productName: '睐光2.0 D渐进' },
    { slug: 'aseriesprogressive', productName: '睐光2.0 D渐进' },
    { slug: 'a-series-pal', productName: '睐光2.0 D渐进' },
    { slug: 'smartlife-single', productName: '智锐单光' },
    { slug: 'smartlifesingle', productName: '智锐单光' },
    { slug: 'smartlife-sv', productName: '智锐单光' },
  ];
  return raw.filter((r) => MATRIX_PRODUCT_NAME_SET.has(r.productName));
})();

/**
 * L2：标题/OCR 未出现完整 `productName` 时的语义预设（正则 → 矩阵行）。
 */
const TITLE_SEMANTIC_PRESETS: readonly Readonly<{ re: RegExp; productName: string; label: string }>[] = (() => {
  const raw = [
    { re: /臻锐/, productName: '智锐臻选版单光', label: 'preset:臻锐→智锐臻选版单光' },
    { re: /智锐.*单光|单光.*智锐/, productName: '智锐单光', label: 'preset:智锐单光' },
    { re: /A\s*系列.*渐进|A系列.*渐进/, productName: '睐光2.0 D渐进', label: 'preset:A系列渐进' },
  ] as const;
  return raw.filter((r) => MATRIX_PRODUCT_NAME_SET.has(r.productName));
})();

const MATRIX_PRODUCT_NAMES_LONGEST_FIRST: readonly string[] = (() => {
  const names = ZEISS_PRICE_MATRIX.map((p) => p.productName.trim()).filter((n) => n.length >= 2);
  return [...new Set(names)].sort((a, b) => b.length - a.length);
})();

/** L1 仅用路径/文件名指纹，不把页面标题混入「文件名断言」 */
function buildHaystackFilenameOnly(
  basename: string,
  hyphenAnchor: FilenameAnchorParse | null,
  visualAnchor: VisualTextAnchorParse | null,
): string {
  const stem = basename.replace(/\.(jpe?g|png|webp)$/i, '').trim();
  const parts = [
    stem.length > 0 ? stem : null,
    ...(hyphenAnchor?.fingerprints ?? []),
    ...(visualAnchor?.fingerprints ?? []),
  ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return parts.join(' ');
}

function buildHaystackSoft(input: CalibratorInput): string {
  const parts = [input.pageTitle, input.ocrTextSnippet].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  );
  return parts.join(' ');
}

function tryMatchLongestProductInHaystack(hay: string): string | null {
  if (!hay.trim()) return null;
  for (const name of MATRIX_PRODUCT_NAMES_LONGEST_FIRST) {
    if (hay.includes(name)) return name;
  }
  return null;
}

function tryFilenameSubstringProduct(basename: string): string | null {
  for (const name of MATRIX_PRODUCT_NAMES_LONGEST_FIRST) {
    if (basename.includes(name)) return name;
  }
  return null;
}

function tryL1SlugRules(normAscii: string): { productName: string; label: string } | null {
  for (const rule of FILENAME_STRONG_SLUG_RULES) {
    const ns = normalizeAsciiSlug(rule.slug);
    if (ns.length >= 4 && normAscii.includes(ns)) {
      return { productName: rule.productName, label: `L1:slug:${rule.slug}` };
    }
  }
  return null;
}

function resolvePdfFromProductName(productName: string, physical: number): number {
  return findFirstPdfPageForProduct(productName) ?? physical;
}

function confidenceFromLevel(level: MatchLevel, offsetNonZero: boolean): CalibratorResult['confidence'] {
  if (level === 1 || level === 2) return 'high';
  if (level === 3 && offsetNonZero) return 'medium';
  return 'low';
}

/**
 * MatchScore + CorrectedAnchor：L1 文件名断言 → L2 标题/OCR → L3 页码偏移。
 */
export class IndexAutoCalibrator {
  calibrate(input: CalibratorInput): CalibratorResult {
    const physical = clampPdfPage(input.pdfIndex1Based);
    const filenameAnchor = parseFilenameAnchor(input.assetFilename);
    const visualTextAnchor = parseVisualTextAnchorFilename(input.assetFilename);
    const basename = input.assetFilename ? extractBasenameFromUrlOrPath(input.assetFilename) : '';
    const normAscii = input.assetFilename ? normalizeAsciiSlugFromBasename(input.assetFilename) : '';
    const reasons: string[] = [];

    if (filenameAnchor) {
      reasons.push(`filename-anchor:parsed:${filenameAnchor.raw}`);
    }
    if (visualTextAnchor) {
      reasons.push(`visual-text-anchor:parsed:${visualTextAnchor.raw}`);
    }

    let pdf = physical;
    let level: MatchLevel = 3;
    let score = 25;
    let label = 'L3:fallback-physical';
    let lockedProduct: string | null = null;
    let pageOffset = 0;

    // ── L1：文件名强匹配（含 slug；**不依赖页码段**）────────────────────
    const slugHit = normAscii.length >= 4 ? tryL1SlugRules(normAscii) : null;
    const subHit = basename ? tryFilenameSubstringProduct(basename) : null;
    const l1Product = slugHit?.productName ?? subHit ?? null;
    if (l1Product) {
      pdf = resolvePdfFromProductName(l1Product, physical);
      lockedProduct = l1Product;
      level = 1;
      score = 100;
      label = slugHit?.label ?? `L1:filename-substring:${l1Product}`;
      reasons.push(`L1-lock:${l1Product}→pdfIndex=${pdf}（忽略文件名页码提示）`);
    } else {
      // hyphen / 视觉锚指纹 + basename（不含当前页标题，避免与 L2 抢优先级）
      const hayFile = buildHaystackFilenameOnly(basename, filenameAnchor, visualTextAnchor);
      const fromHayFile = tryMatchLongestProductInHaystack(hayFile);
      if (fromHayFile) {
        pdf = resolvePdfFromProductName(fromHayFile, physical);
        lockedProduct = fromHayFile;
        level = 1;
        score = 95;
        label = 'L1:filename-fingerprint+matrix';
        reasons.push(`L1-lock:${fromHayFile}→pdfIndex=${pdf}`);
      }
    }

    // ── L2：标题 / OCR / 预设（文件名路径未断言产品时）────────────────
    if (level !== 1) {
      const soft = buildHaystackSoft(input);
      let l2Product = tryMatchLongestProductInHaystack(soft);
      if (!l2Product && soft.trim()) {
        for (const preset of TITLE_SEMANTIC_PRESETS) {
          if (preset.re.test(soft)) {
            l2Product = preset.productName;
            reasons.push(`L2-preset:${preset.label}`);
            break;
          }
        }
      }
      if (l2Product) {
        pdf = resolvePdfFromProductName(l2Product, physical);
        lockedProduct = l2Product;
        level = 2;
        score = 85;
        label = 'L2:title-or-ocr-or-preset';
        reasons.push(`L2-lock:${l2Product}→pdfIndex=${pdf}`);
      }
    }

    // ── L3：页码偏移兜底（仅 L1/L2 未锁产品时）────────────────────────
    if (level === 3) {
      let off = 0;
      if (filenameAnchor) {
        off = filenameAnchor.pageSegment - physical;
      } else if (visualTextAnchor) {
        off = visualTextAnchor.pageHint - physical;
      }
      pageOffset = off;
      if (off !== 0) {
        pdf = clampPdfPage(physical + off);
        reasons.push(`L3-offset:physical=${physical}+(${off})→pdfIndex=${pdf}`);
        score = 50;
        label = 'L3:page-index-offset';
      } else {
        pdf = physical;
        reasons.push('L3:fallback:无偏移，保留物理 pdfIndex');
        score = 20;
        label = 'L3:fallback-physical';
      }
      const entry = getPageByPdfIndex(pdf);
      lockedProduct = entry?.productName?.trim() ?? null;
    } else {
      pageOffset = pdf - physical;
    }

    const softForZeissFilter = buildHaystackSoft(input);
    const zeissScanFilter = assessZeissHandbookScanFilter(softForZeissFilter);
    const marketingIndexMeta = assessHandbookMarketingIndexMeta(softForZeissFilter);
    let outPdf = pdf;
    let outLocked = lockedProduct;
    let outLevel = level;
    let outScore = score;
    let outLabel = label;
    let outPageOffset = pageOffset;
    const outReasons = [...reasons];

    if (zeissScanFilter) {
      outPdf = physical;
      outPageOffset = 0;
      outLevel = 3;
      outScore = 10;
      outLabel = 'L0:zeiss-brand-promo-skip';
      const entry = getPageByPdfIndex(physical);
      outLocked = entry?.productName?.trim() ?? null;
      outReasons.push(`L0:zeiss-scan-filter:${zeissScanFilter.displayLabel}`);
    }

    const matchScore: MatchScore = { level: outLevel, score: outScore, label: outLabel };
    const confidence = confidenceFromLevel(outLevel, outPageOffset !== 0);
    const correctedAnchor: CorrectedAnchor = {
      pdfIndex1Based: outPdf,
      productName: outLocked,
      matchScore,
      pageOffset: outPageOffset,
    };

    return {
      pdfIndex1Based: outPdf,
      confidence,
      matchScore,
      correctedAnchor,
      reasons: outReasons,
      filenameAnchor,
      visualTextAnchor,
      ...(zeissScanFilter ? { zeissScanFilter } : {}),
      ...(marketingIndexMeta.isMarketingPage || marketingIndexMeta.quickNavWeight < 0.99
        ? { marketingIndexMeta }
        : {}),
    };
  }
}

export const defaultIndexAutoCalibrator = new IndexAutoCalibrator();

/**
 * 插件 A 入口：与 UI reducer 配合时可 `dispatch({ type: FORCE_SYNC_ANCHOR, payload: r.correctedAnchor })`。
 */
export function pluginACalibrate(input: CalibratorInput): CalibratorResult {
  return defaultIndexAutoCalibrator.calibrate(input);
}

export const pluginA = {
  calibrate: pluginACalibrate,
  FORCE_SYNC_ANCHOR,
} as const;

/** 宿主是否应用「逻辑 pdfIndex」覆盖物理页（收银 / 价目提示） */
export function shouldApplyMatrixPdfFromCalibration(r: CalibratorResult): boolean {
  if (r.zeissScanFilter?.action === 'SKIP_DATA_MOUNT') return false;
  if (r.matchScore.level === 1 || r.matchScore.level === 2) return true;
  if (r.matchScore.level === 3 && r.correctedAnchor.pageOffset !== 0) return true;
  return false;
}

// ─── Schema 完整性扫描 ─────────────────────────────────────────────────

export type SchemaGapKind =
  | 'handbook_price_row_missing_product_anchor'
  | 'handbook_title_hint_without_matrix_anchor'
  | 'matrix_product_missing_handbook_nav'
  | 'handbook_nav_product_missing_matrix';

export type SchemaGapItem = {
  kind: SchemaGapKind;
  /** 展示用一行说明 */
  summary: string;
  pdfPage?: number;
  title?: string;
  productName?: string;
  /** 标题命中的提示词（若有） */
  matchedHints?: readonly string[];
};

/**
 * 侧栏或顾客口语中常见、但当前页尚未挂 `productName` / JSON 矩阵的系列线索。
 * 命中仅表示「需人工核对」，避免把普通章节标题误报为缺口。
 */
export const MATRIX_SCHEMA_TITLE_HINT_KEYWORDS: readonly string[] = [
  '臻锐',
  'A系列渐进',
  'A 系列渐进',
  'A系列',
  'A 系列',
  '康乐型',
  '时尚型单光',
  '3Dv',
];

function matrixNameSet(): Set<string> {
  return new Set(ZEISS_PRICE_MATRIX.map((p) => p.productName.trim()));
}

/** 价目锚点集合（物理侧栏与解耦；schema 扫描以页表为准） */
function navProductNamesFromHandbook(): Set<string> {
  const out = new Set<string>();
  for (const e of ZEISS_HANDBOOK_PAGE_MAP) {
    const n = e.productName?.trim();
    if (e.section === 'price' && n) out.add(n);
  }
  return out;
}

function titleCoversAnyMatrixProductName(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  for (const p of ZEISS_PRICE_MATRIX) {
    const n = p.productName.trim();
    if (n.length >= 2 && t.includes(n)) return true;
  }
  return false;
}

/**
 * 对比价目矩阵与手册导航 / 页表：生成待补全列表（不抛错，供 CI 日志与人工 backlog）。
 */
export function runSchemaCompletenessScan(): SchemaGapItem[] {
  const gaps: SchemaGapItem[] = [];
  const matrix = matrixNameSet();
  const navProducts = navProductNamesFromHandbook();

  for (const name of matrix) {
    if (!navProducts.has(name)) {
      gaps.push({
        kind: 'matrix_product_missing_handbook_nav',
        productName: name,
        summary: `矩阵有「${name}」但手册 price 页表中未出现该 productName 锚点`,
      });
    }
  }

  for (const name of navProducts) {
    if (!matrix.has(name)) {
      gaps.push({
        kind: 'handbook_nav_product_missing_matrix',
        productName: name,
        summary: `手册 price 页表有「${name}」但 ZEISS_PRICE_MATRIX 中无同名 productName`,
      });
    }
  }

  for (const e of ZEISS_HANDBOOK_PAGE_MAP) {
    const title = (e.title ?? '').trim();
    const hasAnchor = Boolean(e.productName?.trim());

    if (e.section === 'price' && !hasAnchor) {
      gaps.push({
        kind: 'handbook_price_row_missing_product_anchor',
        pdfPage: e.pdfPage,
        title: title || '(无标题)',
        summary: `手册 section=price 物理页 ${e.pdfPage} 无 productName（${title || '无标题'}）`,
      });
    }

    if (hasAnchor || !title) continue;
    // section=price 且无锚已由上一分支覆盖，避免同页双报
    if (e.section === 'price') continue;

    const hints = MATRIX_SCHEMA_TITLE_HINT_KEYWORDS.filter((kw) => title.includes(kw));
    if (hints.length === 0) continue;
    if (titleCoversAnyMatrixProductName(title)) continue;

    gaps.push({
      kind: 'handbook_title_hint_without_matrix_anchor',
      pdfPage: e.pdfPage,
      title,
      matchedHints: hints,
      summary: `物理页 ${e.pdfPage} 标题含线索 [${hints.join(', ')}] 但未绑定 productName / 矩阵行`,
    });
  }

  return gaps;
}

export function formatSchemaGapTodoMarkdown(gaps: readonly SchemaGapItem[]): string {
  const lines: string[] = [
    '## 价目矩阵 · Schema 待补全列表（IndexAutoCalibrator）',
    '',
    '| 类型 | 说明 |',
    '| --- | --- |',
  ];
  for (const g of gaps) {
    const kind =
      g.kind === 'handbook_price_row_missing_product_anchor'
        ? '价目页缺锚'
        : g.kind === 'handbook_title_hint_without_matrix_anchor'
          ? '标题线索无矩阵'
          : g.kind === 'matrix_product_missing_handbook_nav'
            ? '矩阵缺导航'
            : '导航缺矩阵';
    lines.push(`| ${kind} | ${g.summary.replace(/\|/g, '\\|')} |`);
  }
  if (gaps.length === 0) {
    lines.push('', '_无缺口_');
  }
  lines.push('', '<!-- 由 runSchemaCompletenessScan() 生成；可贴入 backlog / PR 描述 -->');
  return lines.join('\n');
}
