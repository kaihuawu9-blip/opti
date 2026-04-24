/**
 * 豪雅侧栏系列导航（Matrix V1.3 · 品牌隔离 + 语义化）
 *
 * 每项 `pdfPage` 为实体凸起所在 PDF 页。侧栏印字 **仅** `physicalTabLabel`（1:1 凸标短名，禁止页码区间、括号英文、营销长句）。
 * `tabAccent` → 凸标色带（与 `hoyaPhysicalTabScanParams` 一致）。
 */

import type { HandbookNavTabTone, HandbookSection, HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';

const HOYA_TAB_MAP = {
  orange: 'hoya-orange',
  blue: 'hoya-blue',
  purple: 'hoya-purple',
} as const satisfies Record<string, HandbookNavTabTone>;

type HoyaTabAccent = keyof typeof HOYA_TAB_MAP;

type HoyaSeriesMenuRow = {
  kind: 'section' | 'product';
  id: string;
  pdfPage: number;
  section: HandbookSection;
  tabAccent: HoyaTabAccent;
  /** 人工对图确认后方可为 true */
  physicalTabVerified: true;
  /** 与实体凸标印字一致（短名） */
  physicalTabLabel: string;
};

/** 与侧栏 `startPage0`（0-based）同步；`physicalTabLabel` 须与实物凸标一致 */
export const HOYA_SERIES_MENU = Object.freeze([
  {
    kind: 'section',
    id: 's:hoya-intro',
    pdfPage: 1,
    section: 'myopia-control-intro',
    tabAccent: 'orange',
    physicalTabVerified: true,
    physicalTabLabel: '豪雅',
  },
  {
    kind: 'product',
    id: 'p:新乐学',
    pdfPage: 8,
    section: 'price',
    tabAccent: 'orange',
    physicalTabVerified: true,
    physicalTabLabel: '新乐学',
  },
  {
    kind: 'product',
    id: 'p:Eyvia单光',
    pdfPage: 12,
    section: 'price',
    tabAccent: 'blue',
    physicalTabVerified: true,
    physicalTabLabel: 'Eyvia',
  },
  {
    kind: 'product',
    id: 'p:Eynoa单光',
    pdfPage: 16,
    section: 'price',
    tabAccent: 'orange',
    physicalTabVerified: true,
    physicalTabLabel: 'Eynoa',
  },
  {
    kind: 'product',
    id: 'p:Eyas2单光',
    pdfPage: 20,
    section: 'price',
    tabAccent: 'blue',
    physicalTabVerified: true,
    physicalTabLabel: 'Eyas2',
  },
  {
    kind: 'product',
    id: 'p:豪雅智御中近',
    pdfPage: 27,
    section: 'price',
    tabAccent: 'purple',
    physicalTabVerified: true,
    physicalTabLabel: '智御',
  },
  {
    kind: 'section',
    id: 's:hoya-coating',
    pdfPage: 34,
    section: 'coating',
    tabAccent: 'blue',
    physicalTabVerified: true,
    physicalTabLabel: '膜层',
  },
  {
    kind: 'section',
    id: 's:hoya-lifestyle',
    pdfPage: 42,
    section: 'driving-intro',
    tabAccent: 'orange',
    physicalTabVerified: true,
    physicalTabLabel: '场景',
  },
] as const satisfies readonly HoyaSeriesMenuRow[]);

export function buildHoyaSeriesNavigationItems(): HandbookSeriesNavItem[] {
  return HOYA_SERIES_MENU.filter((m) => m.physicalTabVerified).map((m) => ({
    id: m.id,
    label: m.physicalTabLabel,
    physicalTabVerified: true,
    physicalTabLabel: m.physicalTabLabel,
    section: m.section,
    startPage0: m.pdfPage - 1,
    printedPage: null,
    navTabTone: HOYA_TAB_MAP[m.tabAccent],
  })).sort((a, b) => a.startPage0 - b.startPage0);
}
