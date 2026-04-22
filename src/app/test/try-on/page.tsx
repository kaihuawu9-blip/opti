'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Matrix4 } from 'three';
import { Home, Sun } from 'lucide-react';
import { fetchLensTintConfigClient } from '@/lib/fittingbox/lensTintConfigClient';
import { DEFAULT_LENS_TINT_PRESETS, type LensTintPreset } from '@/lib/fittingbox/lensTintPresets';
import {
  detectRedMarkerBlobsFromRgba,
  loadCalibrationSampleRgba,
  markerBlobsToPupilFrame,
} from '@/lib/measure/redMarkerCalibrateClient';
import { TryOnR3FCanvas } from '@/app/test/try-on/TryOnR3FCanvas';
import type { TryOnR3fPose } from '@/app/test/try-on/tryOnPoseBridge';

type FaceLandmarkerLike = {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): {
    faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
    facialTransformationMatrixes?: Array<{ rows: number; columns: number; data: number[] }>;
  };
  close?: () => void;
};

type LensRegion = { cx: number; cy: number; rx: number; ry: number; area: number };
type ProcessedFrame = { canvas: HTMLCanvasElement; width: number; height: number; lensRegions: LensRegion[] };
type LiveMeasurePanel = {
  pdPx: number | null;
  pdMm: number | null;
  phPx: number | null;
  phMm: number | null;
  updatedAt: string;
};
type CameraDiag = {
  width: number;
  height: number;
  fps: number;
  facing: string;
};
type CalibrationResponse = {
  ok: boolean;
  sample?: string;
  pd?: { pd_px?: number; pd_mm?: number };
  qwenVl?: {
    provider?: string;
    source?: string;
    structured?: Record<string, unknown>;
    rawText?: string;
    error?: string;
  };
  debug?: Record<string, unknown>;
  error?: string;
};

const CALIBRATION_SAMPLE_FILES = ['glasses-front.svg', 'glasses-left-tilt.svg', 'glasses-right-tilt.svg'] as const;

/** 与 package.json 中 @mediapipe/tasks-vision 一致，便于 Nginx /mp-proxy/jsdelivr-wasm/ 固定上游版本 */
const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.34';

/** 生产域名走 Nginx 同源反代，避免外网直连 Google / jsDelivr 被拦截 */
function resolveMediapipeWasmBaseUrl(): string {
  if (typeof window === 'undefined') {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
  }
  const { protocol, hostname, port } = window.location;
  if (hostname === 'www.opti-ai.cn' || hostname === 'opti-ai.cn') {
    return `${protocol}//${hostname}${port ? `:${port}` : ''}/mp-proxy/jsdelivr-wasm/`;
  }
  return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
}

function resolveFaceLandmarkerModelUrl(): string {
  if (typeof window === 'undefined') {
    return 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  }
  const { protocol, hostname, port } = window.location;
  if (hostname === 'www.opti-ai.cn' || hostname === 'opti-ai.cn') {
    return `${protocol}//${hostname}${port ? `:${port}` : ''}/mp-proxy/gcs/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
  }
  return 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
}

function toCanvasLoadUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url, window.location.href);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttp) return parsed.toString();
    const sameOrigin = parsed.origin === window.location.origin;
    if (sameOrigin) return parsed.toString();
    return `/api/proxy-image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

/** 仅对真正的跨域 http(s) 设 CORS；blob/data 上设 anonymous 会导致部分浏览器（尤其 Safari）不解码 */
function applyImgCrossOrigin(img: HTMLImageElement, resolvedUrl: string) {
  img.removeAttribute('crossorigin');
  if (typeof window === 'undefined') return;
  if (resolvedUrl.startsWith('blob:') || resolvedUrl.startsWith('data:')) return;
  if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) return;
  try {
    const u = new URL(resolvedUrl, window.location.href);
    if (u.origin !== window.location.origin) img.crossOrigin = 'anonymous';
  } catch {
    /* ignore */
  }
}

/** 让 React 有机会把「处理中」文案刷到屏上，再跑同步抠图（否则会长时间像卡死） */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/u.test(normalized)) return [79, 127, 168];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

/** 沿四边采样估计背景色（比四角更稳，减少渐变背景误判） */
function averageBorderColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const step = Math.max(2, Math.floor(Math.min(w, h) / 64));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  };
  for (let x = 2; x < w - 2; x += step) {
    push(x, 2);
    push(x, h - 3);
  }
  for (let y = 2; y < h - 2; y += step) {
    push(2, y);
    push(w - 3, y);
  }
  if (n < 1) return [255, 255, 255];
  return [r / n, g / n, b / n];
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 对 alpha 通道做 3×3 盒式羽化，柔化抠图边缘 */
function featherAlphaChannel(data: Uint8ClampedArray, w: number, h: number): void {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = ((y + dy) * w + (x + dx)) * 4 + 3;
          a += copy[j];
        }
      }
      const i = (y * w + x) * 4 + 3;
      data[i] = Math.round(a / 9);
    }
  }
}

/** 四角 + 四边中点采样，用于多背景色（桌面/白墙混合） */
function sampleBorderPalette(data: Uint8ClampedArray, w: number, h: number): Array<[number, number, number]> {
  const pts: Array<[number, number]> = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
    [Math.floor(w / 2), 2],
    [Math.floor(w / 2), h - 3],
    [2, Math.floor(h / 2)],
    [w - 3, Math.floor(h / 2)],
  ];
  return pts.map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
  });
}

function minDistToPalette(r: number, g: number, b: number, palette: Array<[number, number, number]>): number {
  let m = Infinity;
  for (const [pr, pg, pb] of palette) {
    const t = Math.hypot(r - pr, g - pg, b - pb);
    if (t < m) m = t;
  }
  return m;
}

/** 与背景同色且与图像外缘连通 → 整块去掉（桌面、支架等）；高饱和度区域不泛洪，避免穿过镜腿彩色段 */
function floodEdgeSimilarMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  floodDistMax: number,
  palette: Array<[number, number, number]>,
  maxChromaForFlood: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qt = 0;
  const maybeBgAt = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.hypot(r - lum, g - lum, b - lum);
    if (chroma > maxChromaForFlood) return false;
    const dist = minDistToPalette(r, g, b, palette);
    return dist < floodDistMax;
  };
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (mask[p]) return;
    if (!maybeBgAt(x, y)) return;
    mask[p] = 1;
    qx[qt] = x;
    qy[qt] = y;
    qt += 1;
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  let qh = 0;
  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    qh += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return mask;
}

/** 去掉面积过小的不透明碎块（反光点、杂物） */
function removeSmallOpaqueBlobs(data: Uint8ClampedArray, w: number, h: number, minPixels: number): void {
  const seen = new Uint8Array(w * h);
  const buf = new Int32Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = idx(x, y);
      if (seen[p]) continue;
      if (data[p * 4 + 3] < 42) {
        seen[p] = 1;
        continue;
      }
      let sz = 0;
      buf[sz] = p;
      seen[p] = 1;
      sz = 1;
      for (let i = 0; i < sz; i += 1) {
        const cur = buf[i];
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = idx(nx, ny);
          if (seen[np]) continue;
          if (data[np * 4 + 3] < 42) {
            seen[np] = 1;
            continue;
          }
          seen[np] = 1;
          buf[sz] = np;
          sz += 1;
        }
      }
      if (sz < minPixels) {
        for (let i = 0; i < sz; i += 1) {
          const q = buf[i];
          data[q * 4 + 3] = 0;
        }
      }
    }
  }
}

/**
 * 商品镜框图去背景：色板最近色距 + 饱和度保护 + 与边缘连通的背景泛洪 + 小碎片剔除
 */
function removeFrameBackground(image: HTMLImageElement, options?: { maxWidth?: number }): HTMLCanvasElement {
  const maxWidth = options?.maxWidth ?? 1024;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const palette = sampleBorderPalette(d, w, h);
  const [br, bg, bb] = averageBorderColor(d, w, h);
  palette.push([br, bg, bb]);
  const bgLum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
  const distThreshold = bgLum > 138 ? 58 : 44;
  const low = distThreshold * 0.48;
  const high = distThreshold * 1.78;
  const floodDist = bgLum > 138 ? 44 : 34;
  const bgChroma = Math.hypot(br - bgLum, bg - bgLum, bb - bgLum);
  const edgeBg = floodEdgeSimilarMask(d, w, h, floodDist, palette, 44);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const i = p * 4;
      const dist = minDistToPalette(d[i], d[i + 1], d[i + 2], palette);
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const chroma = Math.hypot(d[i] - lum, d[i + 1] - lum, d[i + 2] - lum);
      const chromaBoost = chroma > bgChroma + 24 ? 0.1 : 0;
      let keep = smoothStep(low, high * (1 + chromaBoost), dist);
      if (edgeBg[p]) {
        const hard = chroma < 34 && lum > bgLum - 48 ? 0.992 : 0.82;
        keep *= 1 - hard;
      }
      d[i + 3] = Math.round(d[i + 3] * keep);
    }
  }
  const minBlob = Math.max(260, Math.floor((w * h) / 720));
  removeSmallOpaqueBlobs(d, w, h, minBlob);
  featherAlphaChannel(d, w, h);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 裁掉全透明边距，避免整块矩形画布盖在脸上 */
