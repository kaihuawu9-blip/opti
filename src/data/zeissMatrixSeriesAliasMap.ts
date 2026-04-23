/**
 * 系列/俗称 → 与矩阵 `productName` 子串匹配规则。
 * 用户搜索不在核心矩阵字面名中时，先走别名扩展，避免直接「无结果」。
 */
export type ZeissMatrixSearchAliasRule = {
  /** 触发别名匹配的搜索词（小写比较） */
  aliases: readonly string[];
  /** 命中别名后，用这些子串去匹配 `productName`（任一包含即保留） */
  productNameIncludes: readonly string[];
};

export const ZEISS_MATRIX_SEARCH_ALIAS_RULES: readonly ZeissMatrixSearchAliasRule[] = Object.freeze([
  {
    aliases: ['a系列', 'a 系列', '时尚型', '时尚型单光'],
    productNameIncludes: ['A 系列', '时尚型'],
  },
  {
    aliases: ['驾驶', '驾驶型', 'drive'],
    productNameIncludes: ['驾驶'],
  },
  {
    aliases: ['办公', '办公型', 'office'],
    productNameIncludes: ['办公'],
  },
  {
    aliases: ['户外', '户外型'],
    productNameIncludes: ['户外'],
  },
  {
    aliases: ['防蓝光', '蓝光', 'bp'],
    productNameIncludes: ['防蓝光', '钻立方防蓝光'],
  },
  {
    aliases: ['小乐圆', 'care', '近视管理'],
    productNameIncludes: ['小乐圆', '成长怡'],
  },
  {
    aliases: ['睐光', '轻渐进', '渐进'],
    productNameIncludes: ['睐光'],
  },
  {
    aliases: ['泽锐'],
    productNameIncludes: ['泽锐'],
  },
  {
    aliases: ['智锐'],
    productNameIncludes: ['智锐'],
  },
  {
    aliases: ['新清锐', '清锐'],
    productNameIncludes: ['新清锐'],
  },
]);
