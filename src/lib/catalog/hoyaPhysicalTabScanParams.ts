/**
 * HOYA 豪雅手册 · 物理凸标扫描管线参数（StandardEye 预备）
 *
 * **`HOYA_PHYSICAL_PAGE_ANCHORS`**（本文件为**唯一字面量源**）：物理书签与翻页目标（**仅** `pdfPage` 等，
 * **禁止**手填 `top` / `vOffsetPercent`）；竖直位置由 `hoyaRailTopPercentForPdfPage`（`hoyaSeriesNav`）与
 * `ZeissSeriesNavList` 使用同一公式计算。
 *
 * **physicalTabLabel 规约**（与蔡司同）：须与锚点 `label` 一致——短名、1:1 实体印字。
 *
 * **全域雷达**：请使用 `scanHoyaPhysicalTabCandidatesFromImageData`（`hoya_global_color`：全图 + 橙/蓝/紫）；
 * 勿再依赖单一右缘裁切。
 */

/** 与 `hoyaHandbookPageCount.json` 总页数一致（价目/矩阵自检） */
export const HOYA_HANDBOOK_PHYSICAL_PAGE_TOTAL = 74 as const;

/**
 * 右页书签 `top%` 映射分母：与 `hoyaRailTopPercentForPdfPage` 一致 — `(pdfPage / DENOMINATOR) * 100 - OFFSET`。
 * 默认与实册页数 **74** 一致；若竖向间距过大（PDF 上下黑边留白），可单独改为 **80** 或 **85**。
 */
export const HOYA_RAIL_VERTICAL_DENOMINATOR = 74 as const;

/** 从 `(pdfPage/74)*100` 结果再减去的全局百分点（物理书签整体偏下时调大） */
export const HOYA_RAIL_VERTICAL_OFFSET_PCT = 5 as const;

/**
 * 豪雅手册 · 物理侧栏锚点（仅 `pdfPage` 1-based 翻页 + 色键；**无**死坐标 `top`）。
 */
export const HOYA_PHYSICAL_PAGE_ANCHORS = Object.freeze([
  {
    id: 'p:新乐学',
    label: '新乐学',
    pdfPage: 11,
    tabAccent: 'orange' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:新明锐',
    label: '新明锐',
    pdfPage: 15,
    tabAccent: 'blue' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:新纵横',
    label: '新纵横',
    pdfPage: 23,
    tabAccent: 'purple' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:手机镜',
    label: '手机镜',
    pdfPage: 39,
    tabAccent: 'neutral' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:新智悦',
    label: '新智悦',
    pdfPage: 43,
    tabAccent: 'orange' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:悦驾',
    label: '悦驾',
    pdfPage: 47,
    tabAccent: 'blue' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
  {
    id: 'p:优适',
    label: '优适',
    pdfPage: 50,
    tabAccent: 'purple' as const,
    section: 'price',
    kind: 'product' as const,
    isManualTrimmed: true,
  },
] as const);

export type HoyaPhysicalPageAnchor = (typeof HOYA_PHYSICAL_PAGE_ANCHORS)[number];

/** 与 `HOYA_PHYSICAL_PAGE_ANCHORS` 同序同引用；禁止再按 `seriesNavRail` 等条件过滤。 */
export const HOYA_PHYSICAL_TABS: readonly HoyaPhysicalPageAnchor[] = HOYA_PHYSICAL_PAGE_ANCHORS;

export type HoyaPhysicalTabColorKey = 'orange' | 'blue' | 'purple' | 'neutral';

/**
 * 与 `HOYA_PHYSICAL_PAGE_ANCHORS[].tabAccent` / 侧栏 `navTabTone` 一致：检测管线可用作 HSV 先验或后验分类键。
 * key = 菜单 `id`（如 `p:新乐学`）。
 */
export const HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID: Readonly<Record<string, HoyaPhysicalTabColorKey>> = Object.freeze(
  Object.fromEntries(HOYA_PHYSICAL_PAGE_ANCHORS.map((m) => [m.id, m.tabAccent as HoyaPhysicalTabColorKey])) as Record<
    string,
    HoyaPhysicalTabColorKey
  >,
);

/**
 * @deprecated 单一右缘带已不足以覆盖摺痕/内侧凸标；请改用 `perimeterBandRelativeCrop` 三带或
 *   `scanPhysicalTabCandidatesFromImageData`。
 */
export const HOYA_PHYSICAL_TAB_EDGE_REGION = {
  anchor: 'top-right' as const,
  widthPx: 240,
  heightPx: 520,
};

/** 形态学/轮廓：凸标近似圆角矩形时的圆角半径提示（相对短边 0–1） */
export const HOYA_PHYSICAL_TAB_SHAPE_HINT = {
  cornerRadiusNormMin: 0.04,
  cornerRadiusNormMax: 0.14,
  /** 默认期望（花哨版式可略提高） */
  cornerRadiusNormDefault: 0.08,
} as const;

/** @deprecated 请优先使用 `perimeterBandRelativeCrop('right', …)` 或全週邊扫描 */
export function hoyaTopRightTabStripAsRelativeCrop(imageWidthPx: number, imageHeightPx: number) {
  const w = Math.min(1, HOYA_PHYSICAL_TAB_EDGE_REGION.widthPx / Math.max(1, imageWidthPx));
  const h = Math.min(1, HOYA_PHYSICAL_TAB_EDGE_REGION.heightPx / Math.max(1, imageHeightPx));
  return { left: 1 - w, top: 0, width: w, height: h };
}

/**
 * 若未来在 `HOYA_PHYSICAL_PAGE_ANCHORS` 增加条目，请设 `tabAccent` 与实物色带一致。
 * 以保持与检测管线色先验一致。
 */

export {
  allPerimeterBandRelativeCrops,
  extractDynamicTabAnchorPercents,
  HOYA_TOP_RIGHT_QUADRANT_REL,
  hoyaSeriesEntryFromColorBlockOcr,
  isHoyaPhysicalTabColorPixel,
  matchHoyaSeriesFromColorBlockText,
  perimeterBandRelativeCrop,
  PHYSICAL_TAB_PERIMETER_BAND_REL,
  pickBestPhysicalTabScanCandidate,
  remapQuadrantCandidateToFullPage,
  scanHoyaPhysicalTabCandidatesFromImageData,
  scanHoyaTopRightQuadrantCandidates,
  scanPhysicalTabCandidatesFromImageData,
  scanZeissPhysicalTabCandidatesFromImageData,
  type HoyaSeriesAliasKey,
  type HoyaSeriesFuzzyMatch,
  type PerimeterBand,
  type PhysicalTabScanCandidate,
  type PhysicalTabScanPreset,
} from '@/lib/catalog/handbookPhysicalLabelScan';
