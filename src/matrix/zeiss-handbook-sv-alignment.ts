/**
 * 蔡司 2026 手册 P24–P27 单光家族：物理页与价目矩阵主键的对应。
 * 依据 ai-data/zeiss_digital_handbook/_dump_p25_82.txt 与 2026_price_matrix.json
 * 中 PDF 页底码（P25 等）校验；P25 为「产品线矩阵」跨页，与收银台/百科联动时使用。
 */

import { getPageByPdfIndex } from '@/data/zeissHandbookPageMap';

/** 手册小标题 → 价目表 productName（与 zeissPriceMatrix 一致；null 为未建独立品项） */
export type ZeissSingleVisionLadderRow = {
  order: number;
  labelZh: string;
  productName: string | null;
};

/**
 * P25 起首屏上的产品线顺序（与页图自上而下/区块一致，防蓝光与经典单光在矩阵中并列为「新清锐」同族展示）。
 * order 3：手册称「防蓝光单光 / 经典」，价目上并入新清锐同表区。
 */
export const ZEISS_SV_LADDER_ROW_PRODUCTS: readonly ZeissSingleVisionLadderRow[] = [
  { order: 1, labelZh: '蔡司泽锐', productName: '泽锐单光' },
  { order: 2, labelZh: '新清锐单光', productName: '新清锐非球面' },
  { order: 3, labelZh: '防蓝光单光/经典', productName: '新清锐非球面' },
  { order: 4, labelZh: 'A系列2.0单光', productName: 'A系列时尚型单光' },
  { order: 5, labelZh: '入门单光/普通', productName: null },
] as const;

export type ZeissSingleVisionPageRole = 'p24-chapter' | 'p25-matrix' | 'p26-zr-pitch' | null;

/**
 * 给定 PDF 物理页（1-based），返回该页在单光家族梯中的角色及可对齐的价目主键行。
 * - pdf 33 = 印刷 P24：章节扉页，返回完整 ladder 供侧栏/百科预关联。
 * - pdf 34 = 印刷 P25：矩阵主视觉，需与价目行一一提示。
 * - pdf 35 = 印刷 P26：泽锐专题引导，仅锁定泽锐行。
 */
export function getZeissSingleVisionLadderForPdfPage(pdfPage: number): {
  printedPage: number | null;
  role: ZeissSingleVisionPageRole;
  priceMatrixRows: readonly ZeissSingleVisionLadderRow[];
} {
  const e = getPageByPdfIndex(pdfPage);
  if (!e || e.section !== 'single-vision-ladder') {
    return { printedPage: e?.printedPage ?? null, role: null, priceMatrixRows: [] };
  }
  if (pdfPage === 33) {
    return { printedPage: e.printedPage, role: 'p24-chapter', priceMatrixRows: ZEISS_SV_LADDER_ROW_PRODUCTS };
  }
  if (pdfPage === 34) {
    return { printedPage: e.printedPage, role: 'p25-matrix', priceMatrixRows: ZEISS_SV_LADDER_ROW_PRODUCTS };
  }
  if (pdfPage === 35) {
    return {
      printedPage: e.printedPage,
      role: 'p26-zr-pitch',
      priceMatrixRows: ZEISS_SV_LADDER_ROW_PRODUCTS.filter((r) => r.order === 1),
    };
  }
  return { printedPage: e.printedPage, role: null, priceMatrixRows: [] };
}

/**
 * 是否落在「单光视觉梯」P24–P26（与印刷页码 24–26 一致，便于按 P## 反查）。
 */
export function isZeissSingleVisionLadderPdfPage(pdfPage: number): boolean {
  return pdfPage >= 33 && pdfPage <= 35;
}
