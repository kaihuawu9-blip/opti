/**
 * 门店培训用：镜片边缘厚度薄透镜近似 + 分眼单眼瞳距移心（或合计瞳距各半）。
 * 不替代厂家光学设计与焦度计实测。
 */

export const REFRACTIVE_INDEX_PRESETS = [
  { label: '1.50', n: 1.5 },
  { label: '1.56', n: 1.56 },
  { label: '1.60', n: 1.6 },
  { label: '1.67', n: 1.67 },
  { label: '1.74', n: 1.74 },
] as const;

const K_FACTOR = 2000;

/** Δt(mm) = F·y² / [2000(n−1)]，F≤0 为增厚 */
export function edgeDeltaMm(powerD: number, semiChordMm: number, indexN: number): number {
  const denom = K_FACTOR * (indexN - 1);
  if (denom <= 0 || !Number.isFinite(powerD) || !Number.isFinite(semiChordMm)) return NaN;
  const y2 = semiChordMm * semiChordMm;
  if (powerD <= 0) return (Math.abs(powerD) * y2) / denom;
  return -(powerD * y2) / denom;
}

export function edgeThicknessMm(
  centerThicknessMm: number,
  powerD: number,
  semiChordMm: number,
  indexN: number,
  minEdgeMm: number,
): number {
  const raw = centerThicknessMm + edgeDeltaMm(powerD, semiChordMm, indexN);
  if (!Number.isFinite(raw)) return NaN;
  return Math.max(minEdgeMm, raw);
}

/** 负柱写法：轴 φ 上为 S，φ⊥ 上为 S+C */
export function perpendicularAxisDeg(axisDeg: number): number {
  const a = ((Math.round(axisDeg) % 180) + 180) % 180;
  const p = a + 90;
  if (p > 180) return p - 180;
  if (p === 0) return 180;
  return p;
}

/**
 * 对称配镜：左右单眼水平移心量（mm）。
 * 未区分单眼瞳距；若 PD 与 FPD 严重不合理仅作数学上仍可得 y。
 */
export function symmetricHorizontalDecentrationMm(frameGeometricPdMm: number, farPdMm: number): number {
  return Math.abs(frameGeometricPdMm - farPdMm) / 2;
}

export function effectiveSemiChordMm(edHorizontalMm: number, totalDecentrationMm: number): number {
  return edHorizontalMm / 2 + totalDecentrationMm;
}

/**
 * 单眼：δ = FPD/2 − 该眼单眼瞳距（鼻梁中点至该侧瞳孔）；与对称时 (FPD−PD总)/2 一致。
 * 颞侧与鼻侧到 OC 的有效半口径用 |δ| 分配厚/薄侧 y。
 */
export function semiChordNasalTemporalPerEye(
  edHorizontalMm: number,
  fpdMm: number,
  monocularPdMm: number,
  extraAbsMm: number,
): { half: number; deltaSigned: number; yThick: number; yThin: number } {
  const half = edHorizontalMm / 2;
  const deltaSigned = fpdMm / 2 - monocularPdMm;
  const yThick = half + Math.abs(deltaSigned) + extraAbsMm;
  const yThin = Math.max(half - Math.abs(deltaSigned), 0.35);
  return { half, deltaSigned, yThick, yThin };
}

/** 对称瞳距：等价于两眼单眼均为 PD/2（内部转 {@link semiChordNasalTemporalPerEye}）。 */
export function semiChordNasalTemporalMm(
  edHorizontalMm: number,
  fpdMm: number,
  pdMm: number,
  extraAbsMm: number,
): { half: number; deltaSigned: number; yThick: number; yThin: number } {
  return semiChordNasalTemporalPerEye(edHorizontalMm, fpdMm, pdMm / 2, extraAbsMm);
}

/**
 * 正视：左片颞侧≈180°、鼻侧≈0°；右片颞侧≈0°、鼻侧≈180°。
 * 返回 1 表示该 rim 方向接近「厚侧」半口径，0 接近「薄侧」。
 */
export function thickSideHorizontalBlend(isLeftLens: boolean, patientRimAngleDeg: number): number {
  if (isLeftLens) {
    return (1 + Math.cos(((patientRimAngleDeg - 180) * Math.PI) / 180)) / 2;
  }
  return (1 + Math.cos((patientRimAngleDeg * Math.PI) / 180)) / 2;
}

