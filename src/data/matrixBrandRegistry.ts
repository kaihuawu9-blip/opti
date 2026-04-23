/**
 * Matrix Self-Check：登记 `src/data/` 下参与价目矩阵的品牌模块，
 * 启动时按此列表扫描（避免在运行时 fs 扫盘）。
 */
export type MatrixBrandRegistryEntry = {
  /** 与 ZeissProductMatrix.brand / matrixProductBrandKey 对齐 */
  brandKey: string;
  /** 人类可读名（日志用） */
  label: string;
  /** 相对 repo 的说明性路径（仅文档/自检日志，不参与 import） */
  handbookPageMapFile: string;
  priceMatrixJsonFile: string;
};

export const MATRIX_BRAND_REGISTRY: readonly MatrixBrandRegistryEntry[] = Object.freeze([
  {
    brandKey: 'ZEISS',
    label: '蔡司',
    handbookPageMapFile: 'src/data/zeissHandbookPageMap.ts',
    priceMatrixJsonFile: 'ai-data/zeiss_digital_handbook/2026_price_matrix.json',
  },
  {
    brandKey: 'ESSILOR',
    label: '依视路',
    handbookPageMapFile: 'src/data/essilorHandbookPageMap.ts',
    /** 占位 JSON：自检仅登记路径，不强制解析为空文件 */
    priceMatrixJsonFile: 'ai-data/essilor_handbook/price_matrix.stub.json',
  },
]);
