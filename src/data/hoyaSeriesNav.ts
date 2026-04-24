/**
 * 豪雅手册（74P）· 物理凸标与导航数据
 *
 * - **`HOYA_PHYSICAL_PAGE_ANCHORS`**：字面量源在 `@/lib/catalog/hoyaPhysicalTabScanParams`；此处再导出以兼容既有 import。
 * - **`HOYA_PHYSICAL_TABS`**：与锚点全量一致；**禁止**按 `seriesNavRail` 等字段过滤渲染（右页书签由父级按 spread 控制显隐）。
 */

import type { HandbookNavTabTone, HandbookSection, HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import {
  HOYA_HANDBOOK_PHYSICAL_PAGE_TOTAL,
  HOYA_PHYSICAL_PAGE_ANCHORS,
  HOYA_PHYSICAL_TABS,
  HOYA_RAIL_VERTICAL_DENOMINATOR,
  HOYA_RAIL_VERTICAL_OFFSET_PCT,
  type HoyaPhysicalPageAnchor,
} from '@/lib/catalog/hoyaPhysicalTabScanParams';

export {
  HOYA_HANDBOOK_PHYSICAL_PAGE_TOTAL,
  HOYA_PHYSICAL_PAGE_ANCHORS,
  HOYA_PHYSICAL_TABS,
  HOYA_RAIL_VERTICAL_DENOMINATOR,
  HOYA_RAIL_VERTICAL_OFFSET_PCT,
  type HoyaPhysicalPageAnchor,
};

/**
 * 豪雅右页书签 / 热区共用的竖直百分比（与 `ZeissSeriesNavList` 必须一致）。
 * `top` CSS：`${hoyaRailTopPercentForPdfPage(pdfPage)}%`，顶边对齐、无 translateY。
 */
export function hoyaRailTopPercentForPdfPage(pdfPage1Based: number): number {
  return (
    (pdfPage1Based / HOYA_RAIL_VERTICAL_DENOMINATOR) * 100 -
    HOYA_RAIL_VERTICAL_OFFSET_PCT
  );
}

export const HOYA_TAB_MAP = {
  orange: 'hoya-orange',
  blue: 'hoya-blue',
  purple: 'hoya-purple',
  neutral: 'neutral',
} as const satisfies Record<string, HandbookNavTabTone>;

export type HoyaTabAccent = keyof typeof HOYA_TAB_MAP;

/** @deprecated 使用 {@link HoyaPhysicalPageAnchor}；保留别名以免破坏既有类型引用 */
export type HoyaPhysicalTabDefinition = HoyaPhysicalPageAnchor;

function hoyaAnchorHOffset(m: HoyaPhysicalPageAnchor): number | undefined {
  return 'hOffsetPercent' in m ? (m as { hOffsetPercent: number }).hOffsetPercent : undefined;
}

/** 兼容脚本 / OCR：全锚点表，字段形态与旧 `HOYA_SERIES_MENU` 一致 */
export const HOYA_SERIES_MENU = Object.freeze(
  HOYA_PHYSICAL_PAGE_ANCHORS.map((t) => ({
    kind: t.kind,
    id: t.id,
    pdfPage: t.pdfPage,
    section: t.section as HandbookSection,
    tabAccent: t.tabAccent as HoyaTabAccent,
    isManualTrimmed: t.isManualTrimmed === true ? true : undefined,
    physicalTabVerified: true as const,
    physicalTabLabel: t.label,
    vOffsetPercent: hoyaRailTopPercentForPdfPage(t.pdfPage),
    hOffsetPercent: hoyaAnchorHOffset(t),
  })),
);

/** Boss 精修图页（1-based）；与当前物理锚点 `pdfPage` 一致 */
export const HOYA_MANUAL_TRIMMED_PDF_PAGES: ReadonlySet<number> = new Set(
  HOYA_PHYSICAL_PAGE_ANCHORS.map((m) => m.pdfPage),
);

export function isHoyaManualTrimmedPdfPage(pdfPage1Based: number): boolean {
  return HOYA_MANUAL_TRIMMED_PDF_PAGES.has(pdfPage1Based);
}

export const HOYA_PHYSICAL_TAB_V_OFFSET_PERCENT_BY_PDF_PAGE: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(HOYA_PHYSICAL_PAGE_ANCHORS.map((m) => [m.pdfPage, hoyaRailTopPercentForPdfPage(m.pdfPage)])),
);

export const HOYA_PHYSICAL_TAB_H_OFFSET_PERCENT_BY_PDF_PAGE: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(
    HOYA_PHYSICAL_PAGE_ANCHORS.flatMap((m) => {
      const h = hoyaAnchorHOffset(m);
      return typeof h === 'number' && Number.isFinite(h) ? [[m.pdfPage, h] as [number, number]] : [];
    }),
  ),
);

export function isHoyaPhysicalAnchorPdfPage(pdfPage1Based: number): boolean {
  return HOYA_PHYSICAL_PAGE_ANCHORS.some((m) => m.pdfPage === pdfPage1Based);
}

/** 手册 UI：豪雅物理书签数据 = 全量 `HOYA_PHYSICAL_PAGE_ANCHORS`（右页由 `ZeissDigitalHandbook` 决定是否挂载） */
export function buildHoyaSeriesNavigationItems(): HandbookSeriesNavItem[] {
  return HOYA_PHYSICAL_TABS.map((m) => ({
    id: m.id,
    label: m.label,
    physicalTabVerified: true,
    physicalTabLabel: m.label,
    vOffsetPercent: hoyaRailTopPercentForPdfPage(m.pdfPage),
    hOffsetPercent: hoyaAnchorHOffset(m),
    section: m.section as HandbookSection,
    startPage0: m.pdfPage - 1,
    printedPage: null,
    navTabTone: HOYA_TAB_MAP[m.tabAccent as HoyaTabAccent],
    isManualTrimmed: m.isManualTrimmed === true ? true : undefined,
  })).sort((a, b) => a.startPage0 - b.startPage0);
}
