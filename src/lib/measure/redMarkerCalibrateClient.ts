/**
 * 试戴 / 样板标定：红色标定点检测与瞳位结构 — 仅在浏览器执行（与已移除的服务端 sharp 管线一致）。
 */

import type { PupilFrameCoordinates } from '@/lib/vision/types';

export type MarkerBlob = {
  cx: number;
  cy: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function isRedMarker(r: number, g: number, b: number, a: number): boolean {
  return a > 120 && r > 165 && g < 115 && b < 115 && r - g > 45 && r - b > 45;
}

/** RGBA 交错缓冲区（如 ImageData.data） */
export function detectRedMarkerBlobsFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): MarkerBlob[] {
  const visited = new Uint8Array(width * height);
  const markerMask = new Uint8Array(width * height);
  const index = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = index(x, y);
      const p = i * 4;
      if (isRedMarker(data[p], data[p + 1], data[p + 2], data[p + 3])) {
        markerMask[i] = 1;
      }
    }
  }

  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);
  const blobs: MarkerBlob[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const root = index(x, y);
      if (!markerMask[root] || visited[root]) continue;
      let head = 0;
      let tail = 0;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;
      visited[root] = 1;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;
        area += 1;
        sumX += cx;
        sumY += cy;
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
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = index(nx, ny);
          if (visited[ni] || !markerMask[ni]) continue;
          visited[ni] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }

      if (area >= 8) {
        blobs.push({
          cx: sumX / area,
          cy: sumY / area,
          area,
          minX,
          minY,
          maxX,
          maxY,
        });
      }
    }
  }

  blobs.sort((a, b) => b.area - a.area);
  return blobs;
}

export function markerBlobsToPupilFrame(
  blobs: MarkerBlob[],
  imageHeight: number,
): { structured: PupilFrameCoordinates; left: MarkerBlob; right: MarkerBlob } | { error: string; redBlobCount: number } {
  if (blobs.length < 2) {
    return { error: '未识别到至少两个红色标定点', redBlobCount: blobs.length };
  }
  const top = blobs.slice(0, 2).sort((a, b) => a.cx - b.cx);
  const left = top[0];
  const right = top[1];
  const frameBottomY = Math.round(Math.max(left.cy, right.cy) + imageHeight * 0.18);
  const structured: PupilFrameCoordinates = {
    left_pupil_x: left.cx,
    left_pupil_y: left.cy,
    right_pupil_x: right.cx,
    right_pupil_y: right.cy,
    frame_bottom_y: frameBottomY,
    confidence: 0.99,
    notes: 'client-marker-red-dot',
  };
  return { structured, left, right };
}

/** 从同源样板路径解码为 RGBA（需已登录或可匿名访问的静态资源路径） */
export async function loadCalibrationSampleRgba(sample: string): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}> {
  const url = `/test-samples/${encodeURIComponent(sample)}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('样本图加载失败'));
    img.src = url;
  });
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!(w > 0) || !(h > 0)) {
    w = 960;
    h = 540;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data };
}
