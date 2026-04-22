/**
 * 浏览器端将图片压成 JPEG（按质量与尺寸迭代），控制体积在 maxBytes 以内。
 * 用于上传前减小体积（验光单识别、品牌图标等）。
 */

export type CompressImageOptions = {
  /** 目标最大体积（字节），默认约 520KB */
  maxBytes?: number;
  /** 长边最大像素，默认 2048 */
  maxEdge?: number;
  /** 尺寸无法再缩时的最小短边，默认 400 */
  minEdge?: number;
};

const DEFAULT_MAX_BYTES = 520 * 1024;
const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_MIN_EDGE = 400;

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}

async function loadDrawable(file: File): Promise<{ draw: CanvasImageSource; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      draw: bitmap,
      release: () => {
        try {
          bitmap.close();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片无法解码'));
        img.src = url;
      });
      return {
        draw: img,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
}

/**
 * 将用户选择的图片压缩为 JPEG Blob，尽量不超过 maxBytes。
 */
export async function compressImageFileToJpegBlob(
  file: File,
  options?: CompressImageOptions,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const minEdge = options?.minEdge ?? DEFAULT_MIN_EDGE;

  const { draw, release } = await loadDrawable(file);
  try {
    const srcW =
      draw instanceof HTMLImageElement ? draw.naturalWidth || draw.width : (draw as ImageBitmap).width;
    const srcH =
      draw instanceof HTMLImageElement ? draw.naturalHeight || draw.height : (draw as ImageBitmap).height;
    if (!srcW || !srcH) throw new Error('无法读取图片尺寸');

    const scale0 = Math.min(1, maxEdge / Math.max(srcW, srcH));
    let w = Math.max(1, Math.round(srcW * scale0));
    let h = Math.max(1, Math.round(srcH * scale0));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');

    const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34];
    let bestBlob: Blob | null = null;

    for (let round = 0; round < 12; round += 1) {
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(draw, 0, 0, w, h);

      for (const q of qualities) {
        const blob = await canvasToJpegBlob(canvas, q);
        if (!blob) continue;
        bestBlob = blob;
        if (blob.size <= maxBytes) return blob;
      }

      const short = Math.min(w, h);
      if (short <= minEdge) break;

      const factor = 0.88;
      const nw = Math.max(minEdge, Math.round(w * factor));
      const nh = Math.max(minEdge, Math.round(h * factor));
      if (nw === w && nh === h) break;
      w = nw;
      h = nh;
    }

    if (bestBlob) return bestBlob;
    throw new Error('压缩失败');
  } finally {
    release();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageFileToDataUrl(
  file: File,
  options?: CompressImageOptions,
): Promise<string> {
  const blob = await compressImageFileToJpegBlob(file, options);
  return blobToDataUrl(blob);
}
