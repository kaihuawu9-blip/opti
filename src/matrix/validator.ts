import dictionaryJson from './dictionary.json';
import hubJson from './matrix-intelligence-hub.json';
import type {
  BilateralRxInput,
  MatrixDictionaryFile,
  MatrixIntelligenceHubFile,
  MatrixMaterialRules,
  MatrixRulesFile,
  MatrixValidateRuntimeConfig,
  MaterialEnvelope,
  ValidationIssue,
  ValidationResult,
} from './types';

const EPS = 1e-6;

function nearMultipleOf(value: number, step: number): boolean {
  if (step <= 0) return true;
  const q = value / step;
  return Math.abs(q - Math.round(q)) < EPS;
}

function push(issues: ValidationIssue[], issue: ValidationIssue) {
  issues.push(issue);
}

function readSteppedRange(obj: Record<string, unknown>, key: string): { min: number; max: number; step: number } {
  const o = obj[key];
  if (!o || typeof o !== 'object') throw new Error(`matrix hub: missing or invalid ${key}`);
  const r = o as Record<string, unknown>;
  return {
    min: Number(r.min),
    max: Number(r.max),
    step: Number(r.step),
  };
}

function readMmRange(obj: Record<string, unknown>, key: string): { min: number; max: number } {
  const o = obj[key];
  if (!o || typeof o !== 'object') throw new Error(`matrix hub: missing or invalid ${key}`);
  const r = o as Record<string, unknown>;
  return { min: Number(r.min), max: Number(r.max) };
}

/**
 * 从 matrix-intelligence-hub.json 的 validate 层提取几何光学 + 材料包络，供运行时校验。
 * 单一事实来源：GB/ISO 容差等只需改 hub JSON。
 */
export function extractValidateRuntimeConfig(hub: MatrixIntelligenceHubFile): MatrixValidateRuntimeConfig {
  const g = hub.validate?.geometric_optics as Record<string, unknown> | undefined;
  const m = hub.validate?.material_envelopes as Record<string, unknown> | undefined;
  if (!g) throw new Error('matrix-intelligence-hub.json: validate.geometric_optics missing');
  if (!m) throw new Error('matrix-intelligence-hub.json: validate.material_envelopes missing');

  const sph = readSteppedRange(g, 'sphere_diopter_range');
  const cyl = readSteppedRange(g, 'cylinder_diopter_range_negative_form');
  const axis = g.axis_degrees as Record<string, unknown> | undefined;
  if (!axis) throw new Error('matrix hub: axis_degrees missing');

  const pdTotal = readMmRange(g, 'pd_total_mm');
  const monoPd = readMmRange(g, 'mono_pd_mm');

  const rawEnvelopes = m.envelopes;
  if (!Array.isArray(rawEnvelopes)) throw new Error('matrix hub: material_envelopes.envelopes must be array');

  const envelopes: MaterialEnvelope[] = rawEnvelopes.map((row, i) => {
    const e = row as Record<string, unknown>;
    if (typeof e.symbol !== 'string') throw new Error(`matrix hub: envelope[${i}].symbol invalid`);
    return {
      symbol: e.symbol,
      nMin: Number(e.n_min),
      nMax: Number(e.n_max),
      abbeMin: Number(e.abbe_min),
      abbeMax: Number(e.abbe_max),
      note: typeof e.note === 'string' ? e.note : undefined,
    };
  });

  const gs = m.global_sanity as Record<string, unknown> | undefined;
  if (!gs) throw new Error('matrix hub: global_sanity missing');

  const material: MatrixMaterialRules = {
    envelopes,
    globalSanity: {
      nMin: Number(gs.n_min),
      nMax: Number(gs.n_max),
      abbeMin: Number(gs.abbe_min),
      abbeMax: Number(gs.abbe_max),
    },
  };

  return {
    rx: {
      sphereDiopter: sph,
      cylinderDiopter: cyl,
      axisDegrees: {
        min: Number(axis.min),
        max: Number(axis.max),
        integerOnly: Boolean(axis.integer_only),
      },
      axisRequiredWhenCylinderAbsGe: Number(axis.required_when_abs_cyl_ge_d),
      pdTotalMm: pdTotal,
      monoPdMm: monoPd,
    },
    material,
  };
}

function hubMetaToRulesMeta(hub: MatrixIntelligenceHubFile): MatrixRulesFile['meta'] {
  const meta = hub.meta;
  const desc = typeof meta['@description'] === 'string' ? meta['@description'] : '';
  return {
    id: meta.schema_id,
    version: meta.schema_version,
    locale: typeof meta.locale === 'string' ? meta.locale : 'zh-CN',
    description: desc,
  };
}

/**
 * 配置驱动校验器：初始化时从 hub 的 validate 层解析规则。
 * 可 `new MatrixValidator(customHub)` 做单测；默认实例使用仓库内嵌的 matrix-intelligence-hub.json。
 */
export class MatrixValidator {
  readonly hub: MatrixIntelligenceHubFile;
  readonly config: MatrixValidateRuntimeConfig;

