/**
 * 蔡司 2026 手册·3D 翻页页码映射表
 *
 * ## StandardEye V1.3 · 核心法案（锁死，勿以 productName/标题推断侧栏）
 *
 * 1. **物理绝对映射**：侧栏唯一触发源为 `physicalTabVerified === true` 且 `pageKind === 'series_entry'`；
 *    侧栏文案 **仅** 使用 `physicalTabLabel`（视觉真值），**禁止**用 `title` 回填冒充凸标文字。
 * 2. **UI 行为锁定**：`HandbookSeriesNavItem.id = tab:{pdfPage}`，`startPage0 = pdfPage - 1`；无 `jumpTarget`、无自动翻向价目页。
 * 3. **数据解耦**：`productName` / `section` / 矩阵 / `runSchemaCompletenessScan` 与物理侧栏独立；`getPageData` 对未验证的
 *    `series_entry` 降格为 `standard`，防止假凸标污染 UI。
 * 4. **扫描辅助规范**：全週邊凸标几何扫描见 `handbookPhysicalLabelScan.ts`（左/中/右三带 + `hOffsetPercent`/`vOffsetPercent`）；
 *    豪雅圆角/色带见 `hoyaPhysicalTabScanParams.ts`；**不得**在运行时用扫描结果自动推断导航目标（仍以页表为准）。
 *
 * 打开图手册时建议从 `/api/catalog/zeiss-manifest` 拉取图片清单（物理页序与 `pdfPage` 一致），再与本表合并。
 */

import type { ZeissProductMatrix } from '@/data/zeissPriceMatrix';
import {
  ZEISS_HANDBOOK_PAGE_IMAGE_DATA,
  ZEISS_PRICE_MATRIX,
  matrixLensTypeGroupLabel,
} from '@/data/zeissPriceMatrix';
import { ESSILOR_HANDBOOK_PAGE_MAP } from '@/data/essilorHandbookPageMap';
import {
  ESSILOR_HANDBOOK_PAGE_IMAGE_DATA,
  findEssilorProductMatrix,
} from '@/data/essilorPriceMatrix';
import { HOYA_HANDBOOK_PAGE_MAP } from '@/data/hoyaHandbookPageMap';
import {
  HOYA_HANDBOOK_PAGE_IMAGE_DATA,
  findHoyaProductMatrix,
} from '@/data/hoyaPriceMatrix';
import {
  buildHoyaSeriesNavigationItems,
  HOYA_PHYSICAL_TAB_H_OFFSET_PERCENT_BY_PDF_PAGE,
  HOYA_PHYSICAL_TAB_V_OFFSET_PERCENT_BY_PDF_PAGE,
  isHoyaManualTrimmedPdfPage,
  isHoyaPhysicalAnchorPdfPage,
} from '@/data/hoyaSeriesNav';

export type HandbookSection =
  | 'cover-brand'
  | 'brand-matrix'
  | 'product-highlights'
  | 'lens-series-overview'
  | 'coating'
  | 'anti-blue-light'
  | 'all-zeiss-frames-intro'
  | 'services'
  | 'smartlife-series-opening'
  | 'price'
  | 'myopia-control-intro'
  | 'pal-intro'
  | 'driving-intro'
  | 'outdoor-intro'
  | 'office-intro'
  | 'children-frames'
  | 'accessories'
  | 'appendix'
  /** 蔡司单光家族：P24–P26 总览/矩阵/泽锐引导（见 matrix/zeiss-handbook-sv-alignment） */
  | 'single-vision-ladder';

/** 实体手册页类：标准内容 / 系列扉页（右侧竖条）/ 品牌宣傳 */
export type HandbookPageKind = 'standard' | 'series_entry' | 'marketing';

/** 侧栏「凸出标签」配色（蔡司固定深蓝；豪雅按系列变色） */
export type HandbookNavTabTone = 'zeiss-deep-blue' | 'hoya-orange' | 'hoya-blue' | 'hoya-purple' | 'neutral';

export interface HandbookPageEntry {
  /** PDF 物理页码（1-based） */
  pdfPage: number;
  /** 手册底部印刷页码（P##）；封面 / 非价目页可能为 null */
  printedPage: number | null;
  /** 页面分类 */
  section: HandbookSection;
  /** 该页价目锚定的产品名（对应 ZEISS_PRICE_MATRIX[].productName） */
  productName?: string;
  /** 是否需要人工/OCR 补录（文本层为 CID 占位） */
  ocrRequired?: boolean;
  /** 内页标题（目录/翻页 UI）；物理侧栏**不得**用此字段代替 `physicalTabLabel` */
  title?: string;
  /** 静态 public 路径（如豪雅 `/catalog/hoya/pages/p1.jpg`）；无内嵌图时由 3D 页组件使用 */
  imageUrl?: string;
  /**
   * `series_entry`：**仅**在 PDF 右缘物理凸起标签已扫描确认后使用；须同时设 `physicalTabVerified: true`。
   * `physicalTabLabel`：凸起印字，侧栏 1:1 展示（与 `title` 可不同）。
   */
  pageKind?: HandbookPageKind;
  /** 扫描 pipeline 写入；未验证则不得标为 series_entry 侧栏项 */
  physicalTabVerified?: boolean;
  /**
   * 凸起标签上的文字：须 **1:1** 还原实体印字。禁止：页码区间（如 p1–p8）、括号英文营销（如 MiyoSmart）、冗长描述句。
   * 进入侧栏时必填，否则该项丢弃。
   */
  physicalTabLabel?: string;
  /**
   * 已验证凸标页：凸起在**整页可视高度**上的垂直锚点（0–100，自顶向下，通常为凸标块几何中心）。
   *
   * StandardEye「视觉即真理」法案：侧栏与页内透明命中层必须同时读取本字段，
   * 用 `top: ${vOffsetPercent}%` + `translateY(-50%)` 绝对定位；**禁止** 以 `justify-between`
   * / `flex-1` / `gap` 在运行时均分撑开代替物理坐标，亦禁止用 `title` 推断位置。
   */
  vOffsetPercent?: number;
  /**
   * 凸标中心相对整页宽（0–100，自左向右）。内嵌式 / 摺痕侧标签必填；缺省时热区回退为右缘条带。
   * 与 `handbookPhysicalLabelScan.scanPhysicalTabCandidatesFromImageData` 输出的 `hOffsetPercent` 同源。
   */
  hOffsetPercent?: number;
  seriesAliasKey?: string;
  /** 快速翻阅权重 0–1；marketing 等页在 runtime 可与 OCR 评估合并取 min */
  quickNavWeight?: number;
}

