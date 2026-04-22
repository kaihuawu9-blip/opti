import https from 'node:https';

export type MeituanVerifyResult = {
  success: boolean;
  message: string;
  verifyId?: string;
  raw?: unknown;
};

type VerifyPayload = {
  voucherCode: string;
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
};

function postJson(url: URL, body: Record<string, unknown>, timeoutMs = 12000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (/<!doctype\s+html/i.test(raw)) {
            resolve({ statusCode: res.statusCode ?? 0, body: { message: '網關路徑配置錯誤' } });
            return;
          }
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ statusCode: res.statusCode ?? 0, body: parsed });
          } catch {
            resolve({ statusCode: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('美团核销请求超时')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export async function verifyMeituanVoucher(payload: VerifyPayload): Promise<MeituanVerifyResult> {
  const voucherCode = String(payload.voucherCode ?? '').trim();
  if (!voucherCode) return { success: false, message: '券码为空' };
  const apiKey = String(payload.apiKey ?? '').trim();
  const apiSecret = String(payload.apiSecret ?? '').trim();
  if (!apiKey || !apiSecret) {
    return { success: false, message: '缺少美团 API Key/Secret' };
  }

  // 说明：不同商户接入网关路径可能不同，这里保持可配置，默认给出占位路径。
  const base = String(payload.baseUrl ?? process.env.MEITUAN_API_BASE_URL ?? 'https://api.meituan.com');
  const url = new URL('/voucher/verify', base);
  const nonce = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const timestamp = Date.now();

  const resp = (await postJson(url, {
    app_key: apiKey,
    nonce,
    timestamp,
    voucher_code: voucherCode,
    // 最小增量方案：使用 header/body 传 secret，签名算法后续可按美团正式文档替换
    secret: apiSecret,
  })) as { statusCode: number; body: any };

  const body = resp.body ?? {};
  const ok =
    resp.statusCode >= 200 &&
    resp.statusCode < 300 &&
    (body.success === true || body.code === 0 || body.status === 'SUCCESS');
  if (ok) {
    return {
      success: true,
      message: '核销成功',
      verifyId: String(body.verify_id ?? body.data?.verify_id ?? voucherCode),
      raw: body,
    };
  }
  return {
    success: false,
    message: String(body.message ?? body.msg ?? `核销失败（HTTP ${resp.statusCode}）`),
    raw: body,
  };
}

