import { createDualServicePaymentManager } from '@/lib/payments/dualChannelPaymentManager';
import { createCloudRestPaymentOrderUpdater } from '@/lib/payments/cloudRestOrderUpdater';

/**
 * 供 **Node 服务端**（Express / 非 static export 的 Next Route / 自建网关）挂载 Webhook。
 * 当前仓库为 `output: 'export'`，无法内置动态 API，请把下列函数接到你的公网回调 URL。
 */
export async function createWechatPayNotifyResponse(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const headers: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  try {
    const mgr = createDualServicePaymentManager(createCloudRestPaymentOrderUpdater());
    const r = await mgr.handleWechatNotify(headers, rawBody);
    return new Response(r.responseBody, {
      status: r.httpStatus,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    console.error('[wechat notify]', e);
    return new Response(JSON.stringify({ code: 'FAIL', message: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export async function createAlipayNotifyResponse(req: Request): Promise<Response> {
  const ct = req.headers.get('content-type') || '';
  const fields: Record<string, string> = {};

  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    fd.forEach((v, k) => {
      fields[k] = typeof v === 'string' ? v : '';
    });
  } else {
    const text = await req.text();
    const params = new URLSearchParams(text);
    params.forEach((v, k) => {
      fields[k] = v;
    });
  }

  try {
    const mgr = createDualServicePaymentManager(createCloudRestPaymentOrderUpdater());
    const r = await mgr.handleAlipayNotify(fields);
    return new Response(r.responseBody, {
      status: r.httpStatus,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (e) {
    console.error('[alipay notify]', e);
    return new Response('fail', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