export const ZEISS_HANDBOOK_PAGE_MAP: readonly HandbookPageEntry[] = Object.freeze([
  // 前言（封面 / 品牌 / 产品总览）
  {
    pdfPage: 1,
    printedPage: null,
    section: 'cover-brand',
    title: '封面·品牌',
    ocrRequired: true,
    pageKind: 'marketing',
    quickNavWeight: 0.32,
  },
  { pdfPage: 2,  printedPage: 1,    section: 'brand-matrix',           title: '品牌矩阵' },
  { pdfPage: 3,  printedPage: 2,    section: 'product-highlights',     title: '您的明智之选' },
  { pdfPage: 4,  printedPage: 3,    section: 'lens-series-overview',   title: '蔡司户外系列 / 重点推荐' },
  { pdfPage: 5,  printedPage: 4,    section: 'lens-series-overview',   title: '镜片家族总览' },
  { pdfPage: 6,  printedPage: null, section: 'coating',                title: '蔡司钻立方膜层' },
  { pdfPage: 7,  printedPage: null, section: 'anti-blue-light',        title: '防蓝光 Plus / 防蓝光膜' },
  { pdfPage: 8,  printedPage: null, section: 'all-zeiss-frames-intro', title: '一整副都蔡司·镜架' },
  { pdfPage: 9,  printedPage: null, section: 'services',               title: '蔡司眼镜套装·专业服务' },
  { pdfPage: 10, printedPage: null, section: 'smartlife-series-opening', title: '智锐系列扉页' },
  { pdfPage: 11, printedPage: null, section: 'smartlife-series-opening', title: '智锐识别设计 2.0' },
  { pdfPage: 12, printedPage: null, section: 'smartlife-series-opening', title: '智锐技术矩阵' },
  { pdfPage: 13, printedPage: null, section: 'smartlife-series-opening', title: '智锐单光引导页' },

  // 智锐单光 & 衍生
  { pdfPage: 14, printedPage: 5,  section: 'price', productName: '智锐单光',          title: '智锐单光（标配/偏光/焕色）' },
  { pdfPage: 15, printedPage: 6,  section: 'price', productName: '智锐臻选版单光',    title: '智锐臻选版单光' },
  { pdfPage: 16, printedPage: 7,  section: 'price', productName: '智锐个化版3.0单光', title: '智锐个化版 3.0 单光' },
  { pdfPage: 17, printedPage: null, section: 'smartlife-series-opening', title: '智锐数码型设计对比' },
  { pdfPage: 18, printedPage: 9,  section: 'price', productName: '智锐数码型亚洲版',         title: '智锐数码型亚洲版' },
  { pdfPage: 19, printedPage: 10, section: 'price', productName: '智锐数码型个化版3.0',      title: '智锐数码型个化版 3.0' },
  { pdfPage: 20, printedPage: 11, section: 'smartlife-series-opening', title: '智锐渐进系列对比' },
  { pdfPage: 21, printedPage: 12, section: 'price', productName: '智锐经典版渐进',           title: '智锐经典版渐进' },
  { pdfPage: 22, printedPage: 13, section: 'price', productName: '智锐亚洲版渐进',           title: '智锐亚洲版渐进' },
  { pdfPage: 23, printedPage: 14, section: 'price', productName: '智锐臻选版渐进',           title: '智锐臻选版渐进' },
  { pdfPage: 24, printedPage: 15, section: 'price', productName: '智锐个化版3.0渐进',        title: '智锐个化版 3.0 渐进' },

  // 青少年 / 近视管理
  { pdfPage: 25, printedPage: 16, section: 'myopia-control-intro', title: '孩子近视·就选蔡司' },
  { pdfPage: 26, printedPage: 17, section: 'myopia-control-intro', title: '轴率比·远视储备科普' },
  { pdfPage: 27, printedPage: 18, section: 'myopia-control-intro', title: '近视管理验配流程' },
  { pdfPage: 28, printedPage: 19, section: 'myopia-control-intro', title: 'C.A.R.E. 技术' },
  { pdfPage: 29, printedPage: 20, section: 'price', productName: '小乐圆H版',  title: '小乐圆 H 版' },
  { pdfPage: 30, printedPage: 21, section: 'price', productName: '小乐圆S版',  title: '小乐圆 S 版' },
  { pdfPage: 31, printedPage: 22, section: 'myopia-control-intro', title: '成长怡引导页' },
  { pdfPage: 32, printedPage: 23, section: 'price', productName: '成长怡',      title: '成长怡' },
  // 单光系列：P24 扉页 / P25 矩阵图 / P26 泽锐引导（文本抽自 2026 PDF，非旧版「成长乐/CID」误映射）
  { pdfPage: 33, printedPage: 24, section: 'single-vision-ladder', title: '蔡司单光·清晰视界（P24）' },
  { pdfPage: 34, printedPage: 25, section: 'single-vision-ladder', title: '单光系列·产品线矩阵（P25）' },
  { pdfPage: 35, printedPage: 26, section: 'single-vision-ladder', title: '泽锐单光·产品引导（P26）' },

  // 泽锐 / 新清锐 / A 系列 & 单光附录
  { pdfPage: 36, printedPage: 27, section: 'price', productName: '泽锐单光',         title: '泽锐单光' },
  { pdfPage: 37, printedPage: 28, section: 'price', productName: '新清锐非球面',     title: '新清锐非球面' },
  { pdfPage: 38, printedPage: 29, section: 'price', title: '单光系列附录' },
  { pdfPage: 39, printedPage: 30, section: 'price', title: '单光系列附录' },
  { pdfPage: 40, printedPage: 31, section: 'price', title: 'A 系列时尚型单光' },

  // 睐光 / 渐进
  { pdfPage: 41, printedPage: 32, section: 'pal-intro', title: '睐光 2.0 介绍' },
  { pdfPage: 42, printedPage: 33, section: 'pal-intro', title: '睐光 2.0 轻渐进技术' },
  { pdfPage: 43, printedPage: 34, section: 'price', productName: '睐光2.0轻渐进专业版', title: '睐光 2.0 轻渐进专业版' },
  { pdfPage: 44, printedPage: 35, section: 'price', productName: '睐光2.0轻渐进个化版', title: '睐光 2.0 轻渐进个化版' },
  { pdfPage: 45, printedPage: 36, section: 'pal-intro', title: '睐光 2.0 渐进介绍' },
  { pdfPage: 46, printedPage: 37, section: 'price', productName: '睐光2.0 D渐进',      title: '睐光 2.0 D 渐进' },
  { pdfPage: 47, printedPage: 38, section: 'price', productName: '睐光2.0 3D渐进',     title: '睐光 2.0 3D 渐进' },

  // 以下页码 / 标题由 pendingPages 后续补录（详见 2026_price_matrix.json.pendingPages）
  // 驾驶 / 户外 / 办公 / 镜架 / 加工附录 …
  { pdfPage: 48, printedPage: 39, section: 'pal-intro', title: '睐光 2.0 3Dv 渐进' },
  { pdfPage: 49, printedPage: 40, section: 'driving-intro', title: '驾驶型引导' },
  { pdfPage: 50, printedPage: 41, section: 'driving-intro', title: '驾驶型单光 / 渐进' },
  { pdfPage: 51, printedPage: 42, section: 'outdoor-intro', title: '户外系列' },
  { pdfPage: 52, printedPage: 43, section: 'outdoor-intro', title: '户外系列（价目）' },
  { pdfPage: 53, printedPage: 44, section: 'outdoor-intro', title: '户外系列（价目）' },
  { pdfPage: 54, printedPage: 45, section: 'office-intro', title: '办公型镜片' },
  { pdfPage: 55, printedPage: 46, section: 'office-intro',  title: '办公型镜片（价目）' },
  { pdfPage: 56, printedPage: 47, section: 'pal-intro',     title: '数码变色附加' },
  { pdfPage: 57, printedPage: 48, section: 'pal-intro',     title: '染色 / 镀膜服务' },
  { pdfPage: 58, printedPage: 49, section: 'appendix',      title: '特殊加工 1' },
  { pdfPage: 59, printedPage: 50, section: 'appendix',      title: '特殊加工 2' },
  { pdfPage: 60, printedPage: 51, section: 'appendix',      title: '退换货政策' },
  { pdfPage: 61, printedPage: 52, section: 'appendix',      title: '质保说明' },
  { pdfPage: 62, printedPage: 53, section: 'appendix',      title: '门店二维码' },
  { pdfPage: 63, printedPage: 54, section: 'children-frames', title: '儿童镜架' },
  { pdfPage: 64, printedPage: 55, section: 'children-frames', title: '儿童镜架' },
  { pdfPage: 65, printedPage: 56, section: 'children-frames', title: '儿童镜架（价目）' },
  { pdfPage: 66, printedPage: 57, section: 'children-frames', title: '儿童镜架（价目）' },
  { pdfPage: 67, printedPage: 58, section: 'all-zeiss-frames-intro', title: '成人镜架' },
  { pdfPage: 68, printedPage: 59, section: 'all-zeiss-frames-intro', title: '成人镜架' },
  { pdfPage: 69, printedPage: 60, section: 'all-zeiss-frames-intro', title: '成人镜架' },
  { pdfPage: 70, printedPage: 61, section: 'all-zeiss-frames-intro', title: '成人镜架' },
  { pdfPage: 71, printedPage: 62, section: 'all-zeiss-frames-intro', title: '成人镜架（价目）' },
  { pdfPage: 72, printedPage: 63, section: 'all-zeiss-frames-intro', title: '成人镜架（价目）' },
  { pdfPage: 73, printedPage: 64, section: 'all-zeiss-frames-intro', title: '成人镜架（价目）' },
  { pdfPage: 74, printedPage: 65, section: 'all-zeiss-frames-intro', title: '成人镜架（价目）' },
  { pdfPage: 75, printedPage: 66, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 76, printedPage: 67, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 77, printedPage: 68, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 78, printedPage: 69, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 79, printedPage: 70, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 80, printedPage: 71, section: 'accessories',            title: '配件 / 清洁' },
  { pdfPage: 81, printedPage: 72, section: 'accessories',            title: '服务说明' },
  { pdfPage: 82, printedPage: 73, section: 'accessories',            title: '封底 / 防雾巾' },
]);

