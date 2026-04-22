import type { NextRequest } from 'next/server';

/**
 * 从 POST 体解析验光图片：支持 multipart（字段 image）或 application/json（imageBase64 + 可选 mimeType）。
 */
export async function parseRxOcrImageFile(req: NextRequest): Promise<File> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const body = (await req.json()) as { imageBase64?: string; mimeType?: string };
    const b64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    if (!b64) {
      throw new Error('JSON 体缺少 imageBase64');
    }
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) {
      throw new Error('imageBase64 解码为空');
    }
    const mime =
      typeof body.mimeType === 'string' && body.mimeType.startsWith('image/') ? body.mimeType : 'image/jpeg';
    return new File([buf], 'rx.jpg', { type: mime });
  }
  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File)) {
    throw new Error('未上传图片（multipart 字段 image）');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('仅支持图片文件');
  }
  return file;
}
