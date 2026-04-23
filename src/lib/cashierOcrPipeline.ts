/** POST /api/ocr：本地 Paddle + AI 球镜/柱镜/轴位，供收银台验光单弹窗 */

export type CashierOcrApiBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** 面向收银台展示的短提示（与 error 技术信息分离） */
  hint?: string;
  rawText?: string;
  result?: { right?: Record<string, unknown>; left?: Record<string, unknown> };
  detail?: unknown;
};

function resolveCashierOcrUserMessage(status: number, data: CashierOcrApiBody): string {
  if (typeof data.hint === 'string' && data.hint.trim()) {
    return data.hint.trim();
  }
  const err = (typeof data.error === 'string' && data.error) || '';
  const msg = (typeof data.message === 'string' && data.message) || '';
  if (status === 502) {
    if (err.includes('Paddle') || /Paddle OCR|格式异常|未从画面/.test(err)) {
      return 'OCR 步骤失败：请确认本机 8866 上 Paddle 已启动、图片清晰。若已识别出图但无字，请补光后重拍。';
    }
    if (err.startsWith('AI 解析失败') || err.includes('AI 解析失败')) {
      return '已得到文字，但模型未能填好球镜/柱镜/轴位。请对照原单手动填写或重拍。';
    }
  }
  if (status === 500 && msg) {
    return `处理失败：${msg}`;
  }
  return [err, msg].filter(Boolean).join(' ').trim() || 'OCR 识别失败，请重试。';
}

export async function postCashierOcrImage(
  blob: Blob,
  fileName = 'rx.jpg',
): Promise<{ httpOk: boolean; status: number; data: CashierOcrApiBody }> {
  const fd = new FormData();
  fd.append('file', blob, fileName);
  const resp = await fetch('/api/ocr', { method: 'POST', body: fd });
  const data = (await resp.json().catch(() => ({}))) as CashierOcrApiBody;
  return { httpOk: resp.ok, status: resp.status, data };
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
  let status: number;
  let data: CashierOcrApiBody;
  try {
    const r = await postCashierOcrImage(blob, fileName);
    httpOk = r.httpOk;
    status = r.status;
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
    throw new Error(resolveCashierOcrUserMessage(status, data));
  }
  if (!data.ok) {
    throw new Error(resolveCashierOcrUserMessage(status, data));
  }
  if (!data.result?.right || !data.result?.left) {
    throw new Error('OCR 返回数据不完整');
  }
  return { rawText: data.rawText, result: { right: data.result.right, left: data.result.left } };
}
