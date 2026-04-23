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
