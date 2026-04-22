'use client';

import { useId, useMemo } from 'react';
import {
  edgeThicknessAtAngleMm,
  edgeThicknessMm,
  perpendicularAxisDeg,
  thickSideHorizontalBlend,
} from '@/lib/lensEdgeThickness';

const VIEW_W = 420;
const VIEW_H = 200;
const LEFT_CX = 118;
const RIGHT_CX = 302;
const CY = 118;
const RIM_STEPS = 80;
/** 周向边缘厚映射到像素：Training 对比增强（mm 差很小时纯线性放大在屏上看不见） */
const RIM_PX_MIN = 2.5;
const RIM_PX_SPAN = 16;

function polarPoint(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const t = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(t), y: cy - r * Math.sin(t) };
}

/** 正视图：0°=右眼颞侧朝右；左片镜像使左右「颞/鼻」与患者一致 */
function patientAngleDegFromRim(cx: number, cy: number, px0: number, py0: number, isLeftLens: boolean): number {
  let deg = (Math.atan2(-(py0 - cy), px0 - cx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  if (isLeftLens) deg = (deg + 180) % 360;
  return deg;
}

function ellipseOutwardNormal(cx: number, cy: number, rx: number, ry: number, px0: number, py0: number) {
  const gx = (px0 - cx) / (rx * rx);
  const gy = (py0 - cy) / (ry * ry);
  const nlen = Math.hypot(gx, gy) || 1;
  return { nx: gx / nlen, ny: gy / nlen };
}

function rimThicknessMmAtStep(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  isLeftLens: boolean,
  stepIndex: number,
  steps: number,
  yThinMm: number,
  yThickMm: number,
  ct: number,
  indexN: number,
  minEdgeMm: number,
  sphereD: number,
  cylD: number,
  cylinderAxisDeg: number,
  hasCyl: boolean,
): { px0: number; py0: number; nx: number; ny: number; eMm: number } {
  const t = (stepIndex / steps) * 2 * Math.PI;
  const px0 = cx + rx * Math.cos(t);
  const py0 = cy - ry * Math.sin(t);
  const { nx, ny } = ellipseOutwardNormal(cx, cy, rx, ry, px0, py0);
  const ang = patientAngleDegFromRim(cx, cy, px0, py0, isLeftLens);
  const blend = thickSideHorizontalBlend(isLeftLens, ang);
  const yMm = yThinMm + (yThickMm - yThinMm) * blend;
  const eOnAxis = edgeThicknessMm(ct, sphereD, yMm, indexN, minEdgeMm);
  const ePerp = edgeThicknessMm(ct, sphereD + cylD, yMm, indexN, minEdgeMm);
  const eMix = hasCyl ? edgeThicknessAtAngleMm(eOnAxis, ePerp, cylinderAxisDeg, ang) : eOnAxis;
  return { px0, py0, nx, ny, eMm: eMix };
}

/**
 * 两趟：先采周向各点真实边缘厚(mm)，再按 min～max 线性映射到像素，瞳距引起的颞/鼻差再小也能看出走向。
 */
function buildEllipseRimPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  isLeftLens: boolean,
  yThinMm: number,
  yThickMm: number,
  ct: number,
  indexN: number,
  minEdgeMm: number,
  sphereD: number,
  cylD: number,
  cylinderAxisDeg: number,
  hasCyl: boolean,
  steps: number,
): string {
  const buf: { px0: number; py0: number; nx: number; ny: number; eMm: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    buf.push(
      rimThicknessMmAtStep(
        cx,
        cy,
        rx,
        ry,
        isLeftLens,
        i,
        steps,
        yThinMm,
        yThickMm,
        ct,
        indexN,
        minEdgeMm,
        sphereD,
        cylD,
        cylinderAxisDeg,
        hasCyl,
      ),
    );
  }
  const eVals = buf.map((b) => b.eMm);
  const eMin = Math.min(...eVals);
  const eMax = Math.max(...eVals);
  const range = eMax - eMin;
  const eps = 0.02;

  const pts: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const { px0, py0, nx, ny, eMm } = buf[i];
    const t = range < eps ? 0.5 : (eMm - eMin) / (range + eps);
    const thickPx = RIM_PX_MIN + t * RIM_PX_SPAN;
    const px = px0 + nx * thickPx;
    const py = py0 + ny * thickPx;
    pts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  return `${pts.join(' ')} Z`;
}

/** 正视示意：左片 OS、右片 OD；单眼瞳距与 FPD/2 差映射到光学中心相对镜圈几何中心的平移 */
function opticalCentersXMonocular(fpdMm: number, pdOsMm: number, pdOdMm: number): { ocXL: number; ocXR: number } {
  const span = RIGHT_CX - LEFT_CX;
  if (!(fpdMm > 0)) return { ocXL: LEFT_CX, ocXR: RIGHT_CX };
  const tL = (fpdMm / 2 - pdOsMm) / fpdMm;
  const tR = (fpdMm / 2 - pdOdMm) / fpdMm;
  return {
    ocXL: LEFT_CX + tL * span,
    ocXR: RIGHT_CX - tR * span,
  };
}

function lensRxFromEd(edMm: number): number {
  return Math.min(72, Math.max(44, 52 + (edMm - 70) * 0.28));
}

/** 单眼镜片环带 y 与主子午线边缘厚（单位 mm，对齐 lensEdgeThickness 分眼结果） */
export type GlassesEyeRimMetrics = {
  yThinMm: number;
  yThickMm: number;
  e1Thick: number;
  e1Thin: number;
  e2Thick: number;
  e2Thin: number;
};

export type GlassesEdgeVisualProps = {
  edMm: number;
  fpdMm: number;
  pdOdMm: number;
  pdOsMm: number;
  os: GlassesEyeRimMetrics;
  od: GlassesEyeRimMetrics;
  ct: number;
  n: number;
  minEdgeMm: number;
  sphereD: number;
  cylD: number;
  axis: number;
  hasCyl: boolean;
};

export function GlassesEdgeVisual({
  edMm,
  fpdMm,
  pdOdMm,
  pdOsMm,
  os,
  od,
  ct,
  n,
  minEdgeMm,
  sphereD,
  cylD,
  axis,
  hasCyl,
}: GlassesEdgeVisualProps) {
  const uid = useId().replace(/:/g, '');
  const gradGlass = `lensGlass-${uid}`;
  const gradEdge = `edgeThick-${uid}`;

  const rx = lensRxFromEd(edMm);
  const ry = rx * 0.86;
  const leftCx = LEFT_CX;
  const rightCx = RIGHT_CX;
  const cy = CY;
  const pdSumMm = pdOdMm + pdOsMm;
  const { ocXL, ocXR } = opticalCentersXMonocular(fpdMm, pdOsMm, pdOdMm);
  const axisB = perpendicularAxisDeg(axis);

  const { dOuterL, dOuterR } = useMemo(
    () => ({
      dOuterL: buildEllipseRimPath(
        leftCx,
        cy,
        rx,
        ry,
        true,
        os.yThinMm,
        os.yThickMm,
        ct,
        n,
        minEdgeMm,
        sphereD,
        cylD,
        axis,
        hasCyl,
        RIM_STEPS,
      ),
      dOuterR: buildEllipseRimPath(
        rightCx,
        cy,
        rx,
        ry,
        false,
        od.yThinMm,
        od.yThickMm,
        ct,
        n,
        minEdgeMm,
        sphereD,
        cylD,
        axis,
        hasCyl,
        RIM_STEPS,
      ),
    }),
    [
      leftCx,
      rightCx,
      cy,
      rx,
      ry,
      os.yThinMm,
      os.yThickMm,
      od.yThinMm,
      od.yThickMm,
      ct,
      n,
      minEdgeMm,
      sphereD,
      cylD,
      axis,
      hasCyl,
    ],
  );

  const nasalL = polarPoint(leftCx, cy, rx + 8, 180);
  const temporalR = polarPoint(rightCx, cy, rx + 8, 0);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full max-w-3xl h-auto drop-shadow-sm"
      aria-label="眼镜边缘厚度示意图"
    >
      <defs>
        <linearGradient id={gradGlass} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="50%" stopColor="#f0f9ff" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
        <linearGradient id={gradEdge} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill="#f8fafc" rx="12" />

      <path
        d="M 28 118 L 52 118 M 368 118 L 392 118"
        stroke="#94a3b8"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <path
        d={`M ${leftCx + rx + 6} ${cy} Q 210 ${cy - 18} ${rightCx - rx - 6} ${cy}`}
        fill="none"
        stroke="#475569"
        strokeWidth="7"
        strokeLinecap="round"
      />

      <g>
        <path d={dOuterL} fill={`url(#${gradEdge})`} opacity={0.94} />
        <ellipse cx={leftCx} cy={cy} rx={rx} ry={ry} fill={`url(#${gradGlass})`} stroke="#7dd3fc" strokeWidth="1.2" />
      </g>
      <g>
        <path d={dOuterR} fill={`url(#${gradEdge})`} opacity={0.94} />
        <ellipse cx={rightCx} cy={cy} rx={rx} ry={ry} fill={`url(#${gradGlass})`} stroke="#7dd3fc" strokeWidth="1.2" />
      </g>

      <g opacity={0.65}>
        <circle cx={leftCx} cy={cy} r="3.5" fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="2 2" />
        <circle cx={rightCx} cy={cy} r="3.5" fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="2 2" />
        <text x={leftCx} y={cy + ry + 8} textAnchor="middle" fill="#64748b" style={{ fontSize: '6px' }}>
          镜圈几何中心
        </text>
        <text x={rightCx} y={cy + ry + 8} textAnchor="middle" fill="#64748b" style={{ fontSize: '6px' }}>
          镜圈几何中心
        </text>
      </g>

      <path d={`M ${ocXL} ${cy} L ${ocXR} ${cy}`} stroke="#6366f1" strokeWidth="1.8" strokeDasharray="5 4" opacity={0.85} />
      <circle cx={ocXL} cy={cy} r="5" fill="#eef2ff" stroke="#4f46e5" strokeWidth="1.8" />
      <circle cx={ocXR} cy={cy} r="5" fill="#eef2ff" stroke="#4f46e5" strokeWidth="1.8" />
      <path d={`M ${ocXL - 4} ${cy} L ${ocXL + 4} ${cy} M ${ocXL} ${cy - 4} L ${ocXL} ${cy + 4}`} stroke="#312e81" strokeWidth="1" />
      <path d={`M ${ocXR - 4} ${cy} L ${ocXR + 4} ${cy} M ${ocXR} ${cy - 4} L ${ocXR} ${cy + 4}`} stroke="#312e81" strokeWidth="1" />
      <text x={(ocXL + ocXR) / 2} y={cy - 18} textAnchor="middle" fill="#4338ca" style={{ fontSize: '7px', fontWeight: 600 }}>
        合计远用 PD {pdSumMm.toFixed(1)} mm（OD {pdOdMm.toFixed(1)} + OS {pdOsMm.toFixed(1)}）
      </text>
      <text x={(ocXL + ocXR) / 2} y={cy - 8} textAnchor="middle" fill="#4338ca" style={{ fontSize: '7px' }}>
        光学中心按单眼瞳距分眼平移示意
      </text>

      {hasCyl && (
        <g stroke="#c2410c" strokeWidth="1.2" opacity={0.85}>
          <line
            x1={ocXL - Math.cos((axis * Math.PI) / 180) * (rx - 4)}
            y1={cy + Math.sin((axis * Math.PI) / 180) * (ry - 4)}
            x2={ocXL + Math.cos((axis * Math.PI) / 180) * (rx - 4)}
            y2={cy - Math.sin((axis * Math.PI) / 180) * (ry - 4)}
          />
          <line
            x1={ocXR - Math.cos((axis * Math.PI) / 180) * (rx - 4)}
            y1={cy + Math.sin((axis * Math.PI) / 180) * (ry - 4)}
            x2={ocXR + Math.cos((axis * Math.PI) / 180) * (rx - 4)}
            y2={cy - Math.sin((axis * Math.PI) / 180) * (ry - 4)}
          />
          <text x={ocXL} y={cy - ry - 28} textAnchor="middle" fill="#9a3412" style={{ fontSize: '7px', fontWeight: 600 }}>
            OS 厚 S {os.e1Thick.toFixed(2)} / 薄 {os.e1Thin.toFixed(2)} mm
          </text>
          <text x={ocXL} y={cy - ry - 17} textAnchor="middle" fill="#9a3412" style={{ fontSize: '7px', fontWeight: 600 }}>
            OS 厚 S+C {os.e2Thick.toFixed(2)} / 薄 {os.e2Thin.toFixed(2)} mm
          </text>
          <text x={ocXR} y={cy - ry - 28} textAnchor="middle" fill="#9a3412" style={{ fontSize: '7px', fontWeight: 600 }}>
            OD 厚 S {od.e1Thick.toFixed(2)} / 薄 {od.e1Thin.toFixed(2)} mm
          </text>
          <text x={ocXR} y={cy - ry - 17} textAnchor="middle" fill="#9a3412" style={{ fontSize: '7px', fontWeight: 600 }}>
            OD 厚 S+C {od.e2Thick.toFixed(2)} / 薄 {od.e2Thin.toFixed(2)} mm
          </text>
          <text x={(ocXL + ocXR) / 2} y={cy + ry + 26} textAnchor="middle" fill="#9a3412" style={{ fontSize: '8px' }}>
            轴 {axis}° / {axisB}°
          </text>
        </g>
      )}

      {!hasCyl && (
        <>
          <text x={ocXL} y={cy + ry + 22} textAnchor="middle" fill="#475569" style={{ fontSize: '8px' }}>
            OS 球镜 · 厚 {os.e1Thick.toFixed(2)} · 薄 {os.e1Thin.toFixed(2)} mm
          </text>
          <text x={ocXR} y={cy + ry + 22} textAnchor="middle" fill="#475569" style={{ fontSize: '8px' }}>
            OD 球镜 · 厚 {od.e1Thick.toFixed(2)} · 薄 {od.e1Thin.toFixed(2)} mm
          </text>
        </>
      )}

      <text x={nasalL.x} y={nasalL.y + 4} textAnchor="middle" fill="#64748b" style={{ fontSize: '8px' }}>
        鼻侧
      </text>
      <text x={temporalR.x} y={temporalR.y + 4} textAnchor="middle" fill="#64748b" style={{ fontSize: '8px' }}>
        颞侧
      </text>

      <text x="210" y="24" textAnchor="middle" fill="#334155" style={{ fontSize: '11px', fontWeight: 600 }}>
        环带：周向按边缘厚 min～max 映射宽度（培训易辨认；mm 以右侧表为准）
      </text>
      <text x="210" y="192" textAnchor="middle" fill="#64748b" style={{ fontSize: '7px' }}>
        OS y厚 {os.yThickMm.toFixed(2)} y薄 {os.yThinMm.toFixed(2)} mm · OD y厚 {od.yThickMm.toFixed(2)} y薄 {od.yThinMm.toFixed(2)} mm · 框距{' '}
        {fpdMm.toFixed(1)}
      </text>
    </svg>
  );
}
