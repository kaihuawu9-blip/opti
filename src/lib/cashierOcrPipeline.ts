/**
 * 收银 OCR 客户端：仅通过 FormData POST **同源 `/api/ocr`**（Next 再调本机 Paddle）。
 * 不请求任何库存图片接口（如不存在于本项目的 getInventoryImages）；验光 / 自定义商品名称 / 镜腿均走此链路。
 */

export type CashierOcrApiBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** 面向收银台展示的短提示（与 error 技术信息分离） */
  hint?: string;
  rawText?: string;
  evidenceUrl?: string | null;
  /** intent=custom_add 时：服务端选用的解析链路 */
  ocrMode?: 'temple' | 'generic';
  result?:
    | { right?: Record<string, unknown>; left?: Record<string, unknown> }
    | {
        brand?: string;
        model?: string;
        size?: string;
        color?: string;
        productName?: string;
        modelLine?: string;
      };
  detail?: unknown;
};

function resolveCashierOcrUserMessage(status: number, data: CashierOcrApiBody): string {
  if (typeof data.hint === 'string' && data.hint.trim()) {
    return data.hint.trim();
  }
  const err = (typeof data.error === 'string' && data.error) || '';
  const msg = (typeof data.message === 'string' && data.message) || '';
  if (status === 502) {
    if (err.includes('取字多为非验光内容') || err.includes('非验光')) {
      return (
        data.hint ||
        '取到的字以镜架/背景为主。请把验光单上带数字的区域对准、减少反光，或手填。'
      );
    }
    if (err.includes('Paddle') || /Paddle OCR|格式异常|未从画面/.test(err)) {
      return 'OCR 步骤失败：请确认本机 8866 上 Paddle 已启动、图片清晰。若已识别出图但无字，请补光后重拍。';
    }
    if (err.startsWith('AI 解析失败') || err.includes('AI 解析失败')) {
      return '已得到文字，但模型未能填好球镜/柱镜/轴位。请对照原单手动填写或重拍。';
    }
    if (err.includes('镜架信息解析失败')) {
      return data.hint || '已识别到文字，但未能拆出品名/型号。请手填或重拍更清晰镜腿刻字。';
    }
    if (err.includes('自定义商品解析失败')) {
      return data.hint || '已识别到文字，但未能生成商品名称。请手填或重拍更清晰的包装/标签。';
    }
  }
  if (status === 500 && msg) {
    return `处理失败：${msg}`;
  }
  return [err, msg].filter(Boolean).join(' ').trim() || 'OCR 识别失败，请重试。';
}

export type CashierOcrIntent = 'rx' | 'frame' | 'custom_add';

/** 唯一上传出口：`fetch('/api/ocr', { body: FormData })`，不经库存或其它图片 API。 */
export async function postCashierOcrImage(
  blob: Blob,
  fileName = 'rx.jpg',
  opts?: { intent?: CashierOcrIntent; category?: string },
): Promise<{ httpOk: boolean; status: number; data: CashierOcrApiBody }> {
  const fd = new FormData();
  fd.append('file', blob, fileName);
  if (opts?.intent === 'custom_add') {
    fd.append('intent', 'custom_add');
    fd.append('mode', 'custom_add');
    const c = opts.category?.trim();
    if (c) fd.append('category', c);
  } else if (opts?.intent && opts.intent !== 'rx') {
    fd.append('intent', opts.intent);
    fd.append('mode', opts.intent);
  }
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
  const result = data.result;
  if (
    !result ||
    typeof result !== 'object' ||
    !('right' in result) ||
    !('left' in result) ||
    !result.right ||
    !result.left
  ) {
    throw new Error('OCR 返回数据不完整');
  }
  return { rawText: data.rawText, result: { right: result.right, left: result.left } };
}

/** 镜腿/吊牌图 → brand/model/size/color + 展示名（intent=frame；服务端存证 public/recordings） */
export async function runServerCashierFrameOcr(
  blob: Blob,
  fileName = 'frame.jpg',
): Promise<{
  rawText?: string;
  evidenceUrl?: string | null;
  brand: string;
  model: string;
  size: string;
  color: string;
  productName: string;
  modelLine: string;
}> {
  let httpOk: boolean;
  let status: number;
  let data: CashierOcrApiBody;
  try {
    const r = await postCashierOcrImage(blob, fileName, { intent: 'frame' });
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
  const res = data.result as
    | {
        brand?: string;
        model?: string;
        size?: string;
        color?: string;
        productName?: string;
        modelLine?: string;
      }
    | undefined;
  if (!res || typeof res !== 'object') {
    throw new Error('OCR 返回数据不完整');
  }
  const brand = String(res.brand ?? '').trim();
  const model = String(res.model ?? '').trim();
  const size = String(res.size ?? '').trim();
  const color = String(res.color ?? '').trim();
  const productName = String(res.productName ?? '').trim() || [brand, model].filter(Boolean).join(' ').trim();
  const modelLine =
    String(res.modelLine ?? '').trim() || [model, size, color].filter(Boolean).join(' ').trim() || model;
  return {
    rawText: data.rawText,
    evidenceUrl: typeof data.evidenceUrl === 'string' ? data.evidenceUrl : null,
    brand,
    model,
    size,
    color,
    productName,
    modelLine,
  };
}

/**
 * 自定义添加商品：intent=custom_add + category；服务端按 OCR 文本启发式选镜腿模型或通用品名模型。
 */
export async function runServerCashierCustomAddOcr(
  blob: Blob,
  fileName = 'custom.jpg',
  category: string,
): Promise<{
  rawText?: string;
  evidenceUrl?: string | null;
  ocrMode: 'temple' | 'generic';
  brand: string;
  model: string;
  size: string;
  color: string;
  productName: string;
  modelLine: string;
}> {
  let httpOk: boolean;
  let status: number;
  let data: CashierOcrApiBody;
  try {
    const r = await postCashierOcrImage(blob, fileName, { intent: 'custom_add', category });
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
  const res = data.result as
    | {
        brand?: string;
        model?: string;
        size?: string;
        color?: string;
        productName?: string;
        modelLine?: string;
      }
    | undefined;
  if (!res || typeof res !== 'object') {
    throw new Error('OCR 返回数据不完整');
  }
  const ocrMode: 'temple' | 'generic' = data.ocrMode === 'generic' ? 'generic' : 'temple';
  const brand = String(res.brand ?? '').trim();
  const model = String(res.model ?? '').trim();
  const size = String(res.size ?? '').trim();
  const color = String(res.color ?? '').trim();
  const productName =
    String(res.productName ?? '').trim() || [brand, model].filter(Boolean).join(' ').trim();
  const modelLine =
    String(res.modelLine ?? '').trim() ||
    (ocrMode === 'temple' ? [model, size, color].filter(Boolean).join(' ').trim() : '') ||
    model;
  return {
    rawText: data.rawText,
    evidenceUrl: typeof data.evidenceUrl === 'string' ? data.evidenceUrl : null,
    ocrMode,
    brand,
    model,
    size,
    color,
    productName,
    modelLine,
  };
}
