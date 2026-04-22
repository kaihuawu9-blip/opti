import sharp from 'sharp';
import type { PreprocessOptions } from './types';

export type PreprocessedImage = {
  base64: string;
  mimeType: 'image/jpeg';
  dataUrl: string;
};

/**
 * 平板/手机照片：按长边缩放 + JPEG 压缩，输出豆包等多模态 API 常用的 data URL / Base64。
 */
export async function preprocessTabletPhotoForVision(
  input: Buffer,
  options: PreprocessOptions = {},
): Promise<PreprocessedImage> {
  const maxEdge = options.maxEdge ?? 1280;
  const quality = Math.min(100, Math.max(40, options.quality ?? 82));

  let pipeline = sharp(input).rotate();

  const meta = await pipeline.metadata();
  const w = meta.width ?? maxEdge;
  const h = meta.height ?? maxEdge;
  const longEdge = Math.max(w, h);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;

  if (scale < 1) {
    pipeline = pipeline.resize({
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const buf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  const base64 = buf.toString('base64');
  return {
    base64,
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${base64}`,
  };
}
