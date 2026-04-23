/** POST /api/ocr：本地 Paddle + AI 球镜/柱镜/轴位，供收银台验光单弹窗 */

export type CashierOcrApiBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  rawText?: string;
  result?: { right?: Record<string, unknown>; left?: Record<string, unknown> };
  detail?: unknown;
};

export async function postCashierOcrImage(
  blob: Blob,
  fileName = 'rx.jpg',
): Promise<{ httpOk: boolean; data: CashierOcrApiBody }> {
  const fd = new FormData();
  fd.append('file', blob, fileName);
  const resp = await fetch('/api/ocr', { method: 'POST', body: fd });
  const data = (await resp.json().catch(() => ({}))) as CashierOcrApiBody;
  return { httpOk: resp.ok, data };
}

/**
 * 同源 POST /api/ocr：在服务端访问本机 Paddle（:8866）+ AI，避免浏览器直连 8866（未启动 = Failed to fetch；
 * 或 HTTPS 页面下混合内容被拦截）。仍须在本机启动 Paddle 与 Next（见 docker/ocr 与 PADDLE_OCR_BASE_URL）。
 */
export async function runServerCashierOcr(
  blob: Blob,
  fileName = 'rx.jpg',
): Promise<{
  rawText?: string;
  result: { right: Record<string, unknown>; left: Record<string, unknown> };
}> {
  let httpOk: boolean;
  let data: CashierOcrApiBody;
  try {
    const r = await postCashierOcrImage(blob, fileName);
    httpOk = r.httpOk;
    data = r.data;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === 'Failed to fetch' || m.includes('NetworkError') || /load failed/i.test(m)) {
      throw new Error(
        '无法连接本机 OCR 接口：请确认已运行 `npm run dev`（或生产 Next），且本机 8866 已启动 Paddle 容器。若使用 HTTPS 访问前台，已改为经服务器转发，请仍确保服务端能访问 Paddle。',
      );
    }
    throw e;
  }
  if (!httpOk) {
    throw new Error(
      (typeof data.error === 'string' && data.error) || data.message || 'OCR 服务返回异常',
    );
  }
  if (!data.ok) {
    throw new Error(
      (typeof data.error === 'string' && data.error) || data.message || 'OCR 识别失败',
    );
  }
  if (!data.result?.right || !data.result?.left) {
    throw new Error('OCR 返回数据不完整');
  }
  return { rawText: data.rawText, result: { right: data.result.right, left: data.result.left } };
}
