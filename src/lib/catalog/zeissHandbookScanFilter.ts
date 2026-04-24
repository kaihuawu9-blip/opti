/**
 * 蔡司电子手册 · 视觉/OCR 扫描过滤（MATRIX_PROTOCOL_V1 补充）
 *
 * 命中时：价目矩阵挂载应保留物理页上下文，不因标题/OCR 噪声做 L2 校准跳转
 *（见 `shouldApplyMatrixPdfFromCalibration`）。
 *
 * `fingerprint.invalidKeywords` 仅作规约元数据；勿单独用作硬过滤，以免误判价目页。
 */

export const ZEISS_HANDBOOK_VISUAL_SCAN_RULES = {
  brand: 'ZEISS' as const,
  fingerprint: {
    logo: 'ZEISS_Blue_Square',
    style: 'Minimalist / High-res Photography',
    invalidKeywords: ['成立180周年', '历史', '愿景', '解决方案提供者'] as const,
  },
} as const;

export type ZeissHandbookScanFilterAction = 'SKIP_DATA_MOUNT';

export type ZeissHandbookScanFilterHit = {
  action: ZeissHandbookScanFilterAction;
  pageType: 'BRAND_PROMO';
  displayLabel: string;
};

/**
 * 合并 `pageTitle` + `ocrTextSnippet` 等软文本后调用。
 * 仅强信号（周年叙事 + 品牌名）触发，避免误伤正常价目页。
 */
export function assessZeissHandbookScanFilter(combinedOcrOrTitleText: string): ZeissHandbookScanFilterHit | null {
  const t = combinedOcrOrTitleText.trim();
  if (!t) return null;
  if (t.includes('1846') && t.includes('蔡司')) {
    return {
      action: 'SKIP_DATA_MOUNT',
      pageType: 'BRAND_PROMO',
      displayLabel: '品牌宣傳頁',
    };
  }
  return null;
}
