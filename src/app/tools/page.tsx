'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Wrench } from 'lucide-react';
import { computeLensEdgeFromForm } from '@/lib/lensEdgeThickness';
import { GlassesEdgeVisual } from '@/components/tools/GlassesEdgeVisual';
import { fetchLensTintConfigClient } from '@/lib/fittingbox/lensTintConfigClient';
import { DEFAULT_LENS_TINT_PRESETS, type LensTintPreset } from '@/lib/fittingbox/lensTintPresets';

type ToolFeature = 'thickness-scale' | 'tint-lens' | 'polarized-lens' | 'progressive-lens';

const INDEX_PRESETS = [
  { label: '1.50', n: 1.5 },
  { label: '1.56', n: 1.56 },
  { label: '1.60', n: 1.6 },
  { label: '1.67', n: 1.67 },
  { label: '1.74', n: 1.74 },
] as const;

const TOOL_FEATURES: { id: ToolFeature; label: string; desc: string }[] = [
  { id: 'thickness-scale', label: '镜片厚薄缩放', desc: '已上线' },
  { id: 'tint-lens', label: '染色镜片', desc: '后续添加' },
  { id: 'polarized-lens', label: '偏光镜片', desc: '后续添加' },
  { id: 'progressive-lens', label: '渐进镜片', desc: '后续添加' },
];

/** Electron / file 协议下 clipboard API 可能不可用或抛错，用 textarea 兜底 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function parseNum(s: string, fallback: number): number {
  const t = s.trim().replace(/,/g, '');
  if (t === '' || t === '-' || t === '+') return fallback;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/u.test(normalized)) return [120, 120, 120];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

/** 薄透镜边缘增量；弯月形/美薄与实测常有差距，由 calib 折减 */
function edgeDeltaMm(power: number, y: number, n: number, calib: number): number {
  const k = 2000 * (n - 1);
  if (!(k > 0) || !Number.isFinite(power) || !Number.isFinite(y)) return NaN;
  const c = Number.isFinite(calib) && calib > 0 ? calib : 0.8;
  const y2 = y * y;
  if (power <= 0) return ((Math.abs(power) * y2) / k) * c;
  return (-(power * y2) / k) * c;
}

function edgeThicknessMm(
  ct: number,
  power: number,
  y: number,
  n: number,
  minEdge: number,
  calib: number,
): number {
  const raw = ct + edgeDeltaMm(power, y, n, calib);
  if (!Number.isFinite(raw)) return NaN;
  return Math.max(minEdge, raw);
}

/** 轴位 α（°）：颞侧 F=S+C·cos²α、鼻侧 F=S+C·sin²α（颊侧下缘与颞侧同式 F，仅 y 不同）。 */
function powerTempleNasal(S: number, C: number, axisDeg: number): { FTemporal: number; FNasal: number } {
  const a = ((axisDeg % 180) + 180) % 180;
  const rad = (a * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    FTemporal: S + C * c * c,
    FNasal: S + C * s * s,
  };
}