// ———————————————————————————————————————————————————————————————————————
// 查询辅助
// ———————————————————————————————————————————————————————————————————————

export function getPageByPdfIndex(pdfPage: number): HandbookPageEntry | null {
  return ZEISS_HANDBOOK_PAGE_MAP.find((p) => p.pdfPage === pdfPage) ?? null;
}

export function getPageByPrinted(printedPage: number): HandbookPageEntry | null {
  return ZEISS_HANDBOOK_PAGE_MAP.find((p) => p.printedPage === printedPage) ?? null;
}

/** 反查：某产品第一次出现在哪一页（PDF 物理） */
export function findFirstPdfPageForProduct(productName: string): number | null {
  const hit = ZEISS_HANDBOOK_PAGE_MAP.find(
    (p) => p.section === 'price' && p.productName === productName,
  );
  return hit ? hit.pdfPage : null;
}

/** 反查：某产品第一次出现在哪一页（印刷页） */
export function findFirstPrintedPageForProduct(productName: string): number | null {
  const pdfPage = findFirstPdfPageForProduct(productName);
  if (pdfPage == null) return null;
  const entry = getPageByPdfIndex(pdfPage);
  return entry?.printedPage ?? null;
}

/** 数字化手册：品牌占位（多品牌切页预留） */
export type DigitalHandbookBrand = 'zeiss' | 'essilor' | 'hoya';

