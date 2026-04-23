/**
 * Matrix Protocol V1 — 压力测试与人工验收用「逻辑样本」
 *
 * 不修改生产 `ZEISS_HANDBOOK_PAGE_MAP` / JSON；供 `scripts/matrix-protocol-smoke.ts`
 * 或 Storybook / 单测引用，验证插件 A（文件名指纹）与 L2 标题预设。
 *
 * @see src/lib/catalog/indexAutoCalibrator.ts — FILENAME_STRONG_SLUG_RULES / TITLE_SEMANTIC_PRESETS
 */

/** manifest / 磁盘 basename 示例 → 期望锁定的矩阵 productName（L1 slug） */
export const STRESS_FILENAME_CALIBRATION_SAMPLES: readonly {
  id: string;
  /** 含 `A-Prog` 等指纹的 URL 末段 */
  assetFilename: string;
  /** 物理页（与 manifest 槽位一致时可任意，slug 命中时无视页码） */
  pdfIndex1Based: number;
  expectedProductName: string;
}[] = [
  {
    id: 'a-prog-slug',
    assetFilename: '/catalog/zeiss-handbook/pages/P040_A-Prog-handbook-test.jpg',
    pdfIndex1Based: 40,
    expectedProductName: '睐光2.0 D渐进',
  },
  {
    id: 'aseriesprogressive',
    assetFilename: 'ZEISS-A-Series-Progressive-cover.jpg',
    pdfIndex1Based: 26,
    expectedProductName: '睐光2.0 D渐进',
  },
];

/** 仅标题 / OCR（无文件名语义）→ L2 预设 */
export const STRESS_TITLE_PRESET_SAMPLES: readonly {
  id: string;
  pageTitle: string;
  expectedProductContains: string;
}[] = [
  { id: 'zhenrui-title', pageTitle: '臻锐臻选介绍页', expectedProductContains: '智锐臻选版单光' },
  { id: 'a-series-pal-title', pageTitle: 'A 系列渐进 价目引导', expectedProductContains: '睐光2.0 D渐进' },
];
