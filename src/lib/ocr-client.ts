/**
 * 收银台验光：浏览器直连本机 Paddle（默认与页面同主机 :8866）取 Raw Text，
 * 再调 Next `/api/vision/rx-from-text` 做 AI 蒸馏（密钥不出浏览器）。
 *
 * 路径说明：
 * - 仅当设置了 `NEXT_PUBLIC_PADDLE_OCR_URL` 时才使用该绝对地址。
 * - 否则在浏览器内用 `window.location.hostname`，保证「平板用局域网 IP 打开收银」
 *   时请求的是 `http://同一IP:8866`，而不是误指向设备自身的 `127.0.0.1`（会极慢或失败）。
 */

export type PaddleOcrLine = {
  text: string;
  confidence: number;
  box: unknown;
};

export type RxFromTextResponse = {
  ok?: boolean;
  error?: string;
  result?: { right?: Record<string, unknown>; left?: Record<string, unknown> };
};

/** 浏览器内解析 Paddle 基址（必须在 client 调用） */
export function getPaddleOcrBaseUrl(): string {
  const fromEnv = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PADDLE_OCR_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8866`;
  }
  return 'http://127.0.0.1:8866';
}

/** 第一步：multipart 直投本地 Paddle `/predict`，拿文字碎片 */
export async function postPaddlePredictLocal(blob: Blob, fileName = 'rx.jpg'): Promise<PaddleOcrLine[]> {
  const fd = new FormData();
  fd.append('file', blob, fileName);
  const url = `${getPaddleOcrBaseUrl()}/predict`;
  const resp = await fetch(url, { method: 'POST', body: fd });
  const data = (await resp.json().catch(() => ({}))) as { status?: string; data?: PaddleOcrLine[] };
  if (!resp.ok) {
    throw new Error(
      `Paddle OCR 请求失败（${resp.status}），URL=${url}。请确认 Docker 已映射 8866；若用 IP 访问收银台且未配 NEXT_PUBLIC_PADDLE_OCR_URL，应自动走同主机 :8866。`,
    );
  }
  if (data.status !== 'success' || !Array.isArray(data.data)) {
    throw new Error('Paddle OCR 返回异常');
  }
  return data.data;
}

export function joinPaddleRawText(lines: PaddleOcrLine[]): string {
  return lines.map((l) => l.text).join(' ');
}

/** 第二步：纯文本走服务端豆包/兼容接口，取验光 JSON */
export async function distillRxJsonFromRawText(rawText: string): Promise<{ right: Record<string, unknown>; left: Record<string, unknown> }> {
  const resp = await fetch('/api/vision/rx-from-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawText }),
  });
  const data = (await resp.json().catch(() => ({}))) as RxFromTextResponse;
  if (!resp.ok || !data.ok || !data.result?.right || !data.result?.left) {
    throw new Error(data.error || 'AI 蒸馏失败');
  }
  return { right: data.result.right, left: data.result.left };
}

/** 串联：本地 Paddle → rawText → AI → 结构化双眼（供 prepareRxOcrEyesOrAbandon） */
export async function runLocalPaddleThenAiDistill(blob: Blob, fileName = 'rx.jpg'): Promise<{
  rawText: string;
  lines: PaddleOcrLine[];
  result: { right: Record<string, unknown>; left: Record<string, unknown> };
}> {
  const lines = await postPaddlePredictLocal(blob, fileName);
  const rawText = joinPaddleRawText(lines).trim();
  if (!rawText) {
    throw new Error('未识别到文字：请确认本机已启动 OCR 容器（8866），图片清晰、光线充足。');
  }
  const result = await distillRxJsonFromRawText(rawText);
  return { rawText, lines, result };
}