/**
 * 物理侧栏索引签：仅含「已验证凸起标签」对应页；`startPage0 === pdfPage - 1`，无二次跳转。
 */
export type HandbookSeriesNavItem = {
  id: string;
  /**
   * 兼容字段：物理凸标模式下应与 `physicalTabLabel` 相同；依视路 classic 等仍用价目/章节短名。
   * 侧栏「凸标仿真」渲染必须以 `physicalTabVerified` + `physicalTabLabel` 为准。
   */
  label: string;
  section: HandbookSection;
  /** 0-based，与 PDF 物理页严格一致 */
  startPage0: number;
  printedPage: number | null;
  /** 为 true 时侧栏只展示 `physicalTabLabel` 原文 */
  physicalTabVerified?: boolean;
  /** 实体凸标印字 1:1（无页码、无括号英文、无营销长句） */
  physicalTabLabel?: string;
  /**
   * 与 `HandbookPageEntry.vOffsetPercent` 同源（0–100，% from top）；
   * 页内右缘热区（`ZeissHandbookPage`）与（依视路）classic 侧栏共用；缺省时 UI 回退到 50%，应补录。
   */
  vOffsetPercent?: number;
  /** 凸标中心水平位置（0–100）；缺省则热区贴右缘（仅 v 对齐） */
  hOffsetPercent?: number;
  seriesAliasKey?: string;
  navTabTone?: HandbookNavTabTone;
  /** 豪雅：该物理页使用 Boss 精修图（`/catalog/hoya/pages/p{n}.jpg` 或 `.png`） */
  isManualTrimmed?: boolean;
};

const HANDBOOK_SECTION_NAV_LABEL: Record<HandbookSection, string> = {
  'cover-brand': '封面与品牌',
  'brand-matrix': '品牌矩阵',
  'product-highlights': '重点推荐',
  'lens-series-overview': '镜片总览 / 家族',
  'coating': '钻立方膜层',
  'anti-blue-light': '防蓝光',
  'all-zeiss-frames-intro': '蔡司镜架',
  'services': '专业服务与套装',
  'smartlife-series-opening': '智锐系列导读',
  'price': '价目与系列表',
  'myopia-control-intro': '青少年与近视管理',
  'single-vision-ladder': '单光家族',
  'pal-intro': '睐光与渐进',
  'driving-intro': '驾驶型',
  'outdoor-intro': '户外系列',
  'office-intro': '办公/数码型',
  'children-frames': '儿童镜架',
  'accessories': '配件与加工',
  'appendix': '附录',
};

/**
 * 蔡司：仅 `pageKind === 'series_entry'` 且 `physicalTabVerified === true` 的页进入侧栏；
 * 标签文案 **仅** `physicalTabLabel`（无则丢弃，禁止用 `title` 顶替）。
 */
export function buildZeissPhysicalTabNavItems(
  pages: readonly HandbookPageEntry[] = ZEISS_HANDBOOK_PAGE_MAP,
): HandbookSeriesNavItem[] {
  const out: HandbookSeriesNavItem[] = [];
  for (const e of pages) {
    if (e.pageKind !== 'series_entry' || !e.physicalTabVerified) continue;
    const label = (e.physicalTabLabel ?? '').trim();
    if (!label) continue;
    out.push({
      id: `tab:${e.pdfPage}`,
      label,
      physicalTabVerified: true,
      physicalTabLabel: label,
      vOffsetPercent: e.vOffsetPercent,
      hOffsetPercent: e.hOffsetPercent,
      section: e.section,
      startPage0: e.pdfPage - 1,
      printedPage: e.printedPage ?? null,
      seriesAliasKey: e.seriesAliasKey,
      navTabTone: 'zeiss-deep-blue',
    });
  }
  return out.sort((a, b) => a.startPage0 - b.startPage0);
}