export function parseLooseNumber(input: string, fallback: number): number {
  const t = input.trim().replace(/,/g, '');
  if (t === '' || t === '-' || t === '+') return fallback;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) ? v : fallback;
}

/** 周向示意：两主子午线厚度 cos²/sin² 混合（非严格椭圆边缘光学） */
export function edgeThicknessAtAngleMm(
  thickOnAxisMeridianMm: number,
  thickPerpendicularMm: number,
  cylinderAxisDeg: number,
  rimAngleDeg: number,
): number {
  const axisRad = (cylinderAxisDeg * Math.PI) / 180;
  const t = (rimAngleDeg * Math.PI) / 180;
  const rel = t - axisRad;
  return thickOnAxisMeridianMm * Math.cos(rel) ** 2 + thickPerpendicularMm * Math.sin(rel) ** 2;
}

/** 单眼：移心与 y、边缘厚（主子午线 delta 与 e） */
export type LensEyeEdgeMetrics = {
  monocularPdMm: number;
  deltaSigned: number;
  y0: number;
  yThick: number;
  yThin: number;
  F1: number;
  F2: number;
  d1Thick: number;
  d1Thin: number;
  d2Thick: number;
  d2Thin: number;
  e1Thick: number;
  e1Thin: number;
  e2Thick: number;
  e2Thin: number;
  thicker: number;
  thinner: number;
};

export type LensEdgeComputation = {
  n: number;
  ct: number;
  minEdge: number;
  ed: number;
  fpdMm: number;
  /** 合计远用瞳距 PD_OD+PD_OS */
  pdSumMm: number;
  pdOdMm: number;
  pdOsMm: number;
  decentExtra: number;
  /** 对称参考 |FPD−PDsum|/2 */
  decentSymmetryMm: number;
  axis: number;
  axisB: number;
  hasCyl: boolean;
  k: number;
  /** 右眼 OD */
  od: LensEyeEdgeMetrics;
  /** 左眼 OS */
  os: LensEyeEdgeMetrics;
  /** 两眼主子午线最大/最小边缘厚 */
  thicker: number;
  thinner: number;
};

export type LensEdgeResult = { ok: true; data: LensEdgeComputation } | { ok: false; message: string };

export type LensEdgeFormStrings = {
  nStr: string;
  ctStr: string;
  edStr: string;
  frameCenterStr: string;
  /** 合计远用瞳距：可与单眼二选一（仅填此项时按各眼 PD/2 分配） */
  pdStr: string;
  /** 右眼单眼瞳距 mm；与 pdOsStr 均有效时优先于 pdStr */
  pdOdStr: string;
  /** 左眼单眼瞳距 mm */
  pdOsStr: string;
  decentExtraStr: string;
  sphereStr: string;
  cylStr: string;
  axisStr: string;
  minEdgeStr: string;
};

function computeEyeMetrics(
  monocularPdMm: number,
  ed: number,
  fpdMm: number,
  extraAbs: number,
  n: number,
  ct: number,
  minEdge: number,
  S: number,
  C: number,
): LensEyeEdgeMetrics {
  const { half: y0, deltaSigned, yThick, yThin } = semiChordNasalTemporalPerEye(ed, fpdMm, monocularPdMm, extraAbs);
  const F1 = S;
  const F2 = S + C;
  const d1Thick = edgeDeltaMm(F1, yThick, n);
  const d1Thin = edgeDeltaMm(F1, yThin, n);
  const d2Thick = edgeDeltaMm(F2, yThick, n);
  const d2Thin = edgeDeltaMm(F2, yThin, n);
  const e1Thick = edgeThicknessMm(ct, F1, yThick, n, minEdge);
  const e1Thin = edgeThicknessMm(ct, F1, yThin, n, minEdge);
  const e2Thick = edgeThicknessMm(ct, F2, yThick, n, minEdge);
  const e2Thin = edgeThicknessMm(ct, F2, yThin, n, minEdge);
  const thicker = Math.max(e1Thick, e1Thin, e2Thick, e2Thin);
  const thinner = Math.min(e1Thick, e1Thin, e2Thick, e2Thin);
  return {
    monocularPdMm,
    deltaSigned,
    y0,
    yThick,
    yThin,
    F1,
    F2,
    d1Thick,
    d1Thin,
    d2Thick,
    d2Thin,
    e1Thick,
    e1Thin,
    e2Thick,
    e2Thin,
    thicker,
    thinner,
  };
}