function cropCanvasToOpaqueBounds(src: HTMLCanvasElement, pad = 3): HTMLCanvasElement {
  const ctx = src.getContext('2d');
  if (!ctx) return src;
  const { width: w, height: h } = src;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4 + 3] > 18) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return src;
  const croppedArea = (maxX - minX + 1) * (maxY - minY + 1);
  if (croppedArea < w * h * 0.035) return src;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return src;
  octx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/** 识别镜框空洞（透明 / 半透明内孔，不连到边界）；支持宽松模式以适配实拍无透明通道的镜片 */
function detectLensHoles(
  frameCanvas: HTMLCanvasElement,
  opts?: { opaqueFloor?: number; minArea?: number },
): LensRegion[] {
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return [];
  const { width: w, height: h } = frameCanvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const visited = new Uint8Array(w * h);
  const holes: LensRegion[] = [];
  const opaqueFloor = opts?.opaqueFloor ?? 24;
  const minArea = opts?.minArea ?? Math.max(40, Math.floor(w * h * 0.0011));
  const idx = (x: number, y: number) => y * w + x;
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const root = idx(x, y);
      if (visited[root]) continue;
      const a = d[root * 4 + 3];
      if (a > opaqueFloor) {
        visited[root] = 1;
        continue;
      }
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;
      visited[root] = 1;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let touchesBorder = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head += 1;
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = idx(nx, ny);
          if (visited[ni]) continue;
          visited[ni] = 1;
          if (d[ni * 4 + 3] > opaqueFloor) continue;
          if (nx === 0 || ny === 0 || nx === w - 1 || ny === h - 1) touchesBorder = true;
          qx[tail] = nx;
          qy[tail] = ny;
          tail += 1;
        }
      }
      if (!touchesBorder && area >= minArea) {
        holes.push({
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          rx: Math.max(16, (maxX - minX) / 2),
          ry: Math.max(14, (maxY - minY) / 2),
          area,
        });
      }
    }
  }
  holes.sort((a, b) => b.area - a.area);
  return holes.slice(0, 2);
}

type Letterbox = { ox: number; oy: number; dw: number; dh: number; vw: number; vh: number };

/** 将摄像头画面等比放大裁切铺满 cw×ch（无黑边），返回映射与 canvas 像素一致 */
function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cw: number,
  ch: number,
): Letterbox | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.max(cw / vw, ch / vh);
  const dw = vw * s;
  const dh = vh * s;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(video, 0, 0, vw, vh, ox, oy, dw, dh);
  return { ox, oy, dw, dh, vw, vh };
}

function normToLetterbox(
  nx: number,
  ny: number,
  lb: Letterbox,
  mirrorX: boolean,
): { x: number; y: number } {
  const xn = mirrorX ? 1 - nx : nx;
  return { x: lb.ox + xn * lb.dw, y: lb.oy + ny * lb.dh };
}

type FaceOverlayPose = {
  yaw: number;
  pitch: number;
  roll: number;
  /** 预览 canvas 像素：两眼中点（镜架桥参考） */
  cx: number;
  cy: number;
  /** 瞳距在预览上的像素长度，用于把商品图缩放到与脸成比例 */
  ipdPx: number;
};

/** 预览像素系下的左右眼中心（与 normToLetterbox(mirrorX) 一致），用于实拍镜片叠色 */
type LiveEyesCanvas = {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  roll: number;
  ipdPx: number;
};

/**
 * 在摄像头预览坐标上叠半透明镜片色（不依赖商品抠图的镜片洞），便于「本人已戴眼镜」仍能看到变色。
 * 画在虚拟镜框贴纸之上，避免贴纸挡住真实镜片区域。
 */
