/**
 * 依视路 · Matrix Protocol V1 占位（预研）
 *
 * 与蔡司 `ReactPageFlipProps` / `IndexAutoCalibrator` 解耦；此处仅定义
 * **折射率槽位别名** 命名空间，验证多品牌下与蔡司 `ZeissRefractiveIndex` 枚举对齐策略。
 *
 * 接入步骤（后续）：`HANDBOOK_BRAND_REGISTRY` + `essilorHandbookPageMap` + 价目 JSON。
 */

/** 依视路常用标称折射率（字符串键，与 ERP 导入一致） */
export type EssilorIndexLabel = '1.50' | '1.56' | '1.59' | '1.60' | '1.67' | '1.74';

/**
 * 与蔡司矩阵交叉表「列」对齐的别名映射（非生物数据，仅协议占位）。
 * 蔡司侧见 `ZeissRefractiveIndex`（`src/data/zeissPriceMatrix.ts`）。
 * 使用 const 聚合对象代替 `namespace`，以满足 eslint；语义上等价于 AliasMap 命名空间。
 */
export const EssilorAliasMap = {
  /** 依视路标称 → 蔡司矩阵兼容槽（用于统一 UI 列宽 / 价目网格 key） */
  refractiveIndexToMatrixSlot: {
    '1.50': '1.5',
    '1.56': '1.56',
    '1.59': '1.59',
    '1.60': '1.6',
    '1.67': '1.67',
    '1.74': '1.74',
  } as const satisfies Readonly<Record<EssilorIndexLabel, string>>,

  /** 反向：从统一槽位解析依视路展示标签（可选） */
  matrixSlotToPreferredLabel: {
    '1.5': '1.50',
    '1.56': '1.56',
    '1.59': '1.59',
    '1.6': '1.60',
    '1.67': '1.67',
    '1.74': '1.74',
  } as const satisfies Readonly<Record<string, EssilorIndexLabel>>,
} as const;

export const ESSILOR_MATRIX_PROTOCOL_STUB_VERSION = '0.0.0-stub';

/** 与 `ZeissRefractiveIndex` 数值序列一致（字符串键，供交叉表对齐校验） */
const ZEISS_MATRIX_SLOT_STRINGS = ['1.5', '1.56', '1.59', '1.6', '1.67', '1.74'] as const;

/**
 * 运行时/测试断言：`EssilorAliasMap` 的槽位值必须落在蔡司矩阵折射率集合内。
 * @throws 若映射越界（CI / vitest 可调用）
 */
export function assertEssilorAliasMapsZeissSlots(): void {
  for (const [label, slot] of Object.entries(EssilorAliasMap.refractiveIndexToMatrixSlot)) {
    if (!ZEISS_MATRIX_SLOT_STRINGS.includes(slot as (typeof ZEISS_MATRIX_SLOT_STRINGS)[number])) {
      throw new Error(`EssilorAliasMap 与蔡司槽位不兼容: ${label} → ${slot}`);
    }
  }
}
