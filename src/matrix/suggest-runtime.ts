import hubJson from './matrix-intelligence-hub.json';
import type { MatrixIntelligenceHubFile } from './types';

const hub = hubJson as MatrixIntelligenceHubFile;

/** 从收银台 ds/dc 字符串解析屈光力（D），失败返回 null */
export function parseRxDiopterD(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '平光' || s === 'PL') return 0;
  const cleaned = s.replace(/[^\d.+-]/g, '');
  if (!cleaned || cleaned === '+' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 柱镜空串视为 0（平光散光） */
export function parseRxCylinderD(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return 0;
  return parseRxDiopterD(raw);
}

function sePerEye(sph: number, cyl: number): number {
  return sph + cyl / 2;
}

function maxAbsSeBinocular(params: {
  od_sph: number;
  od_cyl: number;
  os_sph: number;
  os_cyl: number;
}): number {
  const seOd = sePerEye(params.od_sph, params.od_cyl);
  const seOs = sePerEye(params.os_sph, params.os_cyl);
  return Math.max(Math.abs(seOd), Math.abs(seOs));
}

type MaterialBand = {
  lt?: number;
  gte?: number;
  recommend_index?: string;
  rationale?: string;
};

function pickMaterialBand(absSe: number, bands: MaterialBand[]): MaterialBand | null {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  for (const b of bands) {
    if (typeof b.lt === 'number' && absSe < b.lt) return b;
  }
  let lastGte: MaterialBand | null = null;
  for (const b of bands) {
    if (typeof b.gte === 'number' && absSe >= b.gte) lastGte = b;
  }
  return lastGte;
}

function readEdgeWarnMm(suggestGeo: Record<string, unknown>): number {
  const mat = suggestGeo.material_recommendation as Record<string, unknown> | undefined;
  if (!mat) return 5;
  const w = mat.sell_side_edge_thickness_warn_mm;
  if (typeof w === 'number' && Number.isFinite(w)) return w;
  if (w && typeof w === 'object' && 'value_mm' in w) {
    const n = Number((w as { value_mm?: unknown }).value_mm);
    return Number.isFinite(n) ? n : 5;
  }
  return 5;
}

function readHintTemplate(suggestGeo: Record<string, unknown>): string {
  const mat = suggestGeo.material_recommendation as Record<string, unknown> | undefined;
  const t = mat?.sell_side_hint_zh_template;
  if (t && typeof t === 'object' && 'value' in t) {
    const v = (t as { value?: unknown }).value;
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (typeof t === 'string' && t.trim()) return t;
  return '该度数（|SE|≈{se_abs}D）建议首选折射率 {index}，{rationale}；注意边缘厚度不宜持续超过约 {edge_mm} mm。';
}

/**
 * 销售环节：根据双眼球柱计算 |SE| 与 suggest 层折射率带，生成即时导购话术（非医疗结论）。
 */
export function buildCashierRefractiveIndexHintsFromHub(
  h: MatrixIntelligenceHubFile,
  input: { od_ds: string; od_dc: string; os_ds: string; os_dc: string },
): { se_abs: number | null; hints: string[]; recommend_index: string | null } {
  const hints: string[] = [];
  const suggest = h.suggest as Record<string, unknown> | undefined;
  const geo = suggest?.geometric_optics as Record<string, unknown> | undefined;
  if (!geo) return { se_abs: null, hints: [], recommend_index: null };

  const odSph = parseRxDiopterD(input.od_ds);
  const odCyl = parseRxCylinderD(input.od_dc);
  const osSph = parseRxDiopterD(input.os_ds);
  const osCyl = parseRxCylinderD(input.os_dc);
  if (odSph == null || odCyl == null || osSph == null || osCyl == null) {
    return { se_abs: null, hints: [], recommend_index: null };
  }

  const seAbs = maxAbsSeBinocular({ od_sph: odSph, od_cyl: odCyl, os_sph: osSph, os_cyl: osCyl });
  const mat = geo.material_recommendation as Record<string, unknown> | undefined;
  const bands = (mat?.by_abs_sph_equivalent_d as MaterialBand[]) || [];
  const pick = pickMaterialBand(seAbs, bands);
  const edgeMm = readEdgeWarnMm(geo);
  const tpl = readHintTemplate(geo);

  if (!pick?.recommend_index) {
    return { se_abs: seAbs, hints, recommend_index: null };
  }

  const index = String(pick.recommend_index);
  const rationale = typeof pick.rationale === 'string' ? pick.rationale : '';
  const line = tpl
    .replace(/\{se_abs\}/g, seAbs.toFixed(2))
    .replace(/\{index\}/g, index)
    .replace(/\{rationale\}/g, rationale)
    .replace(/\{edge_mm\}/g, String(edgeMm));
  hints.push(line);
  return { se_abs: seAbs, hints, recommend_index: index };
}

export type InventoryGuardResult = {
  status: 'ok' | 'suggest_review';
  reasons: string[];
};

/**
 * 库存环节：老花/渐进类 SKU 与 ADD、年龄、validate 层 ADD 边界的联合存疑检查。
 */
export function evaluateInventoryPresbyopiaFromHub(
  h: MatrixIntelligenceHubFile,
  input: {
    name: string;
    lens_type?: string | null;
    category?: string | null;
    /** 可选：采购侧已知适用年龄时传入 */
    age_years?: number | null;
  },
): InventoryGuardResult {
  const reasons: string[] = [];
  const suggest = h.suggest as Record<string, unknown> | undefined;
  const block = suggest?.inventory_presbyopia_consistency as Record<string, unknown> | undefined;
  if (!block) return { status: 'ok', reasons: [] };

  const hay = `${input.name || ''} ${input.lens_type || ''} ${input.category || ''}`.toLowerCase();
  const triggers = block.trigger_keywords_any as string[] | undefined;
  const hitKeyword = Array.isArray(triggers) && triggers.some((k) => hay.includes(String(k).toLowerCase()));
  if (!hitKeyword) return { status: 'ok', reasons: [] };

  const reStr = typeof block.add_parse_regex === 'string' ? block.add_parse_regex : '';
  let addParsed: number | null = null;
  if (reStr) {
    try {
      const re = new RegExp(reStr, 'i');
      const m = `${input.name} ${input.lens_type || ''}`.match(re);
      if (m?.[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) addParsed = Math.abs(n);
      }
    } catch {
      // ignore bad regex in hub
    }
  }

  const valGeo = h.validate?.geometric_optics as Record<string, unknown> | undefined;
  const addRange = valGeo?.add_diopter_range as { min?: number; max?: number } | undefined;
  if (addParsed != null && addRange) {
    const amin = Number(addRange.min);
    const amax = Number(addRange.max);
    if (Number.isFinite(amin) && addParsed + 1e-9 < amin) {
      reasons.push(`解析到 ADD≈${addParsed}D，低于 validate 层允许下限 ${amin}D，请核对品名或规格`);
    }
    if (Number.isFinite(amax) && addParsed - 1e-9 > amax) {
      reasons.push(`解析到 ADD≈${addParsed}D，高于 validate 层允许上限 ${amax}D，请核对品名或规格`);
    }
  }

  const age = input.age_years;
  const rules = block.age_add_rules as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rules) && age != null && Number.isFinite(age) && addParsed != null) {
    for (const r of rules) {
      let hit = false;
      if (
        typeof r.if_age_lt === 'number' &&
        age < r.if_age_lt &&
        typeof r.if_add_gte_d === 'number' &&
        addParsed >= r.if_add_gte_d - 1e-9
      ) {
        hit = true;
      }
      if (
        typeof r.if_age_gt === 'number' &&
        age > r.if_age_gt &&
        typeof r.if_add_lte_d === 'number' &&
        addParsed <= r.if_add_lte_d + 1e-9
      ) {
        hit = true;
      }
      if (hit && typeof r.reason === 'string') reasons.push(r.reason);
    }
  }

  return reasons.length > 0 ? { status: 'suggest_review', reasons } : { status: 'ok', reasons: [] };
}

/** 默认使用仓库内嵌 hub（与 MatrixValidator 同源 JSON） */
export function buildCashierRefractiveIndexHints(input: {
  od_ds: string;
  od_dc: string;
  os_ds: string;
  os_dc: string;
}) {
  return buildCashierRefractiveIndexHintsFromHub(hub, input);
}

export function evaluateInventoryPresbyopia(input: {
  name: string;
  lens_type?: string | null;
  category?: string | null;
  age_years?: number | null;
}) {
  return evaluateInventoryPresbyopiaFromHub(hub, input);
}
