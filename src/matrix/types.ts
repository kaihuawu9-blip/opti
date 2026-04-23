/**
 * 类型与 matrix-intelligence-hub.json（单一事实来源）、dictionary.json 对齐。
 */

export type MatrixRulesMeta = {
  id: string;
  version: string;
  locale: string;
  description: string;
};

export type SteppedRange = {
  min: number;
  max: number;
  step: number;
};

/** 由 hub.validate 解析出的运行时校验配置（供 MatrixValidator 使用） */
export type MatrixValidateRuntimeConfig = {
  rx: {
    sphereDiopter: SteppedRange;
    cylinderDiopter: SteppedRange;
    axisDegrees: { min: number; max: number; integerOnly: boolean };
    axisRequiredWhenCylinderAbsGe: number;
    pdTotalMm: { min: number; max: number };
    monoPdMm: { min: number; max: number };
  };
  material: MatrixMaterialRules;
};

export type MatrixRxRules = MatrixValidateRuntimeConfig['rx'];

export type MaterialEnvelope = {
  symbol: string;
  nMin: number;
  nMax: number;
  abbeMin: number;
  abbeMax: number;
  note?: string;
};

export type MatrixMaterialRules = {
  envelopes: MaterialEnvelope[];
  globalSanity: { nMin: number; nMax: number; abbeMin: number; abbeMax: number };
};

/** 与旧版 matrixRules 导出兼容的扁平结构（由 hub 派生） */
export type MatrixRulesFile = {
  meta: MatrixRulesMeta;
  rx: MatrixRxRules;
  material: MatrixMaterialRules;
};

export type DictionaryMeta = {
  version: string;
  locale: string;
};

export type DictionaryEntry = {
  id: string;
  canonicalZh: string;
  canonicalEn?: string;
  synonyms: string[];
  category: string;
};

export type MatrixDictionaryFile = {
  meta: DictionaryMeta;
  entries: DictionaryEntry[];
};

export type ValidationIssue = {
  code: string;
  message: string;
  field?: string;
};

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

export type RxEyeInput = {
  sphere: number;
  cylinder: number;
  axis?: number | null;
};

export type BilateralRxInput = {
  right: RxEyeInput;
  left: RxEyeInput;
  pdTotalMm?: number | null;
  monoPdMmOd?: number | null;
  monoPdMmOs?: number | null;
};

/** hub 根类型（仅声明校验所需字段；其余用索引放宽） */
export type MatrixIntelligenceHubFile = {
  meta: {
    '@description'?: string;
    schema_id: string;
    schema_version: string;
    locale?: string;
    [key: string]: unknown;
  };
  validate: {
    '@description'?: string;
    geometric_optics: Record<string, unknown>;
    material_envelopes: Record<string, unknown>;
    [key: string]: unknown;
  };
  suggest?: Record<string, unknown>;
  [key: string]: unknown;
};