function drawLiveLensTintOverlay(
  ctx: CanvasRenderingContext2D,
  eyes: LiveEyesCanvas,
  hex: string,
  opacity: number,
): void {
  const [r, g, b] = hexToRgb(hex);
  const alpha = clamp(opacity, 0.06, 0.88);
  const rx = Math.max(20, eyes.ipdPx * 0.46);
  const ry = Math.max(16, eyes.ipdPx * 0.32);
  const drawLens = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((eyes.roll * Math.PI) / 180);
    const grd = ctx.createRadialGradient(
      -rx * 0.18,
      -ry * 0.12,
      Math.max(5, rx * 0.06),
      0,
      0,
      Math.max(rx, ry) * 1.08,
    );
    grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.42).toFixed(3)})`);
    grd.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.58).toFixed(3)})`);
    grd.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.2).toFixed(3)})`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${(0.12 + alpha * 0.22).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, rx * 0.035);
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.08, rx * 0.62, ry * 0.38, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
  };
  drawLens(eyes.lx, eyes.ly);
  drawLens(eyes.rx, eyes.ry);
}

/**
 * 用 MediaPipe 关键点估计姿态；坐标已映射到「cover 铺满后」的预览像素。
 * 前置自拍默认 mirrorX：与常见手机预览左右一致。
 */
function estimateFaceOverlayPose(
  landmarks: Array<{ x: number; y: number; z: number }>,
  lb: Letterbox,
  mirrorX: boolean,
): FaceOverlayPose | null {
  const n = landmarks.length;
  const leftLm = n > 473 && landmarks[468] ? landmarks[468] : landmarks[33];
  const rightLm = n > 473 && landmarks[473] ? landmarks[473] : landmarks[263];
  const nose = landmarks[1];
  const chin = landmarks[152];
  if (!leftLm || !rightLm || !nose || !chin) return null;
  const mx = (lm: { x: number; y: number }) => (mirrorX ? 1 - lm.x : lm.x);
  const le = normToLetterbox(leftLm.x, leftLm.y, lb, mirrorX);
  const re = normToLetterbox(rightLm.x, rightLm.y, lb, mirrorX);
  const noseV = normToLetterbox(nose.x, nose.y, lb, mirrorX);
  const chinV = normToLetterbox(chin.x, chin.y, lb, mirrorX);
  const eyeMidNx = (mx(leftLm) + mx(rightLm)) / 2;
  const eyeMidNy = (leftLm.y + rightLm.y) / 2;
  const eyeDxN = mx(rightLm) - mx(leftLm);
  const eyeDyN = rightLm.y - leftLm.y;
  const eyeDistN = Math.max(1e-6, Math.hypot(eyeDxN, eyeDyN));
  const roll = clamp((Math.atan2(re.y - le.y, re.x - le.x) * 180) / Math.PI, -55, 55);
  const yaw = clamp(((mx(nose) - eyeMidNx) / eyeDistN) * 118, -50, 50);
  const noseToChinN = Math.max(1e-6, chin.y - eyeMidNy);
  const pitch = clamp((0.46 - (nose.y - eyeMidNy) / noseToChinN) * 118, -36, 36);
  const ipdPx = Math.max(4, Math.hypot(re.x - le.x, re.y - le.y));
  const cx = (le.x + re.x) / 2;
  const cy = (le.y + re.y) / 2 * 0.52 + noseV.y * 0.48;
  return { yaw, pitch, roll, cx, cy, ipdPx };
}

/** 仅旋转+缩放+轻微透视分量；平移由外层 translate(鼻梁中心) 与 translate(-镜框中心) 承担，减轻漂移感 */
/** MediaPipe 4×4 行主序扁平数组 → Three.js 列主序 Matrix4 */
function matrix4FromMediaPipeRowMajor(data: number[]): Matrix4 {
  const d = data;
  if (!d || d.length < 16) return new Matrix4();
  return new Matrix4().set(
    d[0],
    d[4],
    d[8],
    d[12],
    d[1],
    d[5],
    d[9],
    d[13],
    d[2],
    d[6],
    d[10],
    d[14],
    d[3],
    d[7],
    d[11],
    d[15],
  );
}

export default function TryOnTestPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameOverlay2dCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const r3fDomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const r3fPoseRef = useRef<TryOnR3fPose | null>(null);
  const [shellSize, setShellSize] = useState({ w: 0, h: 0 });
  const detectorRef = useRef<FaceLandmarkerLike | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTsRef = useRef(-1);
  const lastPreviewSizeKeyRef = useRef('');
  const frameDataRef = useRef<ProcessedFrame | null>(null);
  const lastCashierDraftRawRef = useRef('');
  const smoothPoseRef = useRef({
    yaw: 0,
    pitch: 0,
    roll: 0,
    cx: 180,
    cy: 220,
    ipdPx: 78,
  });
  const lastLiveEyesRef = useRef<LiveEyesCanvas | null>(null);
  const tintRenderRef = useRef({ hex: '#4f7fa8', opacity: 0.35 });
  const enable3DRef = useRef(false);

  const [lensOpacity, setLensOpacity] = useState(0.35);
  const [enable3D, setEnable3D] = useState(false);
  enable3DRef.current = enable3D;
  const [tintColors, setTintColors] = useState<LensTintPreset[]>(DEFAULT_LENS_TINT_PRESETS);
  const [selectedTintId, setSelectedTintId] = useState(DEFAULT_LENS_TINT_PRESETS[0]?.id ?? 'clear');
  const [frameImageUrl, setFrameImageUrl] = useState('');
  const [poseText, setPoseText] = useState('yaw 0° / pitch 0° / roll 0°');
  const [frameStatus, setFrameStatus] = useState('请上传镜框图或点击“读取收银台草稿”');
  const [calibrationSample, setCalibrationSample] = useState<(typeof CALIBRATION_SAMPLE_FILES)[number]>(
    'glasses-front.svg',
  );
  const [calibrationPxPerMm, setCalibrationPxPerMm] = useState(4);
  const calibrationPxPerMmRef = useRef(4);
  calibrationPxPerMmRef.current = calibrationPxPerMm;
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [formalRefineLoading, setFormalRefineLoading] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResponse | null>(null);
  const formalPhotoInputRef = useRef<HTMLInputElement | null>(null);
  /** 平板 / WebView：用按钮直接 click() 比包在 label 里更易弹出系统相册；另提供「先传 OSS」绕过部分环境对 blob 的限制 */
  const tryOnAlbumInputRef = useRef<HTMLInputElement | null>(null);
  const tryOnCameraInputRef = useRef<HTMLInputElement | null>(null);
  const tryOnOssBridgeInputRef = useRef<HTMLInputElement | null>(null);
  const lastFrameBlobUrlRef = useRef<string | null>(null);
  const [runtimeHints, setRuntimeHints] = useState<string[]>([]);
  const [runtimeSecure, setRuntimeSecure] = useState<boolean | null>(null);
  const [runtimeProtocol, setRuntimeProtocol] = useState('--');
  const [edgeDrawerOpen, setEdgeDrawerOpen] = useState(false);
  const drawerAsideRef = useRef<HTMLElement | null>(null);
  const drawerHeadRef = useRef<HTMLDivElement | null>(null);
  const drawerDragHandleRef = useRef<HTMLDivElement | null>(null);
  const drawerDragPxRef = useRef(0);
  const drawerSwipeRef = useRef<{
    pointerId: number;
    x0: number;
    y0: number;
    t0: number;
    axis: 'h' | 'v' | null;
  } | null>(null);
  const [drawerDragPx, setDrawerDragPx] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const edgePullRef = useRef<{ pointerId: number; x0: number; y0: number; axis: 'h' | 'v' | null } | null>(null);
  const [frameOverlayReady, setFrameOverlayReady] = useState(false);
  const [liveMeasure, setLiveMeasure] = useState<LiveMeasurePanel>({
    pdPx: null,
    pdMm: null,
    phPx: null,
    phMm: null,
    updatedAt: '--',
  });
  const [captureBusy, setCaptureBusy] = useState(false);
  const measureUpdateAtRef = useRef(0);
  const [cameraDiag, setCameraDiag] = useState<CameraDiag>({ width: 0, height: 0, fps: 0, facing: '--' });
  const fpsTickRef = useRef({ ts: 0, frames: 0 });
  const [faceTracked, setFaceTracked] = useState(false);
  const faceTrackedRef = useRef(false);
  const tintManualOverrideUntilRef = useRef(0);
  const opacityManualOverrideUntilRef = useRef(0);

  const markUserTintChange = (nextTintId: string) => {
    tintManualOverrideUntilRef.current = Date.now() + 20_000;
    setSelectedTintId(nextTintId);
    redrawFrameLayer();
  };

  const markUserOpacityChange = (nextOpacity: number) => {
    opacityManualOverrideUntilRef.current = Date.now() + 20_000;
    setLensOpacity(clamp(nextOpacity, 0.08, 0.85));
    redrawFrameLayer();
  };

  const updateFaceTracked = (tracked: boolean) => {
    if (faceTrackedRef.current !== tracked) {
      faceTrackedRef.current = tracked;
      setFaceTracked(tracked);
    }
  };

  const selectedTint = useMemo(
    () => tintColors.find((x) => x.id === selectedTintId) || tintColors[0] || DEFAULT_LENS_TINT_PRESETS[0],
    [tintColors, selectedTintId],
  );
  const effectiveTintOpacity = useMemo(() => clamp(lensOpacity, 0.06, 0.88), [lensOpacity]);
  tintRenderRef.current.hex = selectedTint?.hex ?? '#4f7fa8';
  tintRenderRef.current.opacity = effectiveTintOpacity;
  const photochromicLevel = useMemo(
    () => Math.round(clamp(((effectiveTintOpacity - 0.08) / 0.77) * 100, 0, 100)),
    [effectiveTintOpacity],
  );

  const closeEdgeDrawer = useCallback(() => {
    drawerDragPxRef.current = 0;
    setDrawerDragPx(0);
    setDrawerDragging(false);
    drawerSwipeRef.current = null;
    setEdgeDrawerOpen(false);
  }, []);

  const openEdgeDrawer = useCallback(() => {
    drawerDragPxRef.current = 0;
    setDrawerDragPx(0);
    setDrawerDragging(false);
    drawerSwipeRef.current = null;
    setEdgeDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (!edgeDrawerOpen) {
      drawerDragPxRef.current = 0;
      setDrawerDragPx(0);
      setDrawerDragging(false);
      drawerSwipeRef.current = null;
    }
  }, [edgeDrawerOpen]);

  /** 固定拖拽把手 + Pointer 手势，规避表单滚动/子元素吞事件导致的“无法滑动关闭”。 */
  const onDrawerHandlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!edgeDrawerOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drawerSwipeRef.current = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: Date.now(),
      axis: null,
    };
    setDrawerDragging(false);
    try {
      drawerDragHandleRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [edgeDrawerOpen]);

  const onDrawerHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const s = drawerSwipeRef.current;
    if (!s || s.pointerId !== e.pointerId || !edgeDrawerOpen) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (s.axis === null) {
      if (Math.hypot(dx, dy) < 8) return;
      if (dx >= 8 && dx > Math.abs(dy) * 0.42) s.axis = 'h';
      else if (Math.abs(dy) > Math.abs(dx) * 1.1) s.axis = 'v';
      else s.axis = 'h';
    }
    if (s.axis !== 'h') return;
    const w = drawerAsideRef.current?.offsetWidth ?? 360;
    const next = Math.max(0, Math.min(w + 24, dx * 0.86));
    drawerDragPxRef.current = next;
    setDrawerDragging(true);
    setDrawerDragPx(next);
  }, [edgeDrawerOpen]);

  const onDrawerHandlePointerUp = useCallback((e: React.PointerEvent) => {
    const s = drawerSwipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    drawerSwipeRef.current = null;
    try {
      drawerDragHandleRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const w = drawerAsideRef.current?.offsetWidth ?? 360;
    const px = drawerDragPxRef.current;
    const threshold = Math.max(50, w * 0.2);
    const isFast = s.axis === 'h' && Date.now() - s.t0 < 320 && px > threshold * 0.5;
    setDrawerDragging(false);
    drawerDragPxRef.current = 0;
    if (s.axis === 'h' && (px >= threshold || isFast)) {
      setDrawerDragPx(0);
      setEdgeDrawerOpen(false);
    } else {
      setDrawerDragPx(0);
    }
  }, []);

  const onEdgePullPointerDown = useCallback((e: React.PointerEvent) => {
    if (edgeDrawerOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    edgePullRef.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [edgeDrawerOpen]);

  const onEdgePullPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (edgeDrawerOpen) return;
      const s = edgePullRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.x0;
      const dy = e.clientY - s.y0;
      if (s.axis === null) {
        if (Math.hypot(dx, dy) < 9) return;
        if (dx < -6 && -dx > Math.abs(dy) * 0.4) s.axis = 'h';
        else if (Math.abs(dy) > Math.abs(dx) * 1.1) s.axis = 'v';
        else s.axis = 'h';
      }
      if (s.axis === 'h' && dx < -42) {
        edgePullRef.current = null;
        openEdgeDrawer();
      }
    },
    [edgeDrawerOpen, openEdgeDrawer],
  );

  const onEdgePullPointerUp = useCallback((e: React.PointerEvent) => {
    const s = edgePullRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    edgePullRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  function resolveLensRegionsForFrame(frame: ProcessedFrame): LensRegion[] {
    if (frame.lensRegions.length > 0) return frame.lensRegions;
    return [
      { cx: frame.width * 0.32, cy: frame.height * 0.52, rx: frame.width * 0.18, ry: frame.height * 0.2, area: 0 },
      { cx: frame.width * 0.68, cy: frame.height * 0.52, rx: frame.width * 0.18, ry: frame.height * 0.2, area: 0 },
    ];
  }

  function estimatePdPhFromPose(frame: ProcessedFrame | null, pose: FaceOverlayPose, pxPerMm: number) {
    const safePxPerMm = Math.max(1, pxPerMm);
    const pdPx = pose.ipdPx;
    const pdMm = pdPx / safePxPerMm;
    if (!frame) return { pdPx, pdMm, phPx: null as number | null, phMm: null as number | null };

    const holes = resolveLensRegionsForFrame(frame);
    const lensCenterY = holes.reduce((sum, h) => sum + h.cy, 0) / Math.max(1, holes.length);
    const lensCenterX = holes.reduce((sum, h) => sum + h.cx, 0) / Math.max(1, holes.length);
    let srcIpdPx = frame.width * 0.36;
    if (holes.length >= 2) {
      const sorted = [...holes].sort((a, b) => a.cx - b.cx);
      srcIpdPx = Math.max(18, sorted[1].cx - sorted[0].cx);
    }
    const overlayScale = pdPx / Math.max(1e-6, srcIpdPx);
    const phPx = Math.max(0, (frame.height - lensCenterY) * overlayScale);
    const phMm = phPx / safePxPerMm;
    return { pdPx, pdMm, phPx, phMm, overlayScale, lensCenterX, lensCenterY };
  }

  function draw2DFrameOverlay(
    ctx: CanvasRenderingContext2D,
    frameLayer: HTMLCanvasElement,
    frame: ProcessedFrame,
    pose: FaceOverlayPose,
  ) {
    const metrics = estimatePdPhFromPose(frame, pose, calibrationPxPerMmRef.current);
    const scale = Math.max(0.05, metrics.overlayScale ?? 1);
    const anchorX = metrics.lensCenterX ?? frame.width / 2;
    const anchorY = metrics.lensCenterY ?? frame.height / 2;
    ctx.save();
    ctx.translate(pose.cx, pose.cy);
    ctx.rotate((pose.roll * Math.PI) / 180);
    // 轻微随 yaw 缩放，模拟侧转远近关系
    const yawScale = 1 - Math.min(0.22, Math.abs(pose.yaw) / 240);
    ctx.scale(scale * yawScale, scale);
    ctx.translate(-anchorX, -anchorY);
    ctx.drawImage(frameLayer, 0, 0, frame.width, frame.height);
    ctx.restore();
  }

  const captureSnapshotWithWatermark = async () => {
    if (captureBusy) return;
    const shell = previewShellRef.current;
    const video = videoRef.current;
    if (!shell || !video) {
      setFrameStatus('抓拍失败：预览未就绪');
      return;
    }
    setCaptureBusy(true);
    try {
      const rect = shell.getBoundingClientRect();
      const baseW = Math.max(360, Math.floor(rect.width));
      const baseH = Math.max(640, Math.floor(rect.height));
      const scale = Math.min(2.2, Math.max(1.6, (window.devicePixelRatio || 1) * 1.25));
      const outW = Math.round(baseW * scale);
      const outH = Math.round(baseH * scale);
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('输出画布初始化失败');

      drawVideoCover(ctx, video, outW, outH);
      const pose = r3fPoseRef.current;
      if (enable3D && r3fDomCanvasRef.current) {
        ctx.drawImage(r3fDomCanvasRef.current, 0, 0, outW, outH);
      } else if (!enable3D && pose?.hasFace && frameDataRef.current && frameCanvasRef.current) {
        const scaledPose: FaceOverlayPose = {
          ...pose,
          cx: pose.cx * scale,
          cy: pose.cy * scale,
          ipdPx: pose.ipdPx * scale,
        };
        draw2DFrameOverlay(ctx, frameCanvasRef.current, frameDataRef.current, scaledPose);
        const eyes = lastLiveEyesRef.current;
        if (eyes) {
          const scaledEyes: LiveEyesCanvas = {
            lx: eyes.lx * scale,
            ly: eyes.ly * scale,
            rx: eyes.rx * scale,
            ry: eyes.ry * scale,
            roll: eyes.roll,
            ipdPx: eyes.ipdPx * scale,
          };
          drawLiveLensTintOverlay(ctx, scaledEyes, tintRenderRef.current.hex, tintRenderRef.current.opacity);
        }
      }

      const pdMm = liveMeasure.pdMm != null ? liveMeasure.pdMm.toFixed(1) : '--';
      const phMm = liveMeasure.phMm != null ? liveMeasure.phMm.toFixed(1) : '--';
      const stamp = new Date().toLocaleString();
      const lines = [`PD ${pdMm} mm  |  PH ${phMm} mm`, `Tint ${selectedTint?.name || '--'} · ${photochromicLevel}%`, stamp];
      ctx.save();
      const pad = Math.round(14 * scale);
      ctx.font = `${Math.max(20, Math.round(16 * scale))}px system-ui, -apple-system, sans-serif`;
      const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const lineH = Math.round(22 * scale);
      const boxW = Math.ceil(textW + pad * 2);
      const boxH = lineH * lines.length + pad * 2;
      const x = outW - boxW - Math.round(20 * scale);
      const y = outH - boxH - Math.round(20 * scale);
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.fillRect(x, y, boxW, boxH);
      ctx.fillStyle = '#ffffff';
      lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + lineH * (i + 0.78)));
      ctx.restore();

      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/jpeg', 0.95),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tryon-${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      setFrameStatus(`抓拍完成：已保存高清图（PD ${pdMm} / PH ${phMm}）`);
    } catch (e) {
      setFrameStatus(`抓拍失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCaptureBusy(false);
    }
  };

  const redrawFrameLayer = () => {
    const frame = frameDataRef.current;
    const layer = frameCanvasRef.current;
    if (!frame || !layer) return;
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    layer.width = frame.width;
    layer.height = frame.height;
    ctx.clearRect(0, 0, layer.width, layer.height);

    const [r, g, b] = hexToRgb(selectedTint?.hex || '#2F6EA8');
    const alpha = clamp(effectiveTintOpacity, 0.06, 0.88);
    const holes = resolveLensRegionsForFrame(frame);

    // frame first
    ctx.drawImage(frame.canvas, 0, 0);

    // lens tint above frame (for real product photos without transparent lens holes)
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (const hole of holes) {
      const grad = ctx.createRadialGradient(
        hole.cx - hole.rx * 0.25,
        hole.cy - hole.ry * 0.25,
        Math.max(6, hole.rx * 0.08),
        hole.cx,
        hole.cy,
        Math.max(hole.rx, hole.ry),
      );
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.45).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(hole.cx, hole.cy, hole.rx, hole.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // subtle glossy arc on top
    ctx.globalCompositeOperation = 'source-over';
    for (const hole of holes) {
      ctx.strokeStyle = 'rgba(255,255,255,0.48)';
      ctx.lineWidth = Math.max(2, Math.min(hole.rx, hole.ry) * 0.11);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.ellipse(
        hole.cx - hole.rx * 0.14,
        hole.cy - hole.ry * 0.12,
        hole.rx * 0.66,
        hole.ry * 0.52,
        -0.25,
        Math.PI * 1.08,
        Math.PI * 1.6,
      );
      ctx.stroke();
    }
    ctx.restore();
  };

  const ensureCanvasContextsReady = (): boolean => {
    const cameraCanvas = cameraCanvasRef.current;
    const frameCanvas = frameCanvasRef.current;
    if (!cameraCanvas || !frameCanvas) {
      setFrameStatus('Canvas 节点尚未挂载，正在等待组件初始化...');
      return false;
    }
    const cameraCtx = cameraCanvas.getContext('2d');
    const frameCtx = frameCanvas.getContext('2d');
    if (!cameraCtx || !frameCtx) {
      setFrameStatus('Canvas 2D 上下文初始化失败，请关闭硬件加速后重试浏览器');
      return false;
    }
    return true;
  };

  const loadAndProcessFrame = async (url: string) => {
    if (!url.trim()) {
      setFrameOverlayReady(false);
      return;
    }
    if (!ensureCanvasContextsReady()) return;
    setFrameOverlayReady(false);
    setFrameStatus('正在加载镜框图…');
    await yieldToPaint();
    try {
      const sourceUrl = toCanvasLoadUrl(url);
      const img = new Image();
      applyImgCrossOrigin(img, sourceUrl);
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('镜框图片加载失败'));
      });
      img.src = sourceUrl;
      await loaded;
      if (img.naturalWidth < 2 || img.naturalHeight < 2) {
        throw new Error('图片尺寸无效（宽或高过小），请换一张或从相册重选');
      }
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          /* 部分格式 decode 失败但 drawImage 仍可用 */
        }
      }
      setFrameStatus('正在本机抠图（大图可能需数秒，请稍候）…');
      await yieldToPaint();
      const cleanedRaw = removeFrameBackground(img, { maxWidth: 1024 });
      const cleaned = cropCanvasToOpaqueBounds(cleanedRaw);
      let lensRegions = detectLensHoles(cleaned);
      if (lensRegions.length === 0) {
        lensRegions = detectLensHoles(cleaned, { opaqueFloor: 42, minArea: 28 });
      }
      if (lensRegions.length === 0) {
        lensRegions = detectLensHoles(cleaned, { opaqueFloor: 58, minArea: 18 });
      }
      frameDataRef.current = {
        canvas: cleaned,
        width: cleaned.width,
        height: cleaned.height,
        lensRegions,
      };
      setFrameStatus(
        lensRegions.length > 0
          ? `抠图：边缘连通去底 + 碎屑清理 · 已识别镜片空洞 ${lensRegions.length} 个 · 已裁边`
          : '抠图：边缘连通去底 + 碎屑清理 · 未识别到镜片空洞，已用默认镜片位 · 已裁边',
      );
      setFrameOverlayReady(true);
      redrawFrameLayer();
    } catch (e) {
      frameDataRef.current = null;
      setFrameOverlayReady(false);
      const msg = e instanceof Error ? e.message : String(e);
      setFrameStatus(`镜框处理失败：${msg}`);
      const layer = frameCanvasRef.current;
      if (layer) {
        const fctx = layer.getContext('2d');
        if (fctx) fctx.clearRect(0, 0, layer.width, layer.height);
      }
    }
  };

  const revokeLastFrameBlobUrl = () => {
    const u = lastFrameBlobUrlRef.current;
    if (u?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
    lastFrameBlobUrlRef.current = null;
  };

  const handleTryOnPickLocalFile = (file: File) => {
    revokeLastFrameBlobUrl();
    const url = URL.createObjectURL(file);
    lastFrameBlobUrlRef.current = url;
    setFrameImageUrl(url);
    void loadAndProcessFrame(url);
  };

  const handleTryOnPickViaOss = async (file: File) => {
    setFrameOverlayReady(false);
    setFrameStatus('正在上传到服务器（OSS）…');
    await yieldToPaint();
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/try-on/upload-frame', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const bodyText = await res.text();
      let json: { ok?: boolean; error?: string; data?: { imageUrl?: string; sameOriginReadUrl?: string } };
      try {
        json = JSON.parse(bodyText) as typeof json;
      } catch {
        throw new Error(`上传响应非 JSON（HTTP ${res.status}）：${bodyText.slice(0, 200)}`);
      }
      const readUrl = json.data?.sameOriginReadUrl || json.data?.imageUrl;
      if (!res.ok || !json.ok || !readUrl) {
        throw new Error(json.error || `上传失败（HTTP ${res.status}）`);
      }
      revokeLastFrameBlobUrl();
      const imageUrl = readUrl;
      setFrameImageUrl(imageUrl);
      setFrameStatus('已得到 OSS 地址，正在经同源代理拉取并抠图…');
      await yieldToPaint();
      await loadAndProcessFrame(imageUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFrameStatus(`经 OSS 中转失败：${msg}`);
      setFrameOverlayReady(false);
    }
  };

  const resetTryOnFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    return file;
  };

  const loadFromCashierDraft = (options?: { silent?: boolean; force?: boolean }) => {
    const { silent = false, force = false } = options || {};
    try {
      const raw = window.localStorage.getItem('cashier_draft_v1');
      if (!raw) {
        if (!silent) setFrameStatus('未读取到收银台草稿 cashier_draft_v1');
        return;
      }
      if (!force && raw === lastCashierDraftRawRef.current) return;
      lastCashierDraftRawRef.current = raw;
      const draft = JSON.parse(raw) as {
        cart?: Array<Record<string, unknown>>;
      };
      const cart = Array.isArray(draft.cart) ? draft.cart : [];
      const frameLine = cart.find((x) => {
        const category = String(x.category || '');
        const frameType = String(x.frame_type || '');
        return category.includes('镜框') || Boolean(frameType);
      });
      if (!frameLine) {
        if (!silent) setFrameStatus('收银草稿中未找到镜框行');
        return;
      }
      const imageUrl =
        (['imageUrl', 'ossImageUrl', 'image', 'photo', 'cover'] as const)
          .map((k) => (typeof frameLine[k] === 'string' ? frameLine[k] : ''))
          .find((x) => x) || '';
      if (imageUrl) {
        if (imageUrl !== frameImageUrl) {
          setFrameImageUrl(imageUrl);
          void loadAndProcessFrame(imageUrl);
        }
      } else {
        if (!silent) setFrameStatus('收银草稿存在镜框行，但未找到可用 SKU 图片地址');
      }
      const lensLine = cart.find((x) => typeof x.tint_info === 'object' && x.tint_info !== null);
      if (lensLine && typeof lensLine.tint_info === 'object' && lensLine.tint_info) {
        const tintInfo = lensLine.tint_info as { id?: unknown; opacity?: unknown };
        const tintId = typeof tintInfo.id === 'string' ? tintInfo.id : '';
        const now = Date.now();
        const canSyncTint = force || now >= tintManualOverrideUntilRef.current;
        const canSyncOpacity = force || now >= opacityManualOverrideUntilRef.current;
        if (canSyncTint && tintId && tintColors.some((t) => t.id === tintId)) {
          setSelectedTintId(tintId);
        }
        const op = Number(tintInfo.opacity);
        if (canSyncOpacity && Number.isFinite(op)) {
          setLensOpacity(clamp(op, 0.1, 0.85));
        }
      }
      if (!silent) setFrameStatus('已从收银草稿同步 SKU 镜框图与染色参数');
    } catch {
      if (!silent) setFrameStatus('读取收银台草稿失败');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setRuntimeSecure(window.isSecureContext);
    setRuntimeProtocol(window.location.protocol);
    const hints: string[] = [];
    const insecure =
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';
    if (insecure) {
      hints.push(
        '当前不是安全上下文（HTTPS/localhost），浏览器会禁用摄像头。请改用 https://www.opti-ai.cn/test/try-on/ 或在本地启动 Chrome 参数 --unsafely-treat-insecure-origin-as-secure=http://你的域名 --user-data-dir=/tmp/chrome-dev',
      );
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hints.push('当前浏览器不支持 getUserMedia，FaceMesh 无法启动，请改用最新版 Chrome/Edge。');
    }
    if (ensureCanvasContextsReady()) {
      hints.push('Canvas 2D 上下文初始化正常。');
    }
    setRuntimeHints(hints);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncSilently = () => loadFromCashierDraft({ silent: true });
    syncSilently();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'cashier_draft_v1') loadFromCashierDraft({ silent: true, force: true });
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(syncSilently, 1500);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [frameImageUrl, tintColors]);

  useEffect(() => {
    let cancelled = false;
    void fetchLensTintConfigClient()
      .then((cfg) => {
        if (cancelled) return;
        const colors = Array.isArray(cfg.colors) && cfg.colors.length > 0 ? cfg.colors : DEFAULT_LENS_TINT_PRESETS;
        setTintColors(colors);
        setSelectedTintId((prev) => (colors.some((x) => x.id === prev) ? prev : colors[0].id));
      })
      .catch(() => {
        if (cancelled) return;
        setTintColors(DEFAULT_LENS_TINT_PRESETS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runCalibration = async () => {
    setCalibrationLoading(true);
    try {
      const pxPerMm = clamp(Number(calibrationPxPerMm) || 4, 1, 20);
      const { width, height, data } = await loadCalibrationSampleRgba(calibrationSample);
      const blobs = detectRedMarkerBlobsFromRgba(data, width, height);
      const mapped = markerBlobsToPupilFrame(blobs, height);
      if ('error' in mapped) {
        setCalibrationResult({
          ok: false,
          sample: calibrationSample,
          error: mapped.error,
          debug: {
            imageSize: { width, height },
            redBlobCount: mapped.redBlobCount,
            mode: 'client-marker',
          },
        });
        return;
      }
      const { structured, left, right } = mapped;
      const res = await fetch('/api/measure/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          mode: 'physical',
          sample: calibrationSample,
          pxPerMm,
          structured,
          debug: {
            imageSize: { width, height },
            pxPerMm,
            redBlobCount: blobs.length,
            markerStructured: structured,
            selectedBlobs: [
              { eye: 'left', x: Number(left.cx.toFixed(2)), y: Number(left.cy.toFixed(2)), area: left.area },
              { eye: 'right', x: Number(right.cx.toFixed(2)), y: Number(right.cy.toFixed(2)), area: right.area },
            ],
            mode: 'client-marker',
          },
        }),
      });
      const json = (await res.json()) as CalibrationResponse;
      setCalibrationResult(json);
    } catch (error) {
      setCalibrationResult({
        ok: false,
        error: error instanceof Error ? error.message : '标定流程失败',
      });
    } finally {
      setCalibrationLoading(false);
    }
  };

  const runFormalRefineFromFile = async (file: File) => {
    setFormalRefineLoading(true);
    try {
      const pxPerMm = clamp(Number(calibrationPxPerMm) || 4, 1, 20);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('无法读取照片'));
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/measure/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          mode: 'formal_ai_refine',
          dataUrl,
          pxPerMm,
          maxEdge: 3840,
          quality: 88,
          provider: 'qwen',
        }),
      });
      const json = (await res.json()) as CalibrationResponse;
      setCalibrationResult(json);
    } catch (error) {
      setCalibrationResult({
        ok: false,
        error: error instanceof Error ? error.message : '正式云端校准失败',
      });
    } finally {
      setFormalRefineLoading(false);
    }
  };

  useEffect(() => {
    redrawFrameLayer();
  }, [selectedTint?.id, effectiveTintOpacity]);

  useEffect(() => {
    if (!enable3D) {
      r3fDomCanvasRef.current = null;
    }
  }, [enable3D]);

  useEffect(() => {
    return () => {
      const u = lastFrameBlobUrlRef.current;
      if (u?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const video = videoRef.current;
    const bgCanvas = cameraCanvasRef.current;
    if (!video || !bgCanvas) return;

    const setup = async () => {
      if (!ensureCanvasContextsReady()) return;
      if (
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        setFrameStatus(
          '当前页面非安全上下文，浏览器已阻止摄像头。请使用 HTTPS 域名或 Chrome 参数 --unsafely-treat-insecure-origin-as-secure。',
        );
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setFrameStatus('当前浏览器不支持摄像头 API（getUserMedia）');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      if (stopped) return;
      video.srcObject = stream;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      await video.play();
      const primaryTrack = stream.getVideoTracks()[0];
      if (primaryTrack) {
        try {
          await primaryTrack.applyConstraints({
            // 某些平板浏览器支持这些扩展约束；不支持会被 catch 忽略。
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        } catch {
          /* ignore unsupported focus constraints */
        }
        try {
          const settings = primaryTrack.getSettings();
          setCameraDiag((prev) => ({
            ...prev,
            width: Number(settings.width || 0),
            height: Number(settings.height || 0),
            facing: typeof settings.facingMode === 'string' ? settings.facingMode : 'user',
          }));
        } catch {
          /* ignore */
        }
      }

      /** 必须先持续绘制摄像头，再异步加载 MediaPipe；否则模型/WASM 慢或失败时整屏会一直黑 */
      const drawLoop = () => {
        if (stopped) return;
        const shell = previewShellRef.current;
        const ctx = bgCanvas.getContext('2d');
        if (!shell || !ctx || video.videoWidth <= 0 || video.videoHeight <= 0) {
          rafRef.current = window.requestAnimationFrame(drawLoop);
          return;
        }
        const rect = shell.getBoundingClientRect();
        const cw = Math.max(120, Math.floor(rect.width));
        const ch = Math.max(160, Math.floor(rect.height));
        if (bgCanvas.width !== cw || bgCanvas.height !== ch) {
          bgCanvas.width = cw;
          bgCanvas.height = ch;
        }
        const overlay2d = frameOverlay2dCanvasRef.current;
        if (overlay2d && (overlay2d.width !== cw || overlay2d.height !== ch)) {
          overlay2d.width = cw;
          overlay2d.height = ch;
        }
        const lb = drawVideoCover(ctx, video, cw, ch);
        if (!lb) {
          rafRef.current = window.requestAnimationFrame(drawLoop);
          return;
        }
        const now = performance.now();
        const fpsTick = fpsTickRef.current;
        if (!fpsTick.ts) {
          fpsTick.ts = now;
          fpsTick.frames = 0;
        }
        fpsTick.frames += 1;
        if (now - fpsTick.ts >= 1000) {
          const fps = (fpsTick.frames * 1000) / (now - fpsTick.ts);
          fpsTick.ts = now;
          fpsTick.frames = 0;
          setCameraDiag((prev) => ({
            ...prev,
            width: video.videoWidth || prev.width,
            height: video.videoHeight || prev.height,
            fps: Number(fps.toFixed(1)),
          }));
        }
        setShellSize((prev) => (prev.w !== cw || prev.h !== ch ? { w: cw, h: ch } : prev));
        const detector = detectorRef.current;
        if (detector && lastVideoTsRef.current !== video.currentTime) {
          lastVideoTsRef.current = video.currentTime;
          const result = detector.detectForVideo(video, performance.now());
          const landmarks = result.faceLandmarks?.[0];
          let faceMatrix: Matrix4 | null = null;
          const mats = result.facialTransformationMatrixes;
          if (Array.isArray(mats) && mats[0]?.data && mats[0].data.length >= 16) {
            faceMatrix = matrix4FromMediaPipeRowMajor(mats[0].data);
            faceMatrix.premultiply(new Matrix4().makeScale(-1, 1, 1));
          }
          if (landmarks && landmarks.length > 150) {
            updateFaceTracked(true);
            const nLm = landmarks.length;
            const leftIr = nLm > 473 && landmarks[468] ? landmarks[468] : landmarks[33];
            const rightIr = nLm > 473 && landmarks[473] ? landmarks[473] : landmarks[263];
            const avgFaceZ = (((leftIr?.z ?? 0) + (rightIr?.z ?? 0)) / 2) || 0;
            const pose = estimateFaceOverlayPose(landmarks, lb, true);
            if (pose) {
              const sp = smoothPoseRef.current;
              const sizeKey = `${cw}x${ch}`;
              const prevKey = lastPreviewSizeKeyRef.current;
              if (prevKey && prevKey !== sizeKey) {
                sp.cx = pose.cx;
                sp.cy = pose.cy;
                sp.ipdPx = pose.ipdPx;
                sp.yaw = pose.yaw;
                sp.pitch = pose.pitch;
                sp.roll = pose.roll;
              } else {
                const aR = 0.26;
                const aT = 0.36;
                sp.yaw = sp.yaw * (1 - aR) + pose.yaw * aR;
                sp.pitch = sp.pitch * (1 - aR) + pose.pitch * aR;
                sp.roll = sp.roll * (1 - aR) + pose.roll * aR;
                sp.cx = sp.cx * (1 - aT) + pose.cx * aT;
                sp.cy = sp.cy * (1 - aT) + pose.cy * aT;
                sp.ipdPx = sp.ipdPx * (1 - aT) + pose.ipdPx * aT;
              }
              lastPreviewSizeKeyRef.current = sizeKey;

              const le = normToLetterbox(leftIr.x, leftIr.y, lb, true);
              const re = normToLetterbox(rightIr.x, rightIr.y, lb, true);
              lastLiveEyesRef.current = {
                lx: le.x,
                ly: le.y,
                rx: re.x,
                ry: re.y,
                roll: sp.roll,
                ipdPx: sp.ipdPx,
              };

              const fd = frameDataRef.current;
              r3fPoseRef.current = {
                w: cw,
                h: ch,
                cx: sp.cx,
                cy: sp.cy,
                yaw: sp.yaw,
                pitch: sp.pitch,
                roll: sp.roll,
                ipdPx: sp.ipdPx,
                // hasFace 只表达“是否识别到人脸”，不应与镜框纹理加载状态耦合。
                hasFace: true,
                faceMatrix,
                avgFaceZ,
                pxPerMm: calibrationPxPerMmRef.current,
              };
              const rt = estimatePdPhFromPose(fd ?? null, sp, calibrationPxPerMmRef.current);
              const now = Date.now();
              if (now - measureUpdateAtRef.current > 120) {
                measureUpdateAtRef.current = now;
                setLiveMeasure({
                  pdPx: Number(rt.pdPx.toFixed(1)),
                  pdMm: Number(rt.pdMm.toFixed(2)),
                  phPx: rt.phPx != null ? Number(rt.phPx.toFixed(1)) : null,
                  phMm: rt.phMm != null ? Number(rt.phMm.toFixed(2)) : null,
                  updatedAt: new Date(now).toLocaleTimeString(),
                });
              }
              setPoseText(
                `${enable3DRef.current ? '3D' : '2D'} · 贴纸 ${calibrationPxPerMmRef.current.toFixed(1)} px/mm · PD ${rt.pdMm.toFixed(1)}mm · PH ${
                  rt.phMm != null ? `${rt.phMm.toFixed(1)}mm` : '--'
                } · yaw ${sp.yaw.toFixed(1)}°`,
              );
            } else {
              lastLiveEyesRef.current = null;
            }
          } else {
            updateFaceTracked(false);
            lastLiveEyesRef.current = null;
            r3fPoseRef.current = {
              w: cw,
              h: ch,
              cx: 0,
              cy: 0,
              yaw: 0,
              pitch: 0,
              roll: 0,
              ipdPx: 62,
              hasFace: false,
              faceMatrix,
              avgFaceZ: 0,
              pxPerMm: calibrationPxPerMmRef.current,
            };
            const now = Date.now();
            if (now - measureUpdateAtRef.current > 220) {
              measureUpdateAtRef.current = now;
              setLiveMeasure((prev) => ({ ...prev, pdPx: null, pdMm: null, phPx: null, phMm: null, updatedAt: new Date(now).toLocaleTimeString() }));
            }
          }
        }
        if (overlay2d) {
          const overlayCtx = overlay2d.getContext('2d');
          if (overlayCtx) {
            overlayCtx.clearRect(0, 0, cw, ch);
            if (!enable3DRef.current) {
              const fd = frameDataRef.current;
              const sp = smoothPoseRef.current;
              const tint = tintRenderRef.current;
              if (fd && frameOverlayReady && frameCanvasRef.current) {
                draw2DFrameOverlay(overlayCtx, frameCanvasRef.current, fd, sp);
              }
              const eyes = lastLiveEyesRef.current;
              if (faceTrackedRef.current && eyes && eyes.ipdPx > 10) {
                drawLiveLensTintOverlay(overlayCtx, eyes, tint.hex, tint.opacity);
              }
            }
          }
        }
        rafRef.current = window.requestAnimationFrame(drawLoop);
      };
      rafRef.current = window.requestAnimationFrame(drawLoop);

      void (async () => {
        try {
          const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
          if (stopped) return;
          const wasmBase = resolveMediapipeWasmBaseUrl();
          const vision = await FilesetResolver.forVisionTasks(wasmBase);
          if (stopped) return;
          const highPrecisionOpts = {
            baseOptions: {
              modelAssetPath: resolveFaceLandmarkerModelUrl(),
              delegate: 'GPU' as const,
            },
            runningMode: 'VIDEO' as const,
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.55,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true,
          };
          let created: FaceLandmarkerLike | null = null;
          try {
            created = (await FaceLandmarker.createFromOptions(vision, highPrecisionOpts)) as FaceLandmarkerLike;
          } catch {
            created = (await FaceLandmarker.createFromOptions(vision, {
              ...highPrecisionOpts,
              baseOptions: { ...highPrecisionOpts.baseOptions, delegate: 'CPU' },
            })) as FaceLandmarkerLike;
          }
          if (stopped) {
            created?.close?.();
            return;
          }
          detectorRef.current = created;
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          setFrameStatus(`摄像头已开，但 MediaPipe 加载失败（仍可看画面）：${msg}`);
        }
      })();
    };

    void setup().catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : '未知错误';
      setFrameStatus(`摄像头初始化失败：${msg}`);
    });

    return () => {
      stopped = true;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      const stream = video.srcObject as MediaStream | null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      detectorRef.current?.close?.();
    };
  }, []);

  const drawerForm = (
    <div className="space-y-4 pb-6">
      <details className="rounded-lg border border-sky-200 bg-sky-50/90 p-2 text-xs text-sky-900">
        <summary className="cursor-pointer font-semibold">运行环境自检</summary>
        <p className="mt-1">
          secureContext: <strong>{runtimeSecure == null ? '--' : runtimeSecure ? 'true' : 'false'}</strong> · 协议{' '}
          <strong>{runtimeProtocol}</strong>
        </p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {runtimeHints.length > 0 ? (
            runtimeHints.map((h, idx) => <li key={`hint-${idx}`}>{h}</li>)
          ) : (
            <li>正在检测运行环境...</li>
          )}
        </ul>
      </details>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-800">镜框图（收银联动 / 拍照）</p>
        <p className="text-[11px] text-gray-500">
          正面、镜框尽量大；背景尽量与白墙有对比。白框+白墙请垫深色纸再拍。视频已全屏铺满，侧脸时略抬头更易跟踪。
        </p>
        <p className="text-[11px] text-amber-800/90 leading-snug">
          部分平板或内置浏览器点「相册」无反应时，请试<strong>「先上传 OSS 再抠图」</strong>（图先传到门店 OSS，再经本站代理加载，抠图仍在浏览器本机完成）。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadFromCashierDraft({ force: true })}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            读取收银 SKU 图
          </button>
          <button
            type="button"
            onClick={() => tryOnAlbumInputRef.current?.click()}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            相册选图
          </button>
          <button
            type="button"
            onClick={() => tryOnCameraInputRef.current?.click()}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            拍照（相机）
          </button>
          <button
            type="button"
            onClick={() => tryOnOssBridgeInputRef.current?.click()}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
          >
            先上传 OSS 再抠图
          </button>
          <input
            ref={tryOnAlbumInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
            className="hidden"
            onChange={(e) => {
              const file = resetTryOnFileInput(e);
              if (file) handleTryOnPickLocalFile(file);
            }}
          />
          <input
            ref={tryOnCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = resetTryOnFileInput(e);
              if (file) handleTryOnPickLocalFile(file);
            }}
          />
          <input
            ref={tryOnOssBridgeInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
            className="hidden"
            onChange={(e) => {
              const file = resetTryOnFileInput(e);
              if (file) void handleTryOnPickViaOss(file);
            }}
          />
        </div>
        <input
          value={frameImageUrl}
          onChange={(e) => setFrameImageUrl(e.target.value)}
          placeholder="或粘贴镜框图 URL"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void loadAndProcessFrame(frameImageUrl)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          加载并抠图
        </button>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 space-y-2">
        <p className="text-sm font-semibold text-emerald-900">实物加装 / 3D 模式</p>
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs">
          <span className="text-gray-700">启用 3D 模型渲染</span>
          <button
            type="button"
            onClick={() => setEnable3D((v) => !v)}
            className={`rounded-full px-2.5 py-1 font-semibold ${
              enable3D ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {enable3D ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-[11px] text-emerald-900/90 leading-snug">
          关闭 3D 时仅用 MediaPipe + 2D Canvas 实时叠加染色镜片（不加载 3D 模型），适合门店“实物加装”快速演示。
        </p>
      </div>

      <div className="rounded-xl border border-cyan-200 bg-cyan-50/90 p-4 space-y-2">
        <p className="text-sm font-semibold text-cyan-900">测绘仪表盘（红环比例尺）</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-cyan-200 bg-white px-2 py-1.5">
            <div className="text-cyan-800/70">PD</div>
            <div className="font-semibold text-cyan-950">
              {liveMeasure.pdMm != null ? `${liveMeasure.pdMm.toFixed(1)} mm` : '--'}
            </div>
            <div className="text-[10px] text-cyan-800/70">{liveMeasure.pdPx != null ? `${liveMeasure.pdPx.toFixed(1)} px` : '--'}</div>
          </div>
          <div className="rounded-lg border border-cyan-200 bg-white px-2 py-1.5">
            <div className="text-cyan-800/70">PH</div>
            <div className="font-semibold text-cyan-950">
              {liveMeasure.phMm != null ? `${liveMeasure.phMm.toFixed(1)} mm` : '--'}
            </div>
            <div className="text-[10px] text-cyan-800/70">{liveMeasure.phPx != null ? `${liveMeasure.phPx.toFixed(1)} px` : '--'}</div>
          </div>
        </div>
        <p className="text-[10px] text-cyan-900/75">更新时间：{liveMeasure.updatedAt}</p>
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50/90 p-4 space-y-2">
        <p className="text-sm font-semibold text-violet-900">颜色与深浅已移至主界面底部快捷栏</p>
        <p className="text-[11px] text-violet-900/85 leading-snug">
          无需打开菜单，可直接在预览底部完成“选色 → 调深浅 → 看数据”。
        </p>
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50/90 p-4 space-y-2">
        <p className="text-sm font-semibold text-violet-900">拍照存档</p>
        <p className="text-[11px] text-violet-900/85">一键抓拍当前染色效果，并在右下角水印 PD/PH，便于门店下单留档。</p>
        <button
          type="button"
          disabled={captureBusy}
          onClick={() => void captureSnapshotWithWatermark()}
          className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-70"
        >
          {captureBusy ? '抓拍中…' : '抓拍高清图（含 PD/PH 水印）'}
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 space-y-3">
        <p className="text-sm font-semibold text-amber-900">验配与标定（重心在端侧）</p>
        <p className="text-[11px] text-amber-900/90 leading-relaxed">
          红色标定与像素解码在<strong>本机浏览器</strong>完成；接口仅做毫米换算。生成正式报告时再选一张高分辨率原图走云端单次 AI（约 4K 长边上云）。
        </p>
        <label className="block text-[11px] font-medium text-amber-900">
          px/mm（测量架比例）
          <input
            type="number"
            min={1}
            max={20}
            step={0.1}
            value={calibrationPxPerMm}
            onChange={(e) => setCalibrationPxPerMm(clamp(Number(e.target.value), 1, 20))}
            className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm text-amber-950"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          {CALIBRATION_SAMPLE_FILES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setCalibrationSample(sample)}
              className={`rounded-lg border p-1 text-left ${
                calibrationSample === sample ? 'border-amber-500 bg-amber-100' : 'border-amber-200 bg-white'
              }`}
            >
              <img src={`/test-samples/${sample}`} alt={sample} className="h-14 w-full rounded object-cover" />
              <p className="mt-1 truncate text-[10px] text-amber-900">{sample}</p>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void runCalibration()}
          className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-70"
          disabled={calibrationLoading || formalRefineLoading}
        >
          {calibrationLoading ? '本机标定中…' : '本机标定 + 毫米换算'}
        </button>
        <input
          ref={formalPhotoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void runFormalRefineFromFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => formalPhotoInputRef.current?.click()}
          className="w-full rounded-lg border border-amber-700 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-200 disabled:opacity-70"
          disabled={calibrationLoading || formalRefineLoading}
        >
          {formalRefineLoading ? '云端分析中…' : '正式报告 · 选一张 4K 级原图云端校准'}
        </button>
      </div>

      <details className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-100">
        <summary className="cursor-pointer text-sm font-semibold">校准 JSON 日志</summary>
        <div className="mt-2 text-xs">
          <p>
            PD：<strong className="text-emerald-300">{calibrationResult?.pd?.pd_mm != null ? `${calibrationResult.pd.pd_mm} mm` : '--'}</strong>
            <span className="text-slate-400"> ({calibrationResult?.pd?.pd_px != null ? `${calibrationResult.pd.pd_px} px` : '--'})</span>
          </p>
          {!calibrationResult?.ok && calibrationResult?.error ? (
            <p className="mt-1 text-rose-300">错误：{calibrationResult.error}</p>
          ) : null}
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-700 bg-black/50 p-2 text-[10px] leading-relaxed">
            {JSON.stringify(calibrationResult ?? { hint: '运行 calibrate 后显示 JSON' }, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-[100] touch-manipulation bg-black"
        style={{ width: '100vw', height: '100dvh', maxHeight: '100dvh' }}
      >
        <div ref={previewShellRef} className="absolute inset-0">
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas ref={cameraCanvasRef} className="absolute inset-0 z-[1] block h-full w-full" />
          <canvas ref={frameOverlay2dCanvasRef} className="pointer-events-none absolute inset-0 z-[8] block h-full w-full" />
          {/* 隐藏 canvas：仅用于抠图纹理供 R3F CanvasTexture 采样 */}
          <canvas
            ref={frameCanvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            aria-hidden
          />
          {enable3D && shellSize.w > 0 && shellSize.h > 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[9]">
              <TryOnR3FCanvas
                width={shellSize.w}
                height={shellSize.h}
                poseRef={r3fPoseRef}
                frameCanvasRef={frameCanvasRef}
                frameOverlayReady={frameOverlayReady}
                lensHex={selectedTint?.hex ?? '#4f7fa8'}
                lensTransmission={0.12 + effectiveTintOpacity * 0.82}
                onCanvasReady={(el) => {
                  r3fDomCanvasRef.current = el;
                }}
              />
            </div>
          ) : null}
          {!faceTracked ? (
            <div className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center p-5 sm:p-8">
              <div className="w-full max-w-[min(92vw,460px)] rounded-3xl border-[3px] border-dashed border-white/75 bg-black/30 px-6 py-6 text-center text-white shadow-lg backdrop-blur-[2px] sm:px-10 sm:py-8">
                <div className="mx-auto mb-4 aspect-[5/6] w-[min(52vw,220px)] max-h-[42vh] rounded-[42%] border-[3px] border-dashed border-white/80 sm:w-[min(48vw,260px)]" />
                <p className="text-base font-semibold sm:text-lg">未识别到人脸</p>
                <p className="mt-2 text-sm leading-snug text-white/88 sm:text-[15px]">
                  请将脸移入中央大框内，保持正脸、距离适中，并保证光线充足
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <header className="pointer-events-none absolute left-0 right-0 top-0 z-[110] flex items-start justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-white/25 bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm"
            >
              返回
            </Link>
            <button
              type="button"
              onClick={() => openEdgeDrawer()}
              className="rounded-lg border border-white/25 bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm"
            >
              功能菜单
            </button>
          </div>
          <div className="pointer-events-none max-w-[58%] rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-right text-[10px] leading-tight text-white/90 backdrop-blur-sm">
            <div className="truncate">{poseText}</div>
            <div className="mt-0.5 truncate text-[9px] text-cyan-200/90">
              Cam {cameraDiag.width > 0 ? `${cameraDiag.width}x${cameraDiag.height}` : '--'} · {cameraDiag.fps > 0 ? `${cameraDiag.fps}fps` : '--'} · {cameraDiag.facing}
            </div>
          </div>
        </header>

        <footer className="pointer-events-none absolute bottom-0 left-0 right-0 z-[110] p-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto space-y-2">
            <div className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-white backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-white/80">镜片深浅（变色演示）</span>
                <span className="font-semibold">{photochromicLevel}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Home className="h-3.5 w-3.5 shrink-0 text-white/85" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={photochromicLevel}
                  onChange={(e) => {
                    const level = clamp(Number(e.target.value), 0, 100);
                    const nextOpacity = 0.08 + (level / 100) * 0.77;
                    markUserOpacityChange(nextOpacity);
                  }}
                  className="w-full accent-cyan-300"
                />
                <Sun className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-white/70">
                <span>室内</span>
                <span>渲染透明度 {Math.round(effectiveTintOpacity * 100)}%</span>
                <span>室外</span>
              </div>
              <div className="mt-2 -mx-1 overflow-x-auto">
                <div className="flex min-w-max items-center gap-2 px-1 pb-1">
                  {tintColors.map((color) => {
                    const active = color.id === selectedTintId;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => markUserTintChange(color.id)}
                        className={`relative shrink-0 rounded-lg border p-1.5 transition ${
                          active
                            ? 'border-cyan-300 bg-white/20 shadow-[0_0_0_1px_rgba(103,232,249,0.75)] animate-pulse'
                            : 'border-white/25 bg-black/25 hover:bg-black/35'
                        }`}
                        title={`${color.name} ${color.hex}`}
                      >
                        <span className="block h-7 w-7 rounded-md" style={{ background: color.hex }} />
                        <span className="mt-1 block max-w-[3.8rem] truncate text-[10px] text-white/95">{color.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-white/70">
                提示：若你正在自动同步收银草稿，手动选色后 20 秒内优先保留你的当前选择。
              </p>
            </div>

            <div className="rounded-xl border border-white/20 bg-black/65 px-3 py-2 text-[11px] text-white backdrop-blur-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`font-medium ${frameOverlayReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {frameOverlayReady
                      ? enable3D
                        ? '已加载镜框纹理 · Three.js / R3F 3D 锚定（MediaPipe + 物理镜片材质）'
                        : '已加载镜框纹理 · 实物加装 2D 模式（MediaPipe 实时人脸锚定）'
                      : '尚未加载镜框图：点左上角「功能菜单」上传或同步 SKU'}
                  </p>
                  <p className="mt-1 text-white/90">{frameStatus}</p>
                </div>
                <div className="rounded-lg border border-cyan-300/30 bg-cyan-950/30 px-2 py-1 text-[10px] leading-tight text-cyan-100">
                  <div>PD {liveMeasure.pdMm != null ? `${liveMeasure.pdMm.toFixed(1)}mm` : '--'}</div>
                  <div>PH {liveMeasure.phMm != null ? `${liveMeasure.phMm.toFixed(1)}mm` : '--'}</div>
                </div>
              </div>
            </div>
          </div>
        </footer>

        {!edgeDrawerOpen ? (
          <div
            className="pointer-events-auto absolute bottom-0 right-0 top-0 z-[109] w-6 max-w-[24px] touch-none"
            style={{ touchAction: 'none' }}
            aria-hidden
            title="从边缘向左滑可打开菜单"
            onPointerDown={onEdgePullPointerDown}
            onPointerMove={onEdgePullPointerMove}
            onPointerUp={onEdgePullPointerUp}
            onPointerCancel={onEdgePullPointerUp}
          />
        ) : null}

        {edgeDrawerOpen ? (
          <div className="absolute inset-0 z-[120] flex">
            <button
              type="button"
              className="min-h-0 min-w-0 flex-1 cursor-default bg-black/50 backdrop-blur-[1px]"
              aria-label="关闭菜单"
              onClick={() => closeEdgeDrawer()}
            />
            <aside
              ref={drawerAsideRef}
              className="pointer-events-auto flex max-h-full w-[min(100vw,400px)] shrink-0 flex-col border-l border-gray-200 bg-white shadow-2xl will-change-transform"
              style={{
                transform: `translateX(${drawerDragPx}px)`,
                transition: drawerDragging ? 'none' : 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
              }}
            >
              <div
                ref={drawerHeadRef}
                className="relative shrink-0 touch-none select-none border-b border-gray-200"
                style={{ touchAction: 'none' }}
              >
                <div
                  ref={drawerDragHandleRef}
                  className="absolute left-0 top-0 bottom-0 z-10 w-8 cursor-ew-resize touch-none"
                  style={{ touchAction: 'none' }}
                  aria-label="向右滑关闭菜单"
                  onPointerDown={onDrawerHandlePointerDown}
                  onPointerMove={onDrawerHandlePointerMove}
                  onPointerUp={onDrawerHandlePointerUp}
                  onPointerCancel={onDrawerHandlePointerUp}
                />
                <div className="flex justify-center pt-2 pb-1" aria-hidden>
                  <div className="h-1 w-11 rounded-full bg-gray-300" />
                </div>
                <div className="flex items-center justify-between px-3 pb-2">
                  <span className="text-sm font-semibold text-gray-900">试戴设置</span>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                    onClick={() => closeEdgeDrawer()}
                  >
                    完成
                  </button>
                </div>
                <p className="px-3 pb-2 text-[10px] leading-snug text-gray-500">向右滑关闭 · 屏幕右缘向左滑可再次打开</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{drawerForm}</div>
            </aside>
          </div>
        ) : null}
      </div>
    </>
  );
}
