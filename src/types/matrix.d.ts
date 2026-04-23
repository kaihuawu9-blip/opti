/**
 * Matrix Protocol V1 — 系列「视觉指纹」规约
 *
 * 用于 3D 手册在印刷页偏移、插页时，仍以语义身份锁定系列，
 * 禁止仅依赖物理 `pdfIndex` 作为唯一真源；`pdfIndex` 为次要参考。
 *
 * @see ai-data/zeiss_digital_handbook/2026_price_matrix.json（价目落库）
 * @see src/data/zeissHandbookPageMap.ts（物理页 ↔ dataAnchor）
 */

/** 单条系列 / 价目条目的身份与指纹（可嵌入矩阵 JSON 或独立索引表） */
export interface LensSeriesData {
  /** 唯一 ID，如 ZEISS_A_2_0_PROG */
  seriesId: string;
  /** 手册标注页码，如 P26（印刷页标签，便于人工核对） */
  printedLabel: string;
  /**
   * 核心指纹：只要页面文本、资源路径或 OCR 结果包含以下关键词之一，
   * 即应优先锁定本系列（与 IndexAutoCalibrator 配合），而非盲跟页码。
   */
  fingerprints: string[];
  /** 物理页码（1-based），作为次要参考；偏移时由指纹纠偏 */
  pdfIndex: number;
}