  constructor(hub: MatrixIntelligenceHubFile) {
    this.hub = hub;
    this.config = extractValidateRuntimeConfig(hub);
  }

  /** 球镜 D：范围 + 步进 */
  validateSphereDiopter(sph: number): ValidationResult {
    const r = this.config.rx.sphereDiopter;
    const issues: ValidationIssue[] = [];
    if (Number.isNaN(sph) || !Number.isFinite(sph)) {
      push(issues, { code: 'SPH_NAN', message: '球镜必须为有效数字', field: 'sphere' });
      return { ok: false, issues };
    }
    if (sph < r.min - EPS || sph > r.max + EPS) {
      push(issues, {
        code: 'SPH_RANGE',
        message: `球镜应在 ${r.min}D ~ ${r.max}D 之间`,
        field: 'sphere',
      });
    }
    if (!nearMultipleOf(sph, r.step)) {
      push(issues, {
        code: 'SPH_STEP',
        message: `球镜须按 ${r.step}D 步进`,
        field: 'sphere',
      });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  /** 柱镜 D：负柱惯例，范围 + 步进 */
  validateCylinderDiopter(cyl: number): ValidationResult {
    const r = this.config.rx.cylinderDiopter;
    const issues: ValidationIssue[] = [];
    if (Number.isNaN(cyl) || !Number.isFinite(cyl)) {
      push(issues, { code: 'CYL_NAN', message: '柱镜必须为有效数字', field: 'cylinder' });
      return { ok: false, issues };
    }
    if (cyl > EPS || cyl < r.min - EPS) {
      push(issues, {
        code: 'CYL_RANGE',
        message: `柱镜（负柱惯例）应在 ${r.min}D ~ ${r.max}D 之间`,
        field: 'cylinder',
      });
    }
    if (Math.abs(cyl) >= r.step - EPS && !nearMultipleOf(cyl, r.step)) {
      push(issues, {
        code: 'CYL_STEP',
        message: `柱镜须按 ${r.step}D 步进`,
        field: 'cylinder',
      });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  /** 轴位；|柱镜| 达到阈值时轴位必填且为整数 */
  validateAxisDegrees(axis: number | null | undefined, cylinderDiopter: number): ValidationResult {
    const a = this.config.rx.axisDegrees;
    const thr = this.config.rx.axisRequiredWhenCylinderAbsGe;
    const issues: ValidationIssue[] = [];
    const cylAbs = Math.abs(cylinderDiopter ?? 0);
    const needAxis = cylAbs >= thr - EPS;

    if (!needAxis) {
      return { ok: true };
    }

    if (axis == null || Number.isNaN(axis)) {
      push(issues, { code: 'AXIS_REQUIRED', message: '存在散光时必须填写轴位', field: 'axis' });
      return { ok: false, issues };
    }

    if (!Number.isFinite(axis)) {
      push(issues, { code: 'AXIS_NAN', message: '轴位必须为有效数字', field: 'axis' });
      return { ok: false, issues };
    }

    if (axis < a.min - EPS || axis > a.max + EPS) {
      push(issues, {
        code: 'AXIS_RANGE',
        message: `轴位应在 ${a.min}° ~ ${a.max}° 之间`,
        field: 'axis',
      });
    }

    if (a.integerOnly && Math.abs(axis - Math.round(axis)) > EPS) {
      push(issues, { code: 'AXIS_INTEGER', message: '轴位须为整数度', field: 'axis' });
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  validatePdTotalMm(pd: number): ValidationResult {
    const r = this.config.rx.pdTotalMm;
    const issues: ValidationIssue[] = [];
    if (Number.isNaN(pd) || !Number.isFinite(pd)) {
      push(issues, { code: 'PD_NAN', message: '瞳距必须为有效数字', field: 'pdTotal' });
      return { ok: false, issues };
    }
    if (pd < r.min - EPS || pd > r.max + EPS) {
      push(issues, {
        code: 'PD_RANGE',
        message: `合计瞳距应在 ${r.min}mm ~ ${r.max}mm 之间`,
        field: 'pdTotal',
      });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  validateMonoPdMm(pd: number): ValidationResult {
    const r = this.config.rx.monoPdMm;
    const issues: ValidationIssue[] = [];
    if (Number.isNaN(pd) || !Number.isFinite(pd)) {
      push(issues, { code: 'MONO_PD_NAN', message: '单眼瞳距必须为有效数字', field: 'monoPd' });
      return { ok: false, issues };
    }
    if (pd < r.min - EPS || pd > r.max + EPS) {
      push(issues, {
        code: 'MONO_PD_RANGE',
        message: `单眼瞳距应在 ${r.min}mm ~ ${r.max}mm 之间`,
        field: 'monoPd',
      });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  validateRefractiveIndexAndAbbe(n: number, abbe: number): ValidationResult {
    const { globalSanity, envelopes } = this.config.material;
    const issues: ValidationIssue[] = [];

    if (Number.isNaN(n) || !Number.isFinite(n) || Number.isNaN(abbe) || !Number.isFinite(abbe)) {
      push(issues, {
        code: 'MAT_NAN',
        message: '折射率与阿贝数必须为有效数字',
        field: 'material',
      });
      return { ok: false, issues };
    }

    if (
      n < globalSanity.nMin - EPS ||
      n > globalSanity.nMax + EPS ||
      abbe < globalSanity.abbeMin - EPS ||
      abbe > globalSanity.abbeMax + EPS
    ) {
      push(issues, {
        code: 'MAT_GLOBAL',
        message: `折射率/阿贝数超出全局合理区（n: ${globalSanity.nMin}–${globalSanity.nMax}，V: ${globalSanity.abbeMin}–${globalSanity.abbeMax}）`,
        field: 'material',
      });
      return { ok: false, issues };
    }

    const hit = envelopes.some(
      (e) =>
        n >= e.nMin - EPS &&
        n <= e.nMax + EPS &&
        abbe >= e.abbeMin - EPS &&
        abbe <= e.abbeMax + EPS,
    );

    if (!hit) {
      push(issues, {
        code: 'MAT_ENVELOPE',
        message: '折射率与阿贝数组合未落在已知树脂包络内，请核对录入或材料牌号',
        field: 'material',
      });
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  validateBilateralRx(input: BilateralRxInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    const merge = (r: ValidationResult, prefix: string) => {
      if (!r.ok) {
        for (const i of r.issues) {
          issues.push({ ...i, field: i.field ? `${prefix}.${i.field}` : prefix });
        }
      }
    };

    merge(this.validateSphereDiopter(input.right.sphere), 'od');
    merge(this.validateCylinderDiopter(input.right.cylinder), 'od');
    merge(this.validateAxisDegrees(input.right.axis, input.right.cylinder), 'od');

    merge(this.validateSphereDiopter(input.left.sphere), 'os');
    merge(this.validateCylinderDiopter(input.left.cylinder), 'os');
    merge(this.validateAxisDegrees(input.left.axis, input.left.cylinder), 'os');

    if (input.pdTotalMm != null) {
      merge(this.validatePdTotalMm(input.pdTotalMm), 'pd');
    }
    if (input.monoPdMmOd != null) {
      merge(this.validateMonoPdMm(input.monoPdMmOd), 'pd.od');
    }
    if (input.monoPdMmOs != null) {
      merge(this.validateMonoPdMm(input.monoPdMmOs), 'pd.os');
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
}

/** 仓库内嵌 hub（构建时打包；与 /api/matrix/context 磁盘文件内容应保持一致） */
export const matrixIntelligenceHub = hubJson as MatrixIntelligenceHubFile;

/** 默认校验器实例（配置来自 hub.validate） */
export const matrixValidator = new MatrixValidator(matrixIntelligenceHub);

/** 兼容旧代码：由 matrix-intelligence-hub.json 派生的扁平 meta + rx + material 视图 */
export const matrixRules: MatrixRulesFile = {
  meta: hubMetaToRulesMeta(matrixIntelligenceHub),
  rx: matrixValidator.config.rx,
  material: matrixValidator.config.material,
};

export const matrixDictionary = dictionaryJson as MatrixDictionaryFile;

/** @deprecated 请优先使用 matrixValidator.validateSphereDiopter */
export function validateSphereDiopter(sph: number): ValidationResult {
  return matrixValidator.validateSphereDiopter(sph);
}

export function validateCylinderDiopter(cyl: number): ValidationResult {
  return matrixValidator.validateCylinderDiopter(cyl);
}

export function validateAxisDegrees(axis: number | null | undefined, cylinderDiopter: number): ValidationResult {
  return matrixValidator.validateAxisDegrees(axis, cylinderDiopter);
}

export function validatePdTotalMm(pd: number): ValidationResult {
  return matrixValidator.validatePdTotalMm(pd);
}

export function validateMonoPdMm(pd: number): ValidationResult {
  return matrixValidator.validateMonoPdMm(pd);
}

export function validateRefractiveIndexAndAbbe(n: number, abbe: number): ValidationResult {
  return matrixValidator.validateRefractiveIndexAndAbbe(n, abbe);
}

export function validateBilateralRx(input: BilateralRxInput): ValidationResult {
  return matrixValidator.validateBilateralRx(input);
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveDictionaryEntry(raw: string) {
  const t = normalizeToken(raw);
  if (!t) return null;
  for (const e of matrixDictionary.entries) {
    if (normalizeToken(e.canonicalZh) === t) return e;
    if (e.canonicalEn && normalizeToken(e.canonicalEn) === t) return e;
    for (const syn of e.synonyms) {
      if (normalizeToken(syn) === t) return e;
    }
  }
  return null;
}

export function resolveCanonicalZh(raw: string): string | null {
  const e = resolveDictionaryEntry(raw);
  return e ? e.canonicalZh : null;
}