export default function ToolsPage() {
  const [activeFeature, setActiveFeature] = useState<ToolFeature>('thickness-scale');
  const [tintColors, setTintColors] = useState<LensTintPreset[]>(DEFAULT_LENS_TINT_PRESETS);
  const [tintLoading, setTintLoading] = useState(false);
  const [tintError, setTintError] = useState('');
  const [selectedTintPreview, setSelectedTintPreview] = useState<LensTintPreset | null>(null);
  const [tintPreviewOpen, setTintPreviewOpen] = useState(false);
  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [tintOpacityPct, setTintOpacityPct] = useState(45);
  const [tintToneMode, setTintToneMode] = useState<'solid' | 'gradient'>('solid');
  const [tintCompareMode, setTintCompareMode] = useState(false);
  const [tintGlossOn, setTintGlossOn] = useState(true);
  const [nStr, setNStr] = useState('1.60');
  /** 只填合计时按各眼 PD/2；若同时填了 OD/OS 则优先用单眼 */
  const [pdTotalStr, setPdTotalStr] = useState('62');
  const [pdOdStr, setPdOdStr] = useState('');
  const [pdOsStr, setPdOsStr] = useState('');
  const [aStr, setAStr] = useState('52');
  const [dblStr, setDblStr] = useState('18');
  const [sStr, setSStr] = useState('-4.00');
  const [cStr, setCStr] = useState('-1.00');
  const [axisStr, setAxisStr] = useState('180');
  const [ctStr, setCtStr] = useState('1.2');
  const [minEdgeStr, setMinEdgeStr] = useState('0.8');
  const [bStr, setBStr] = useState('');
  const [calibStr, setCalibStr] = useState('0.78');

  const calc = useMemo(() => {
    const n = parseNum(nStr, NaN);
    const pdTotal = parseNum(pdTotalStr, NaN);
    const pdOdRaw = parseNum(pdOdStr, NaN);
    const pdOsRaw = parseNum(pdOsStr, NaN);
    let pdOd: number;
    let pdOs: number;
    if (pdOdRaw > 0 && pdOsRaw > 0) {
      pdOd = pdOdRaw;
      pdOs = pdOsRaw;
    } else if (pdTotal > 0) {
      pdOd = pdTotal / 2;
      pdOs = pdTotal / 2;
    } else {
      return {
        ok: false as const,
        msg: '请填写「合计远用瞳距」，或同时填写右眼、左眼单眼瞳距（mm）。',
      };
    }
    const A = parseNum(aStr, NaN);
    const dbl = parseNum(dblStr, NaN);
    const S = parseNum(sStr, NaN);
    const C = parseNum(cStr, 0);
    const axis = parseNum(axisStr, 180);
    const ct = parseNum(ctStr, NaN);
    const minEdge = parseNum(minEdgeStr, 0.8);
    const B = parseNum(bStr, NaN);
    const calib = parseNum(calibStr, 0.78);

    if (!(n > 1 && n < 2)) return { ok: false as const, msg: '折射率 n 无效。' };
    if (!(A > 0 && dbl >= 0)) {
      return { ok: false as const, msg: '请填写有效的镜框宽度 A、鼻梁 DBL。' };
    }
    if (!Number.isFinite(S)) return { ok: false as const, msg: '请填写有效的球镜 S。' };
    if (!(ct > 0)) return { ok: false as const, msg: '中心厚度 CT 无效。' };
    if (!(calib > 0.3 && calib <= 1.5)) return { ok: false as const, msg: '校准系数建议 0.5～1.2（默认 0.78）。' };

    const fpd = A + dbl;
    const halfFpd = fpd / 2;
    /** 单眼：光学中心相对镜圈几何中心的水平移心量近似（mm），与对称时 (FPD−PD)/2 一致 */
    const deltaOd = halfFpd - pdOd;
    const deltaOs = halfFpd - pdOs;
    const pdSum = pdOd + pdOs;
    const halfA = A / 2;
    const hasB = Number.isFinite(B) && B > 0;
    const halfB = hasB ? B / 2 : 0;

    const semiForEye = (delta: number) => {
      const xTemp = Math.max(0.2, halfA + delta);
      const xNas = Math.max(0.2, halfA - delta);
      const yTemporal = hasB ? Math.hypot(xTemp, halfB) : xTemp;
      const yNasal = hasB ? Math.hypot(xNas, halfB) : xNas;
      return { xTemp, xNas, yTemporal, yNasal };
    };

    const od = semiForEye(deltaOd);
    const os = semiForEye(deltaOs);
    const Bcheek = hasB ? B : 0.72 * A;
    const yCheek = Math.max(0.2, Bcheek / 2);

    const axisNorm = ((Math.round(axis) % 180) + 180) % 180 || 180;
    const axisForPower = Number.isFinite(axis) ? axis : axisNorm;
    const { FTemporal, FNasal } = powerTempleNasal(S, C, axisForPower);

    const edgeOdTemporal = edgeThicknessMm(ct, FTemporal, od.yTemporal, n, minEdge, calib);
    const edgeOdNasal = edgeThicknessMm(ct, FNasal, od.yNasal, n, minEdge, calib);
    const edgeOsTemporal = edgeThicknessMm(ct, FTemporal, os.yTemporal, n, minEdge, calib);
    const edgeOsNasal = edgeThicknessMm(ct, FNasal, os.yNasal, n, minEdge, calib);
    const edgeCheek = edgeThicknessMm(ct, FTemporal, yCheek, n, minEdge, calib);

    const values = [edgeOdTemporal, edgeOdNasal, edgeOsTemporal, edgeOsNasal, edgeCheek];
    if (!values.every((v) => Number.isFinite(v))) return { ok: false as const, msg: '计算异常，请检查输入。' };

    return {
      ok: true as const,
      n,
      ct,
      minEdge,
      pdOd,
      pdOs,
      pdSum,
      A,
      dbl,
      fpd,
      deltaOd,
      deltaOs,
      halfB,
      hasB,
      bUsed: hasB ? B : null as number | null,
      bCheek: Bcheek,
      calib,
      od,
      os,
      yCheek,
      axis: axisNorm,
      S,
      C,
      FTemporal,
      FNasal,
      edgeOdTemporal,
      edgeOdNasal,
      edgeOsTemporal,
      edgeOsNasal,
      edgeCheek,
    };
  }, [nStr, pdTotalStr, pdOdStr, pdOsStr, aStr, dblStr, sStr, cStr, axisStr, ctStr, minEdgeStr, bStr, calibStr]);

  const lensLibResult = useMemo(
    () =>
      computeLensEdgeFromForm({
        nStr,
        ctStr,
        edStr: aStr,
        frameCenterStr: (() => {
          const A = parseNum(aStr, NaN);
          const dbl = parseNum(dblStr, NaN);
          const fpd = A + dbl;
          return Number.isFinite(fpd) && fpd > 0 ? String(fpd) : '';
        })(),
        pdStr: pdTotalStr,
        pdOdStr,
        pdOsStr,
        decentExtraStr: '0',
        sphereStr: sStr,
        cylStr: cStr,
        axisStr,
        minEdgeStr,
      }),
    [nStr, ctStr, aStr, dblStr, pdTotalStr, pdOdStr, pdOsStr, sStr, cStr, axisStr, minEdgeStr],
  );

  const proposalText = useMemo(() => {
    if (!calc.ok) return '';
    return [
      '【镜片边缘厚度参考 · 门店培训用薄透镜近似，以厂家与实测为准】',
      `镜架：镜片宽 A=${calc.A} mm，鼻梁 DBL=${calc.dbl} mm → 镜圈几何中心距 FPD=${calc.fpd.toFixed(1)} mm`,
      `镜片：折射率 n=${calc.n}，中心厚 CT=${calc.ct} mm，边缘下限 ${calc.minEdge} mm，校准系数 ${calc.calib.toFixed(2)}`,
      `处方：球镜 S=${calc.S} D，柱镜 C=${calc.C} D，轴位 ${calc.axis}°（颞 F=S+C·cos²α，鼻 F=S+C·sin²α）`,
      '',
      `右眼(OD)：单眼瞳距 PD_OD=${calc.pdOd.toFixed(1)} mm；水平移心参考 δ_OD=FPD/2−PD_OD=${calc.deltaOd.toFixed(2)} mm`,
      `  → 颞侧边缘厚约 ${calc.edgeOdTemporal.toFixed(2)} mm，鼻侧约 ${calc.edgeOdNasal.toFixed(2)} mm`,
      '',
      `左眼(OS)：单眼瞳距 PD_OS=${calc.pdOs.toFixed(1)} mm；水平移心参考 δ_OS=FPD/2−PD_OS=${calc.deltaOs.toFixed(2)} mm`,
      `  → 颞侧边缘厚约 ${calc.edgeOsTemporal.toFixed(2)} mm，鼻侧约 ${calc.edgeOsNasal.toFixed(2)} mm`,
      '',
      `合计远用瞳距：${calc.pdSum.toFixed(1)} mm（PD_OD+PD_OS）`,
      `双眼镜圈颊侧（下缘）参考约 ${calc.edgeCheek.toFixed(2)} mm`,
    ].join('\n');
  }, [calc]);

  /** 校验失败时仍允许复制「上次成功」的提案，避免整栏被错误提示替换后无法点「一键复制」 */
  const lastGoodProposalRef = useRef('');
  useEffect(() => {
    if (proposalText) lastGoodProposalRef.current = proposalText;
  }, [proposalText]);

  const displayProposalText =
    calc.ok && proposalText
      ? proposalText
      : !calc.ok
        ? lastGoodProposalRef.current ||
          `【校验未通过】\n${calc.msg}\n\n请修正左侧参数后将重新生成示意图与加工提案。`
        : '';

  useEffect(() => {
    let cancelled = false;
    setTintLoading(true);
    setTintError('');
    void fetchLensTintConfigClient()
      .then((config) => {
        if (cancelled) return;
        setTintColors(config.colors);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '加载染色列表失败';
        setTintError(msg);
      })
      .finally(() => {
        if (!cancelled) setTintLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayedTintColors = useMemo(() => {
    if (activeFeature === 'tint-lens') {
      return tintColors.filter((x) => x.family !== 'polarized');
    }
    if (activeFeature === 'polarized-lens') {
      return tintColors.filter((x) => x.family === 'polarized');
    }
    return [];
  }, [activeFeature, tintColors]);

  useEffect(() => {
    if (activeFeature !== 'tint-lens' && activeFeature !== 'polarized-lens') return;
    if (displayedTintColors.length === 0) {
      setSelectedTintPreview(null);
      return;
    }
    if (!selectedTintPreview || !displayedTintColors.some((x) => x.id === selectedTintPreview.id)) {
      setSelectedTintPreview(displayedTintColors[0]);
    }
  }, [activeFeature, displayedTintColors, selectedTintPreview]);

  useEffect(() => {
    if (!selectedTintPreview) return;
    setTintOpacityPct(Math.round(clamp(selectedTintPreview.opacity * 100, 10, 85)));
  }, [selectedTintPreview?.id]);

  const tintPreviewCss = useMemo(() => {
    if (!selectedTintPreview) {
      return {
        clearLensBg: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(226,232,240,0.72))',
        tintedLensBg: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(226,232,240,0.72))',
      };
    }
    const alpha = clamp(tintOpacityPct / 100, 0.1, 0.85);
    const [r, g, b] = hexToRgbTuple(selectedTintPreview.hex);
    const clearLensBg = 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(226,232,240,0.78))';
    const tintedSolid = `linear-gradient(145deg, rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)}), rgba(${r}, ${g}, ${b}, ${(
      alpha * 0.9
    ).toFixed(2)}))`;
    const tintedGradient = `linear-gradient(160deg, rgba(${r}, ${g}, ${b}, ${(alpha * 0.2).toFixed(2)}) 0%, rgba(${r}, ${g}, ${b}, ${(
      alpha * 0.92
    ).toFixed(2)}) 75%)`;
    return {
      clearLensBg,
      tintedLensBg: tintToneMode === 'gradient' ? tintedGradient : tintedSolid,
    };
  }, [selectedTintPreview, tintOpacityPct, tintToneMode]);

  const openFeatureModal = (feature: ToolFeature) => {
    setActiveFeature(feature);
    setFeatureModalOpen(true);
    if (feature === 'thickness-scale') {
      setTintPreviewOpen(false);
      setSelectedTintPreview(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Wrench className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">工具</h1>
          <p className="text-sm text-gray-500 mt-0.5">合计或单眼瞳距 + 屈光度；颞/鼻卡片 + 库内周向环带 + 加工提案</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 px-5 py-4">
          <h2 className="font-semibold text-gray-800">工具栏</h2>
          <p className="mt-1 text-xs text-gray-600">点击功能按钮进入对应模块；未上线模块先展示占位内容，后续可继续补充。</p>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {TOOL_FEATURES.map((feature) => {
            const active = activeFeature === feature.id;
            return (
              <button
                key={feature.id}
                type="button"
                        onClick={() => openFeatureModal(feature.id)}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50'
                }`}
              >
                <div className="text-sm font-semibold">{feature.label}</div>
                <div className={`mt-1 text-xs ${active ? 'text-blue-100' : 'text-gray-500'}`}>{feature.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {activeFeature === 'thickness-scale' ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-gray-800">镜片边缘厚度工具（一次算清楚）</h2>
          <p className="text-xs text-gray-600 mt-1">
            <strong>合计远用瞳距</strong>一栏即可（自动各眼一半）；要不对称再填右眼/左眼单眼瞳距（优先）。上方卡片含校准系数；下方紫色区为<strong>共用 lensEdgeThickness 库</strong>的周向环带示意（无校准、柱镜模型略不同）。
          </p>
        </div>

        <div className="p-5 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 text-sm">
            <div>
              <label className="block mb-1.5 font-medium text-gray-700">折射率 n</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {INDEX_PRESETS.map((x) => (
                  <button
                    key={x.label}
                    type="button"
                    onClick={() => setNStr(String(x.n))}
                    className={`px-3 py-1.5 rounded-lg border text-xs ${
                      parseNum(nStr, 0) === x.n ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-700'
                    }`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <input value={nStr} onChange={(e) => setNStr(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200" />
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-gray-700">合计远用瞳距（mm）</label>
              <input
                value={pdTotalStr}
                onChange={(e) => setPdTotalStr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200"
                placeholder="如 62；不填单眼时按各眼一半"
              />
              <p className="text-[11px] text-gray-500 mt-1">与下面 OD/OS 二选一或组合：单眼都填则忽略本栏合计、以单眼为准。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">右眼单眼瞳距 PD<sub>OD</sub>（mm·可选）</label>
                <input
                  value={pdOdStr}
                  onChange={(e) => setPdOdStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200"
                  placeholder="与 OS 同时填则优先"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">左眼单眼瞳距 PD<sub>OS</sub>（mm·可选）</label>
                <input
                  value={pdOsStr}
                  onChange={(e) => setPdOsStr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200"
                  placeholder="与 OD 同时填则优先"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">球镜 S（D）</label>
                <input value={sStr} onChange={(e) => setSStr(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200" />
              </div>
              {calc.ok ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 flex flex-col justify-center">
                  <span>
                    合计远用瞳距 <strong className="text-gray-800">{calc.pdSum.toFixed(1)}</strong> mm（PD<sub>OD</sub>+PD<sub>OS</sub>）
                  </span>
                  <span className="text-[11px] text-gray-500 mt-0.5">与镜圈几何中心距 FPD 对比用于移心</span>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400 flex items-center">填写瞳距后显示合计</div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">柱镜 C（D）</label>
                <input value={cStr} onChange={(e) => setCStr(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200" />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">轴位（°）</label>
                <input value={axisStr} onChange={(e) => setAxisStr(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200" />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-gray-700">中心厚 CT（mm）</label>
                <input value={ctStr} onChange={(e) => setCtStr(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200" />
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block mb-1 text-xs font-medium text-gray-700">镜框宽 A（mm）</label>
                  <input value={aStr} onChange={(e) => setAStr(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-indigo-200 bg-white" />
                </div>
                <div>
                  <label className="block mb-1 text-xs font-medium text-gray-700">鼻梁 DBL（mm）</label>
                  <input value={dblStr} onChange={(e) => setDblStr(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-indigo-200 bg-white" />
                </div>
                <div>
                  <label className="block mb-1 text-xs font-medium text-gray-700">镜圈高 B（mm）</label>
                  <input
                    value={bStr}
                    onChange={(e) => setBStr(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-indigo-200 bg-white"
                    placeholder="空＝颞鼻仅水平；颊侧按0.72A估高"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-xs font-medium text-gray-700">边缘下限（mm）</label>
                  <input value={minEdgeStr} onChange={(e) => setMinEdgeStr(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-indigo-200 bg-white" />
                </div>
              </div>

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center">
        <h2 className="text-base font-semibold text-gray-800">功能已改为弹窗模式</h2>
        <p className="mt-2 text-sm text-gray-500">点击上方任一工具按钮，将打开独立功能弹窗；染色镜片支持二次弹窗预览。</p>
      </div>

      {featureModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-bold text-gray-800">
                {activeFeature === 'thickness-scale' && '镜片厚薄缩放'}
                {activeFeature === 'tint-lens' && '染色镜片'}
                {activeFeature === 'polarized-lens' && '偏光镜片'}
                {activeFeature === 'progressive-lens' && '渐进镜片'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setFeatureModalOpen(false);
                  setTintPreviewOpen(false);
                }}
                className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
                aria-label="关闭功能弹窗"
              >
                ×
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
              {activeFeature === 'thickness-scale' ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-900">
                  厚薄缩放工具参数较多，保留在当前页面主区域使用；你可以先关闭本弹窗，再在本页继续输入参数计算。
                </div>
              ) : activeFeature === 'progressive-lens' ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                  渐进镜片功能入口已创建，详细内容后续补充。
                </div>
              ) : (
                <div className="space-y-3">
                  {tintLoading ? (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      正在同步云端染色配置，当前先展示本地预置列表。
                    </div>
                  ) : null}
                  {tintError ? (
                    <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      云端同步失败，已自动回退本地预置列表：{tintError}
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {displayedTintColors.map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => {
                          setSelectedTintPreview(color);
                          setTintPreviewOpen(true);
                        }}
                        className="rounded-xl border border-gray-200 bg-white p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/30"
                      >
                        <div className="flex items-center gap-3">
                          <span className="inline-block h-8 w-8 rounded-full border border-gray-200" style={{ backgroundColor: color.rgba }} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{color.name}</p>
                            <p className="text-xs text-gray-500 truncate">{color.id}</p>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                          <div>Hex：{color.hex}</div>
                          <div>透明度：{color.opacity}</div>
                          <div>加价：¥{color.surchargeYuan}</div>
                        </div>
                        <p className="mt-2 text-[11px] text-indigo-700">点击打开预览弹窗</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
              <div>
                <label className="block mb-1 text-xs font-medium text-gray-700">边缘增量校准系数（0.5～1.2，默认 0.78）</label>
                <input value={calibStr} onChange={(e) => setCalibStr(e.target.value)} className="w-full max-w-xs px-2 py-1.5 rounded-lg border border-indigo-200 bg-white" />
                <p className="text-[11px] text-indigo-900/80 mt-1">比焦度计/厂家明显偏厚 → 略调小；偏薄 → 略调大。只缩放 Δt，不动 CT。</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {!calc.ok ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium">当前参数未通过校验</p>
                <p className="mt-1">{calc.msg}</p>
                <p className="text-[11px] text-amber-800/90 mt-2">
                  右侧示意图与分眼数据已隐藏；下方「加工提案」区域始终可用，可继续点「一键复制」（优先复制上次成功结果，或复制本提示便于排查）。
                </p>
              </div>
            ) : null}
            {calc.ok ? (
              <>
                <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
                  <svg viewBox="0 0 520 240" className="w-full h-auto">
                    <rect x="1" y="1" width="518" height="238" rx="14" fill="#f8fafc" stroke="#e2e8f0" />
                    <ellipse cx="170" cy="105" rx="90" ry="58" fill="#dbeafe" stroke="#60a5fa" strokeWidth="2" />
                    <ellipse cx="350" cy="105" rx="90" ry="58" fill="#dbeafe" stroke="#60a5fa" strokeWidth="2" />
                    <path d="M260 105 Q260 92 260 105 Q260 118 260 105" stroke="#334155" strokeWidth="8" fill="none" />
                    <line x1="30" y1="105" x2="80" y2="105" stroke="#94a3b8" strokeWidth="5" />
                    <line x1="440" y1="105" x2="490" y2="105" stroke="#94a3b8" strokeWidth="5" />

                    <rect x={80 - calc.edgeOsTemporal * 2.8} y="54" width={Math.max(4, calc.edgeOsTemporal * 2.8)} height="102" fill="#0284c7" opacity="0.85" />
                    <rect x={260 - Math.max(4, calc.edgeOsNasal * 2.8)} y="54" width={Math.max(4, calc.edgeOsNasal * 2.8)} height="102" fill="#0369a1" opacity="0.85" />
                    <rect x="260" y="54" width={Math.max(4, calc.edgeOdNasal * 2.8)} height="102" fill="#0369a1" opacity="0.85" />
                    <rect x="440" y="54" width={Math.max(4, calc.edgeOdTemporal * 2.8)} height="102" fill="#0284c7" opacity="0.85" />

                    <rect
                      x={170 - Math.max(4, calc.edgeCheek * 2.8) / 2}
                      y="168"
                      width={Math.max(4, calc.edgeCheek * 2.8)}
                      height="10"
                      fill="#0d9488"
                      opacity="0.9"
                    />
                    <text x="170" y="214" textAnchor="middle" fill="#0f766e" fontSize="10" fontWeight="600">
                      颊侧（下缘）{calc.edgeCheek.toFixed(2)} mm
                    </text>

                    <text x="170" y="22" textAnchor="middle" fill="#334155" fontSize="12" fontWeight="600">左镜片（示意）</text>
                    <text x="350" y="22" textAnchor="middle" fill="#334155" fontSize="12" fontWeight="600">右镜片（示意）</text>
                    <text x="170" y="188" textAnchor="middle" fill="#475569" fontSize="11">
                      颞 {calc.edgeOsTemporal.toFixed(2)} mm · 鼻 {calc.edgeOsNasal.toFixed(2)} mm
                    </text>
                    <text x="350" y="188" textAnchor="middle" fill="#475569" fontSize="11">
                      鼻 {calc.edgeOdNasal.toFixed(2)} mm · 颞 {calc.edgeOdTemporal.toFixed(2)} mm
                    </text>
                  </svg>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 text-sm space-y-3">
                  <p className="text-xs font-semibold text-gray-700">分眼边缘厚（mm）</p>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl bg-white border border-violet-200 py-2 px-2">
                      <div className="text-[10px] text-violet-700 font-medium">右眼 OD · 颞</div>
                      <div className="text-lg font-bold text-sky-800">{calc.edgeOdTemporal.toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-white border border-violet-200 py-2 px-2">
                      <div className="text-[10px] text-violet-700 font-medium">右眼 OD · 鼻</div>
                      <div className="text-lg font-bold text-sky-800">{calc.edgeOdNasal.toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-white border border-indigo-200 py-2 px-2">
                      <div className="text-[10px] text-indigo-700 font-medium">左眼 OS · 颞</div>
                      <div className="text-lg font-bold text-sky-800">{calc.edgeOsTemporal.toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-white border border-indigo-200 py-2 px-2">
                      <div className="text-[10px] text-indigo-700 font-medium">左眼 OS · 鼻</div>
                      <div className="text-lg font-bold text-sky-800">{calc.edgeOsNasal.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white border border-teal-200 py-2 px-3 text-center">
                    <div className="text-xs text-gray-500">双眼镜圈 · 颊侧（下缘，屈光力同颞子午）</div>
                    <div className="text-xl font-bold text-teal-800">{calc.edgeCheek.toFixed(2)} mm</div>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1 border-t border-blue-100 pt-2">
                    <div>
                      FPD = A + DBL = <strong>{calc.fpd.toFixed(1)}</strong> mm；合计瞳距 PD<sub>OD</sub>+PD<sub>OS</sub>={' '}
                      <strong>{calc.pdSum.toFixed(1)}</strong> mm · 轴位 <strong>{calc.axis}°</strong>
                    </div>
                    <div>
                      移心参考 δ<sub>OD</sub>=FPD/2−PD<sub>OD</sub>=<strong>{calc.deltaOd.toFixed(2)}</strong> mm，δ<sub>OS</sub>=
                      <strong>{calc.deltaOs.toFixed(2)}</strong> mm
                    </div>
                    <div>
                      等效屈光力：颞/颊 <strong>{calc.FTemporal.toFixed(2)}</strong> D，鼻 <strong>{calc.FNasal.toFixed(2)}</strong> D
                    </div>
                    <div>
                      OD：y 颞 <strong>{calc.od.yTemporal.toFixed(2)}</strong> mm，y 鼻 <strong>{calc.od.yNasal.toFixed(2)}</strong> mm；OS：y 颞{' '}
                      <strong>{calc.os.yTemporal.toFixed(2)}</strong> mm，y 鼻 <strong>{calc.os.yNasal.toFixed(2)}</strong> mm；y 颊（半高）{' '}
                      <strong>{calc.yCheek.toFixed(2)}</strong> mm（镜圈高 {calc.bCheek.toFixed(1)} mm）
                      {calc.hasB ? '' : '，未填 B 时颞/鼻仅水平、颊用 0.72×A 估高'}
                    </div>
                    <div>校准系数 <strong>{calc.calib.toFixed(2)}</strong></div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600 space-y-2">
                  <div>
                    单眼瞳距不对称时，左右片水平移心量 δ 不同，颞/鼻有效半口径 y 分眼计算；示意图鼻梁处左为 OS 鼻厚、右为 OD 鼻厚。
                  </div>
                  <div>口语里常认为<strong>最厚在颞侧</strong>：颞 F=S+C·cos²α、鼻 F=S+C·sin²α（α 为处方轴位）。颊侧与颞侧同式屈光力、差在 y。边缘厚 = CT + 校准×Δt。</div>
                </div>

                {lensLibResult.ok ? (
                  <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-purple-900">周向环带示意（lensEdgeThickness + GlassesEdgeVisual）</h3>
                    <p className="text-[11px] text-purple-900/85 leading-relaxed">
                      与上方「校准颞/鼻」并行展示：本图来自公共库，柱镜按周向 cos²/sin² 混合，<strong>无数值校准系数</strong>；单眼瞳距分眼后左右环带宽度可不同。
                    </p>
                    <GlassesEdgeVisual
                      edMm={lensLibResult.data.ed}
                      fpdMm={lensLibResult.data.fpdMm}
                      pdOdMm={lensLibResult.data.pdOdMm}
                      pdOsMm={lensLibResult.data.pdOsMm}
                      os={{
                        yThinMm: lensLibResult.data.os.yThin,
                        yThickMm: lensLibResult.data.os.yThick,
                        e1Thick: lensLibResult.data.os.e1Thick,
                        e1Thin: lensLibResult.data.os.e1Thin,
                        e2Thick: lensLibResult.data.os.e2Thick,
                        e2Thin: lensLibResult.data.os.e2Thin,
                      }}
                      od={{
                        yThinMm: lensLibResult.data.od.yThin,
                        yThickMm: lensLibResult.data.od.yThick,
                        e1Thick: lensLibResult.data.od.e1Thick,
                        e1Thin: lensLibResult.data.od.e1Thin,
                        e2Thick: lensLibResult.data.od.e2Thick,
                        e2Thin: lensLibResult.data.od.e2Thin,
                      }}
                      ct={lensLibResult.data.ct}
                      n={lensLibResult.data.n}
                      minEdgeMm={lensLibResult.data.minEdge}
                      sphereD={lensLibResult.data.od.F1}
                      cylD={lensLibResult.data.od.F2 - lensLibResult.data.od.F1}
                      axis={lensLibResult.data.axis}
                      hasCyl={lensLibResult.data.hasCyl}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-purple-200 bg-purple-50/40 px-4 py-3 text-xs text-purple-900/80">
                    库内周向图未就绪："暂未就绪"
                  </div>
                )}
              </>
            ) : null}

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 space-y-2">
              {!calc.ok && lastGoodProposalRef.current ? (
                <p className="text-[11px] text-amber-900 leading-relaxed rounded-lg bg-amber-50/90 border border-amber-100 px-2.5 py-2">
                  参数已变化且未通过校验（{calc.msg}）。下方为<strong>上一次校验通过</strong>时的加工提案，复制前请确认是否仍适用。
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-emerald-900">加工提案（可复制）</h3>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const ok = await copyTextToClipboard(displayProposalText);
                      window.alert(ok ? '已复制到剪贴板' : '复制失败，请手动选中下方文字复制');
                    })();
                  }}
                  disabled={!displayProposalText}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 disabled:pointer-events-none"
                >
                  一键复制
                </button>
              </div>
              <pre className="text-[11px] leading-relaxed text-emerald-950 bg-white/80 border border-emerald-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                {displayProposalText}
              </pre>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-gray-800">
              {activeFeature === 'tint-lens' && '染色镜片列表'}
              {activeFeature === 'polarized-lens' && '偏光镜片列表'}
              {activeFeature === 'progressive-lens' && '渐进镜片'}
            </h2>
            <p className="mt-1 text-xs text-gray-600">数据来源：云端 `GET /api/lens/tint-colors/`，用于小程序与 Electron 统一配置。</p>
          </div>

          {activeFeature === 'progressive-lens' ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">渐进镜片内容后续补充。</div>
          ) : tintError && displayedTintColors.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">染色列表加载失败：{tintError}</div>
          ) : displayedTintColors.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">暂无可显示的颜色配置。</div>
          ) : (
            <div className="p-5 space-y-4">
              {selectedTintPreview ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="inline-block h-10 w-10 rounded-full border border-gray-200"
                        style={{ backgroundColor: selectedTintPreview.rgba }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{selectedTintPreview.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {selectedTintPreview.hex} · 透明度 {selectedTintPreview.opacity}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTintPreviewOpen(true)}
                      className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      放大预览
                    </button>
                  </div>
                  <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-4">
                    <div className="mx-auto flex max-w-sm items-center justify-center gap-4">
                      {[0, 1].map((idx) => {
                        const leftHalf = idx === 0;
                        const lensBg = tintCompareMode && leftHalf ? tintPreviewCss.clearLensBg : tintPreviewCss.tintedLensBg;
                        return (
                          <span
                            key={`inline-lens-${idx}`}
                            className="relative inline-block h-24 w-24 overflow-hidden rounded-full border-2 border-slate-300"
                            style={{ backgroundImage: lensBg }}
                          >
                            {tintGlossOn ? (
                              <>
                                <span
                                  className="absolute inset-0"
                                  style={{
                                    background:
                                      'linear-gradient(135deg, rgba(255,255,255,0.45) 12%, rgba(255,255,255,0.12) 38%, rgba(255,255,255,0.02) 62%)',
                                  }}
                                />
                                <span
                                  className="absolute left-2 top-2 h-6 w-5 -rotate-12 rounded-sm"
                                  style={{ background: 'rgba(255,255,255,0.35)' }}
                                />
                              </>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-gray-600">
                          <span>染色深度（Opacity）</span>
                          <span>{tintOpacityPct}%</span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={85}
                          step={1}
                          value={tintOpacityPct}
                          onChange={(e) => setTintOpacityPct(clamp(Number(e.target.value), 10, 85))}
                          className="w-full accent-indigo-600"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setTintToneMode('solid')}
                          className={`rounded-md border px-2.5 py-1 ${tintToneMode === 'solid' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                        >
                          纯色
                        </button>
                        <button
                          type="button"
                          onClick={() => setTintToneMode('gradient')}
                          className={`rounded-md border px-2.5 py-1 ${tintToneMode === 'gradient' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                        >
                          渐变
                        </button>
                        <button
                          type="button"
                          onClick={() => setTintCompareMode((v) => !v)}
                          className={`rounded-md border px-2.5 py-1 ${tintCompareMode ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                        >
                          {tintCompareMode ? '对比模式已开' : '对比模式'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTintGlossOn((v) => !v)}
                          className={`rounded-md border px-2.5 py-1 ${tintGlossOn ? 'border-sky-500 bg-sky-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                        >
                          {tintGlossOn ? '光泽已开' : '光泽已关'}
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-center text-xs text-gray-600">
                      加价：¥{selectedTintPreview.surchargeYuan} · SKU：{selectedTintPreview.materialSku || '未配置'}
                      {tintCompareMode ? ' · 左原色 / 右染色' : ''}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tintLoading ? (
                  <div className="sm:col-span-2 xl:col-span-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    正在同步云端染色配置，当前先展示本地预置列表。
                  </div>
                ) : null}
                {tintError ? (
                  <div className="sm:col-span-2 xl:col-span-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    云端同步失败，已自动回退本地预置列表：{tintError}
                  </div>
                ) : null}
                {displayedTintColors.map((color) => {
                  const active = selectedTintPreview?.id === color.id;
                  return (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => setSelectedTintPreview(color)}
                      className={`rounded-xl border bg-white p-3 text-left transition-colors ${
                        active
                          ? 'border-indigo-400 ring-2 ring-indigo-100'
                          : 'border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-block w-8 h-8 rounded-full border border-gray-200" style={{ backgroundColor: color.rgba }} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{color.name}</p>
                          <p className="text-xs text-gray-500 truncate">{color.id}</p>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                        <div>色值：{color.hex}</div>
                        <div>透明度：{color.opacity}</div>
                        <div>加价：¥{color.surchargeYuan}</div>
                        <div>SKU：{color.materialSku || '未配置'}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">点击任意颜色卡可立即切换上方镜片预览，支持云端与软件端。</p>
            </div>
          )}
        </div>
      )}
      {tintPreviewOpen && selectedTintPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-bold text-gray-800">染色放大预览</h3>
              <button
                type="button"
                onClick={() => setTintPreviewOpen(false)}
                className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
                aria-label="关闭预览"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="mx-auto flex max-w-md items-center justify-center gap-6 rounded-xl border border-gray-200 bg-slate-50 p-6">
                {[0, 1].map((idx) => {
                  const leftHalf = idx === 0;
                  const lensBg = tintCompareMode && leftHalf ? tintPreviewCss.clearLensBg : tintPreviewCss.tintedLensBg;
                  return (
                    <span
                      key={`modal-lens-${idx}`}
                      className="relative inline-block h-32 w-32 overflow-hidden rounded-full border-2 border-slate-300"
                      style={{ backgroundImage: lensBg }}
                    >
                      {tintGlossOn ? (
                        <>
                          <span
                            className="absolute inset-0"
                            style={{
                              background:
                                'linear-gradient(135deg, rgba(255,255,255,0.46) 12%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.02) 64%)',
                            }}
                          />
                          <span
                            className="absolute left-4 top-3 h-9 w-7 -rotate-12 rounded-sm"
                            style={{ background: 'rgba(255,255,255,0.35)' }}
                          />
                        </>
                      ) : null}
                    </span>
                  );
                })}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                    <span>染色深度（Opacity）</span>
                    <span>{tintOpacityPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={85}
                    step={1}
                    value={tintOpacityPct}
                    onChange={(e) => setTintOpacityPct(clamp(Number(e.target.value), 10, 85))}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setTintToneMode('solid')}
                    className={`rounded-md border px-2.5 py-1 ${tintToneMode === 'solid' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    纯色
                  </button>
                  <button
                    type="button"
                    onClick={() => setTintToneMode('gradient')}
                    className={`rounded-md border px-2.5 py-1 ${tintToneMode === 'gradient' ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    渐变
                  </button>
                  <button
                    type="button"
                    onClick={() => setTintCompareMode((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 ${tintCompareMode ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    {tintCompareMode ? '对比模式已开' : '对比模式'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTintGlossOn((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 ${tintGlossOn ? 'border-sky-500 bg-sky-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    {tintGlossOn ? '光泽已开' : '光泽已关'}
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <div>颜色：{selectedTintPreview.name}</div>
                <div>Hex：{selectedTintPreview.hex}</div>
                <div>透明度：{tintOpacityPct}%</div>
                <div>模式：{tintToneMode === 'gradient' ? '渐变' : '纯色'}{tintCompareMode ? '（左右对比）' : ''}</div>
                <div>加价：¥{selectedTintPreview.surchargeYuan}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