/**
 * 蔡司物理侧栏（严格模式）；无已验证凸标时返回空数组。
 */
export function buildHandbookSeriesNavItems(): HandbookSeriesNavItem[] {
  return buildZeissPhysicalTabNavItems(ZEISS_HANDBOOK_PAGE_MAP);
}

/** 指定品牌侧栏：蔡司 = 物理凸标项；依视路 = 页表价目锚点；豪雅 = `buildSeriesNavigation` */
export function buildHandbookSeriesNavItemsForBrand(
  brand: DigitalHandbookBrand = 'zeiss',
): HandbookSeriesNavItem[] {
  const adapter = getBrandAdapter(brand);
  if (!adapter) return [];
  if (typeof adapter.buildSeriesNavigation === 'function') {
    return adapter.buildSeriesNavigation();
  }
  if (brand === 'zeiss') {
    return buildZeissPhysicalTabNavItems(adapter.pages);
  }
  const seen = new Set<string>();
  const out: HandbookSeriesNavItem[] = [];
  const defaultTone: HandbookNavTabTone = brand === 'hoya' ? 'neutral' : 'neutral';
  for (const e of adapter.pages) {
    if (e.productName) {
      const key = `p:${e.productName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: key,
        label: e.productName,
        section: e.section,
        startPage0: e.pdfPage - 1,
        printedPage: e.printedPage,
        navTabTone: defaultTone,
      });
      continue;
    }
    const sk = `s:${e.section}`;
    if (seen.has(sk)) continue;
    seen.add(sk);
    out.push({
      id: sk,
      label: HANDBOOK_SECTION_NAV_LABEL[e.section] ?? e.title ?? e.section,
      section: e.section,
      startPage0: e.pdfPage - 1,
      printedPage: e.printedPage,
      navTabTone: defaultTone,
    });
  }
  return out.sort((a, b) => a.startPage0 - b.startPage0);
}

/** 数字化手册物理页数（0 = 该品牌尚未挂载 adapter） */
export function getHandbookPageCount(brand: DigitalHandbookBrand): number {
  return getBrandAdapter(brand)?.pages.length ?? 0;
}

/**
 * 蔡司右缘插片 `top%` 的**末位回退**：仅当页表未提供 `vOffsetPercent` 时使用。
 * 公式 `(pdfPage / totalPages) * 100` 与物理页序一致；**不得**替代页表中已写入的 `vOffsetPercent`。
 * 禁止用硬编码「系列名 → 页码」名单替代本数据链（见 StandardEye 物理映射）。
 */
export function zeissPhysicalTabRailFallbackTopPercent(
  startPage0: number,
  totalPages: number,
): number {
  if (totalPages <= 0) return 0;
  const pdfPage = Math.max(1, Math.min(totalPages, Math.floor(startPage0) + 1));
  return Math.min(100, Math.max(0, (pdfPage / totalPages) * 100));
}

/**
 * 与手动翻页同步：取当前页所属「最后一条不越过当前页」的导航项 AnchorID。
 * 若需插件 B 的 `dataStatus: "validated" | "warning"` 与占位文案，请用
 * `resolveActiveHandbookNavState()`（@/lib/catalog/dataIntegrityValidator）。
 */
export function getActiveHandbookNavId(
  items: readonly HandbookSeriesNavItem[],
  currentPage0: number,
): string {
  if (items.length === 0) return '';
  let id = items[0]!.id;
  for (const it of items) {
    if (it.startPage0 <= currentPage0) id = it.id;
  }
  return id;
}

/** 侧栏章节导航（可塞进 3D 翻页组件的右侧 tab） */
export function buildSideNav(): Array<{
  id: HandbookSection;
  label: string;
  startPdfPage: number;
  startPrintedPage: number | null;
}> {
  const seen = new Map<HandbookSection, HandbookPageEntry>();
  for (const entry of ZEISS_HANDBOOK_PAGE_MAP) {
    if (!seen.has(entry.section)) seen.set(entry.section, entry);
  }
  const labelMap: Record<HandbookSection, string> = {
    'cover-brand': '封面',
    'brand-matrix': '品牌矩阵',
    'product-highlights': '重点推荐',
    'lens-series-overview': '镜片总览',
    'coating': '膜层',
    'anti-blue-light': '防蓝光',
    'all-zeiss-frames-intro': '蔡司镜架',
    'services': '专业服务',
    'smartlife-series-opening': '智锐',
    'price': '价格总表',
    'myopia-control-intro': '青少年',
    'single-vision-ladder': '单光家族',
    'pal-intro': '渐进 / 睐光',
    'driving-intro': '驾驶',
    'outdoor-intro': '户外',
    'office-intro': '办公',
    'children-frames': '儿童镜架',
    'accessories': '配件',
    'appendix': '附录',
  };
  return Array.from(seen.entries()).map(([id, entry]) => ({
    id,
    label: labelMap[id],
    startPdfPage: entry.pdfPage,
    startPrintedPage: entry.printedPage,
  }));
}

// MATRIX_PROTOCOL_V1 — 黄金索引层（Absolute Indexing）
// ───────────────────────────────────────────────────────────────────────────
// 目标：UI 与收银、搜索、语音、快捷跳转等**全部**走统一的 `getPageData(pdfIndex)`，
//   严禁 UI 直接用数组下标 / printedPage / productName 去拼 UI 文案与业务数据。
//
// 三位一体 + 内嵌图：
//   - pdfIndex / printedLabel / dataAnchor 同上
//   - imageData     与价目同内存：`2026_price_matrix.json` 的 `handbookPageImageData[物理页]`
//                    或该页 product 的 `imageData`（data URL），无则 null
//   - imageUrl      豪雅等：`HandbookPageEntry.imageUrl` → `/catalog/[品牌]/p{n}.jpg`（PDF 拆解）
//
// 跨品牌：通过 `HANDBOOK_BRAND_REGISTRY` 扩展，下一次放入「依视路.pdf」时，
//   只需新增一条注册 + 对应 pageMap 数组，UI / 收银桥接可**零修改**自动适配。
// ───────────────────────────────────────────────────────────────────────────

/** UI 渲染/收银加入时所需的统一页面数据 */
export interface HandbookPageData {
  brand: DigitalHandbookBrand;
  /** 1-based 物理页（= manifest 页序 = public/.../pages/page_NNN） */
  pdfIndex: number;
  /** 印刷页字符串，如 'P05'；封面/广告页为 null */
  printedLabel: string | null;
  /** 价目矩阵 key（= ZeissProductMatrix.productName）；非价目页为 null */
  dataAnchor: string | null;
  section: HandbookSection;
  title: string;
  /** 该页对应的完整产品矩阵（供 UI 快速渲染/收银透传；无锚时为 null） */
  product: ZeissProductMatrix | null;
  /** 是否 OCR 待补录（图在、但结构化价目缺失） */
  ocrRequired: boolean;
  /**
   * 本页内嵌位图 data URL（`data:image/webp;base64,...` 等），与价目同 JSON 加载；无内嵌为 null
   */
  imageData: string | null;
  /** public 静态图 URL（优先内嵌图缺失时使用，如豪雅 PDF 拆解的 p{n}.jpg） */
  imageUrl: string | null;
  pageKind: HandbookPageKind;
  physicalTabVerified: boolean;
  physicalTabLabel: string | null;
  seriesAliasKey: string | null;
  /** 快速翻阅权重（静态表 × OCR 评估可取 min） */
  quickNavWeight: number;
  /** 凸标垂直锚点（0–100，% from top）；豪雅可由菜单表注入，蔡司来自页表 `vOffsetPercent` */
  vOffsetPercent: number | null;
  /** 凸标中心水平锚点（0–100，% from left）；缺省为 null（UI 右缘回退） */
  hOffsetPercent: number | null;
  /**
   * 物理锚点页：本页有已验证的印刷凸起标签（StandardEye 仅对此类页做「保护性出血」裁剪；
   * 非锚点页保持整图原样，避免全册裁剪造成视觉漂移）。
   */
  physicalAnchorPage: boolean;
  /**
   * 豪雅：Boss 精修页在 `public/catalog/hoya/pages/p{n}.jpg`（默认）或同路径 `.png`（透明版）。
   * 为 true 时 `imageUrl` 先指向 `pages` 子目录下该页，且 **禁止** clip-path / inset 出血；页容器 overflow 可见以保留凸标。
   */
  isManualTrimmed?: boolean;
  /**
   * 锚点页保护性 inset（% of box，供 `clip-path: inset()`）；仅 `physicalAnchorPage` 时由页表或 UI 默认注入。
   * 标签所在一侧 inset 更小，使色块在成品矩形外仍可见（配合 `overflow: visible`）。
   */
  anchorPreservationInsetPct?: { top: number; right: number; bottom: number; left: number } | null;
}

/** 品牌适配接口：新品牌只需实现此契约 */
export interface HandbookBrandAdapter {
  brand: DigitalHandbookBrand;
  /** 1..N 的物理页表 */
  pages: readonly HandbookPageEntry[];
  /** productName → product 查找；允许复用既有价目矩阵 API */
  resolveProduct: (productName: string) => ZeissProductMatrix | undefined;
  /** 图片清单 API 路径（可选，用于 UI 预读；为空则回退到 public 扫描） */
  manifestApi?: string;
  /**
   * 若设置：该品牌侧栏**仅**走本函数（蔡司已固定为 `buildZeissPhysicalTabNavItems`，勿在此重复实现凸标逻辑）。
   */
  buildSeriesNavigation?: () => HandbookSeriesNavItem[];
}

const ZEISS_ADAPTER: HandbookBrandAdapter = {
  brand: 'zeiss',
  pages: ZEISS_HANDBOOK_PAGE_MAP,
  resolveProduct: (name) => ZEISS_PRICE_MATRIX.find((p) => p.productName === name.trim()),
  manifestApi: '/api/catalog/zeiss-manifest/',
};

const ESSILOR_HANDBOOK_PAGE_ENTRIES: readonly HandbookPageEntry[] = ESSILOR_HANDBOOK_PAGE_MAP.map((e) => ({
  pdfPage: e.pdfPage,
  printedPage: e.printedPage,
  section: e.section as HandbookSection,
  productName: e.productName,
  title: e.title,
}));

const ESSILOR_ADAPTER: HandbookBrandAdapter = {
  brand: 'essilor',
  pages: ESSILOR_HANDBOOK_PAGE_ENTRIES,
  resolveProduct: (name) => findEssilorProductMatrix(name),
  manifestApi: '/api/catalog/essilor-manifest/',
};

const HOYA_HANDBOOK_PAGE_ENTRIES: readonly HandbookPageEntry[] = HOYA_HANDBOOK_PAGE_MAP.map((e) => ({
  pdfPage: e.pdfPage,
  printedPage: e.printedPage,
  section: e.section as HandbookSection,
  productName: e.productName,
  title: e.title,
  imageUrl: e.imageUrl,
}));

const HOYA_ADAPTER: HandbookBrandAdapter = {
  brand: 'hoya',
  pages: HOYA_HANDBOOK_PAGE_ENTRIES,
  resolveProduct: (name) => findHoyaProductMatrix(name),
  manifestApi: '/api/catalog/hoya-manifest/',
  buildSeriesNavigation: buildHoyaSeriesNavigationItems,
};

/** 多品牌注册表：新增 Essilor/HOYA 时在此追加条目 */
export const HANDBOOK_BRAND_REGISTRY: Record<DigitalHandbookBrand, HandbookBrandAdapter | null> = {
  zeiss: ZEISS_ADAPTER,
  essilor: ESSILOR_ADAPTER,
  hoya: HOYA_ADAPTER,
};

export function getBrandAdapter(brand: DigitalHandbookBrand): HandbookBrandAdapter | null {
  return HANDBOOK_BRAND_REGISTRY[brand] ?? null;
}

/** 把印刷页数字/空 → 'P##' / null，UI 应一律使用本函数格式化 */
function toPrintedLabel(n: number | null | undefined): string | null {
  return typeof n === 'number' && Number.isFinite(n) ? `P${n}` : null;
}

/**
 * **MATRIX_PROTOCOL_V1** — 所有 UI/收银/搜索渲染手册页面信息时，**必须**通过本函数。
 * - 输入 1-based 物理页（pdfIndex）
 * - 输出 `HandbookPageData`，已归一化印刷页字符串与 dataAnchor
 * - 超界返回 null；调用侧应走「回退到纯图片模式」逻辑
 */
export function getPageData(
  pdfIndex: number,
  brand: DigitalHandbookBrand = 'zeiss',
): HandbookPageData | null {
  const adapter = getBrandAdapter(brand);
  if (!adapter) return null;
  const entry = adapter.pages.find((p) => p.pdfPage === pdfIndex);
  if (!entry) return null;
  const anchor = entry.productName?.trim() || null;
  let product = anchor ? adapter.resolveProduct(anchor) ?? null : null;
  const pb = product?.brand ? String(product.brand).toUpperCase() : '';
  if (product && brand === 'hoya' && pb && pb !== 'HOYA') {
    product = null;
  }
  if (product && brand === 'essilor' && pb && pb !== 'ESSILOR') {
    product = null;
  }
  if (product && brand === 'zeiss' && pb && pb !== 'ZEISS') {
    product = null;
  }
  const pageKey = String(entry.pdfPage);
  const pageImageMap =
    brand === 'essilor'
      ? ESSILOR_HANDBOOK_PAGE_IMAGE_DATA
      : brand === 'hoya'
        ? HOYA_HANDBOOK_PAGE_IMAGE_DATA
        : ZEISS_HANDBOOK_PAGE_IMAGE_DATA;
  const imageData = pageImageMap[pageKey] ?? product?.imageData ?? null;
  const embedded = imageData && imageData.length > 0 ? imageData : null;
  const fromEntry = entry.imageUrl?.trim();
  const publicUrl = fromEntry && fromEntry.length > 0 ? fromEntry : null;
  const isManualTrimmed = brand === 'hoya' && isHoyaManualTrimmedPdfPage(entry.pdfPage);
  /** 豪雅页图统一走 `hoyaHandbookPageMap` 的 `/catalog/hoya/pages/p{n}.jpg` */
  const imageUrl = publicUrl;
  let pageKind: HandbookPageKind = entry.pageKind ?? 'standard';
  if (pageKind === 'series_entry' && !entry.physicalTabVerified) {
    pageKind = 'standard';
  }
  const quickBase = entry.quickNavWeight ?? 1;
  const physicalTabVerified = Boolean(entry.physicalTabVerified);
  const physicalTabLabel = entry.physicalTabLabel?.trim() || null;
  const seriesAliasKey =
    pageKind === 'series_entry' && physicalTabVerified ? entry.seriesAliasKey?.trim() || null : null;
  let vOffsetPercent: number | null =
    typeof entry.vOffsetPercent === 'number' && Number.isFinite(entry.vOffsetPercent)
      ? entry.vOffsetPercent
      : null;
  if (vOffsetPercent == null && brand === 'hoya') {
    const v = HOYA_PHYSICAL_TAB_V_OFFSET_PERCENT_BY_PDF_PAGE[entry.pdfPage];
    if (typeof v === 'number' && Number.isFinite(v)) vOffsetPercent = v;
  }
  let hOffsetPercent: number | null =
    typeof entry.hOffsetPercent === 'number' && Number.isFinite(entry.hOffsetPercent)
      ? entry.hOffsetPercent
      : null;
  if (hOffsetPercent == null && brand === 'hoya') {
    const hx = HOYA_PHYSICAL_TAB_H_OFFSET_PERCENT_BY_PDF_PAGE[entry.pdfPage];
    if (typeof hx === 'number' && Number.isFinite(hx)) hOffsetPercent = hx;
  }
  const physicalAnchorPage =
    isManualTrimmed
      ? false
      : brand === 'hoya'
        ? isHoyaPhysicalAnchorPdfPage(entry.pdfPage)
        : brand === 'zeiss'
          ? pageKind === 'series_entry' && physicalTabVerified && Boolean(physicalTabLabel)
          : false;
  return {
    brand,
    pdfIndex: entry.pdfPage,
    printedLabel: toPrintedLabel(entry.printedPage),
    dataAnchor: anchor,
    section: entry.section,
    title:
      brand === 'hoya'
        ? (entry.title ?? '豪雅价目册')
        : entry.title ?? HANDBOOK_SECTION_NAV_LABEL[entry.section] ?? '',
    product,
    ocrRequired: Boolean(entry.ocrRequired),
    imageData: embedded,
    imageUrl,
    pageKind,
    physicalTabVerified,
    physicalTabLabel,
    seriesAliasKey,
    quickNavWeight: quickBase,
    vOffsetPercent,
    hOffsetPercent,
    physicalAnchorPage,
    isManualTrimmed: isManualTrimmed || undefined,
    anchorPreservationInsetPct: null,
  };
}

/** 批量版本：列出某品牌全部页（按 pdfIndex 升序）；UI 用它构建一次 map，避免在渲染循环里重算。 */
export function listPageData(
  brand: DigitalHandbookBrand = 'zeiss',
): HandbookPageData[] {
  const adapter = getBrandAdapter(brand);
  if (!adapter) return [];
  return adapter.pages
    .map((e) => getPageData(e.pdfPage, brand))
    .filter((x): x is HandbookPageData => x !== null)
    .sort((a, b) => a.pdfIndex - b.pdfIndex);
}

/** 合并 `/api/catalog/zeiss-manifest` 返回的图片清单 + 本映射。 */
export function mergeWithImageManifest(
  imageManifest: Array<{ pageIndex: number; imageUrl: string }>,
): Array<HandbookPageEntry & { imageUrl?: string }> {
  return ZEISS_HANDBOOK_PAGE_MAP.map((entry) => {
    const img = imageManifest.find((i) => i.pageIndex + 1 === entry.pdfPage);
    return { ...entry, imageUrl: img?.imageUrl };
  });
}

/**
 * 手册 `section` → 收银品种 <optgroup> 分组名（与「单光 / 渐进 / 青少年」等心智模型对齐）。
 * `price` 页上的具体产品线再用矩阵 `lensType` 细分（见 `matrixLensTypeGroupLabel`）。
 */
const CASHIER_SECTION_TO_OPTGROUP: Partial<Record<HandbookSection, string>> = {
  'myopia-control-intro': '青少年与近视管理',
  'single-vision-ladder': '单光',
  'pal-intro': '渐进 / 睐光',
  'driving-intro': '驾驶型',
  'outdoor-intro': '户外系列',
  'office-intro': '办公型',
  'anti-blue-light': '防蓝光',
  'coating': '膜层',
  'smartlife-series-opening': '智锐导读',
  'lens-series-overview': '镜片总览',
  'product-highlights': '重点推荐',
  'brand-matrix': '品牌矩阵',
  'cover-brand': '封面与品牌',
  'all-zeiss-frames-intro': '镜架',
  'services': '服务',
  'children-frames': '儿童镜架',
  'accessories': '配件与加工',
  'appendix': '附录',
};

/** 收银台品种下拉：按手册 section + 矩阵 lensType 推导 optgroup 标签 */
export function getCashierLensOptgroupLabelForProduct(product: ZeissProductMatrix): string {
  const name = product.productName.trim();
  const entry = ZEISS_HANDBOOK_PAGE_MAP.find((e) => e.productName === name);
  if (!entry) return matrixLensTypeGroupLabel(product);
  if (entry.section === 'price') return matrixLensTypeGroupLabel(product);
  return (
    CASHIER_SECTION_TO_OPTGROUP[entry.section] ??
    HANDBOOK_SECTION_NAV_LABEL[entry.section] ??
    matrixLensTypeGroupLabel(product)
  );
}

const CASHIER_OPTGROUP_SORT_PRIOR: string[] = [
  '封面与品牌',
  '品牌矩阵',
  '重点推荐',
  '镜片总览',
  '膜层',
  '防蓝光',
  '智锐导读',
  '青少年与近视管理',
  '单光',
  '渐进 / 睐光',
  '数码型',
  '驾驶型',
  '户外系列',
  '办公型',
  '镜架',
  '儿童镜架',
  '服务',
  '配件与加工',
  '附录',
  '其他',
];

/** 将价目矩阵子集按收银 optgroup 分组（供 <optgroup> 渲染） */
export function groupMatrixProductsForCashierSelect(
  products: readonly ZeissProductMatrix[],
): { label: string; items: ZeissProductMatrix[] }[] {
  const bucket = new Map<string, ZeissProductMatrix[]>();
  for (const p of products) {
    const g = getCashierLensOptgroupLabelForProduct(p);
    const arr = bucket.get(g) ?? [];
    arr.push(p);
    bucket.set(g, arr);
  }
  const keys = [...bucket.keys()].sort((a, b) => {
    const ia = CASHIER_OPTGROUP_SORT_PRIOR.indexOf(a);
    const ib = CASHIER_OPTGROUP_SORT_PRIOR.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
  return keys.map((label) => ({
    label,
    items: (bucket.get(label) ?? []).sort((x, y) =>
      x.productName.localeCompare(y.productName, 'zh-CN'),
    ),
  }));
}

/** 健壮性：确保映射表与价目矩阵不漂移（只用于开发时断言） */
export function assertMapConsistency(): string[] {
  const errors: string[] = [];
  const productNames = new Set(ZEISS_PRICE_MATRIX.map((p) => p.productName));
  for (const entry of ZEISS_HANDBOOK_PAGE_MAP) {
    if (entry.section === 'price' && entry.productName) {
      if (!productNames.has(entry.productName)) {
        errors.push(
          `pageMap pdfPage=${entry.pdfPage} 指向未知产品 "${entry.productName}"`,
        );
      }
    }
  }
  return errors;
}
