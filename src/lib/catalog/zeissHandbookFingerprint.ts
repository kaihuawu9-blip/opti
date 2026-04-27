/**
 * StandardEye 4.0 · The Fingerprint Generator（语义缝合）
 *
 * 物理主权保证：全屏双图已「暴力撞边」，左页 [0, 50%) 右页 [50%, 100%)，
 * 中缝焊死在视口 50% 中轴。因此：
 *
 *   screenRelX = clientX / layoutVW  ← 跨幅几何的唯一真值，无需任何 px 修正
 *   screenRelY = clientY / layoutVH
 *
 * 调用方只需采集 `(clientX / window.innerWidth, clientY / window.innerHeight)`
 * 并直接输入本函数，即可自动生成 [系列 + 折射率 + 膜层] 指纹并驱动收银台。
 *
 * **注意**：纵向区间与矩阵键映射为可迭代占位，后续按真实价目版式调参。
 */

import type { ZeissHandbookMapId } from '@/data/zeissHandbookQuickMap';

export type ZeissHandbookFingerprintParts = {
  /** 展示用整句（如收银检索框、日志） */
  fingerprint: string;
  /** 与 `ZEISS_PRICE_MATRIX` 中 `productName` 一致的可选值 */
  seriesMatrixKey: string;
  /** 展示用系列名（指纹句内文案） */
  seriesDisplay: string;
  /** 折射率文案，如 1.50 / 1.60 / 1.67 */
  refractive: string;
  /** 膜层展示名偏好（「铂金」系，矩阵中可能为「钻立方铂金膜」等） */
  coatingHint: string;
};

/** 右半区指纹文案用「智锐数码」；矩阵键须用价目中已登记的产品名 */
const DIGITAL_SERIES_MATRIX_KEY = '智锐数码型亚洲版';

/**
 * 根据物理层归一化坐标生成蔡司指纹。
 *
 * @param screenRelX  `clientX / layoutVW`（0–1，跨幅横向；< 0.5 为左页，≥ 0.5 为右页）
 * @param screenRelY  `clientY / layoutVH`（0–1，纵向）
 * @param activeMapId 当前快捷图激活 ID（用于精确映射，可为 null）
 */
export function generateZeissHandbookFingerprint(
  screenRelX: number,
  screenRelY: number,
  activeMapId: ZeissHandbookMapId | null,
): ZeissHandbookFingerprintParts {
  void activeMapId;

  // 物理层撞边后，screenRelX < 0.5 ↔ 左页，>= 0.5 ↔ 右页
  const seriesDisplay = screenRelX < 0.5 ? '智锐单光' : '智锐数码';
  const seriesMatrixKey = screenRelX < 0.5 ? '智锐单光' : DIGITAL_SERIES_MATRIX_KEY;

  let refractive = '1.50';
  if (screenRelY > 0.2 && screenRelY < 0.4) refractive = '1.60';
  if (screenRelY > 0.4 && screenRelY < 0.6) refractive = '1.67';

  const coatingHint = '铂金膜';
  const fingerprint = `蔡司 ${seriesDisplay} ${refractive} ${coatingHint}`;

  return {
    fingerprint,
    seriesMatrixKey,
    seriesDisplay,
    refractive,
    coatingHint,
  };
}

/** 矩阵行常用 index 字段与价目 UI 字符串对齐 */
export function zeissRefractiveLabelToIndexStr(label: string): string {
  if (label === '1.50') return '1.5';
  if (label === '1.60') return '1.6';
  if (label === '1.67') return '1.67';
  return '1.5';
}
