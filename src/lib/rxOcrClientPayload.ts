/** 验光图 OCR：浏览器侧把 Blob 编成 data URL 的 base64 段，供 POST /api/vision/rx-ocr JSON 体使用 */
export function readBlobAsDataUrlBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(blob);
  });
}

export type RxOcrResponseBody = {
  ok?: boolean;
  error?: string;
  result?: { right?: Record<string, unknown>; left?: Record<string, unknown> };
};

/** JSON POST，避免部分环境下 multipart Content-Type 异常导致服务端无法 parse formData */
export async function postRxOcrImageJson(
  blob: Blob,
  mimeType = 'image/jpeg',
): Promise<{ ok: boolean; data: RxOcrResponseBody }> {
  const imageBase64 = await readBlobAsDataUrlBase64(blob);
  const resp = await fetch('/api/vision/rx-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  const data = (await resp.json().catch(() => ({}))) as RxOcrResponseBody;
  return { httpOk: resp.ok, data };
}