/** 从表单解析 PD_OD、PD_OS：单眼优先，否则合计各半 */
export function parseMonocularPdFromFormStrings(s: {
  pdStr: string;
  pdOdStr: string;
  pdOsStr: string;
}): { ok: true; pdOdMm: number; pdOsMm: number; pdSumMm: number } | { ok: false; message: string } {
  const pdOd = parseLooseNumber(s.pdOdStr, NaN);
  const pdOs = parseLooseNumber(s.pdOsStr, NaN);
  const pdTotal = parseLooseNumber(s.pdStr, NaN);

  if (pdOd > 0 && pdOs > 0) {
    return { ok: true, pdOdMm: pdOd, pdOsMm: pdOs, pdSumMm: pdOd + pdOs };
  }
  if (pdTotal > 0) {
    const half = pdTotal / 2;
    return { ok: true, pdOdMm: half, pdOsMm: half, pdSumMm: pdTotal };
  }
  return {
    ok: false,
    message:
      '请填写右眼/左眼单眼瞳距（mm），或填写合计远用瞳距（将按各眼一半分配）。镜片光学中心按瞳距加工，缺此项无法正确算移心与半口径 y。',
  };
}

export function computeLensEdgeFromForm(s: LensEdgeFormStrings): LensEdgeResult {
  const n = parseLooseNumber(s.nStr, NaN);
  const ct = parseLooseNumber(s.ctStr, NaN);
  const ed = parseLooseNumber(s.edStr, NaN);
  const S = parseLooseNumber(s.sphereStr, NaN);
  const C = parseLooseNumber(s.cylStr, 0);
  const minEdge = parseLooseNumber(s.minEdgeStr, 0.8);
  const axis = parseLooseNumber(s.axisStr, 180);
  const extra = parseLooseNumber(s.decentExtraStr, 0);

  if (!(n > 1 && n < 2) || !(ed > 0) || !(ct > 0) || !Number.isFinite(S)) {
    return { ok: false, message: '请填写折射率、镜圈水平尺寸与球镜。' };
  }

  const fpdTrim = s.frameCenterStr.trim();
  const fpdMm = parseLooseNumber(s.frameCenterStr, NaN);
  if (fpdTrim === '' || !Number.isFinite(fpdMm) || !(fpdMm > 0)) {
    return { ok: false, message: '请填写镜框两镜片几何中心距 FPD（mm）。' };
  }

  const pdParsed = parseMonocularPdFromFormStrings(s);
  if (!pdParsed.ok) return pdParsed;

  const { pdOdMm, pdOsMm, pdSumMm } = pdParsed;
  const extraAbs = Math.abs(extra);
  const decentSymmetryMm = symmetricHorizontalDecentrationMm(fpdMm, pdSumMm);
  const axisNorm = Number.isFinite(axis) ? axis : 180;
  const axisB = perpendicularAxisDeg(axisNorm);

  const od = computeEyeMetrics(pdOdMm, ed, fpdMm, extraAbs, n, ct, minEdge, S, C);
  const os = computeEyeMetrics(pdOsMm, ed, fpdMm, extraAbs, n, ct, minEdge, S, C);

  const nums = [
    od.d1Thick,
    od.d1Thin,
    od.d2Thick,
    od.d2Thin,
    od.e1Thick,
    od.e1Thin,
    od.e2Thick,
    od.e2Thin,
    os.d1Thick,
    os.d1Thin,
    os.d2Thick,
    os.d2Thin,
    os.e1Thick,
    os.e1Thin,
    os.e2Thick,
    os.e2Thin,
  ];
  if (!nums.every((x) => Number.isFinite(x))) {
    return { ok: false, message: '计算异常，请检查数值。' };
  }

  const k = K_FACTOR * (n - 1);
  const thicker = Math.max(od.thicker, os.thicker);
  const thinner = Math.min(od.thinner, os.thinner);

  return {
    ok: true,
    data: {
      n,
      ct,
      minEdge,
      ed,
      fpdMm,
      pdSumMm,
      pdOdMm,
      pdOsMm,
      decentExtra: extra,
      decentSymmetryMm,
      axis: axisNorm,
      axisB,
      hasCyl: Math.abs(C) > 1e-6,
      k,
      od,
      os,
      thicker,
      thinner,
    },
  };
}
