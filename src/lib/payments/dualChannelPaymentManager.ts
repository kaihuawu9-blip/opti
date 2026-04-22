/**
 * 环境变量（勿写入代码，仅 .env / 部署密钥）：
 *
 * 通用
 * - PAY_NOTIFY_PUBLIC_BASE_URL=https://你的公网域名   （拼接 /api/.../notify，微信支付宝后台配置同一前缀下的路径）
 * - 未设置时回退 NEXT_PUBLIC_API_URL / NEXT_PUBLIC_OPTI_AI_API_ORIGIN / 默认（见 src/lib/optiAiPublic.ts）
 *
 * 微信服务商 Native
 * - WXPAY_SP_APPID、WXPAY_SP_MCHID、WXPAY_SERIAL_NO
 * - WXPAY_MERCHANT_CERT_PEM 或 WXPAY_MERCHANT_CERT_PEM_PATH（apiclient_cert.pem）
 * - WXPAY_PRIVATE_KEY_PEM 或 WXPAY_PRIVATE_KEY_PEM_PATH（apiclient_key.pem）
 * - WXPAY_APIV3_KEY
 * - 可选 WXPAY_SUB_APPID、WXPAY_ORDER_DESC、WXPAY_USER_AGENT
 *
 * 支付宝当面付（预下单二维码）
 * - ALIPAY_APP_ID、ALIPAY_PRIVATE_KEY(_PATH)
 * - 公钥模式：ALIPAY_ALIPAY_PUBLIC_KEY(_PATH)；或证书模式：ALIPAY_ROOT_CERT_PATH、ALIPAY_PUBLIC_CERT_PATH、ALIPAY_APP_CERT_PATH
 * - 可选 ALIPAY_GATEWAY、ALIPAY_KEY_TYPE=PKCS8、ALIPAY_ORDER_SUBJECT
 * - 代商户：ALIPAY_APP_AUTH_TOKEN 或 ALIPAY_APP_AUTH_TOKENS_JSON={"子商户PID":"app_auth_token"}
 *
 * 回调后写库（云端 REST / PostgREST 兼容网关）
 * - ALIYUN_REST_URL、ALIYUN_REST_SERVICE_KEY
 */
import { randomUUID } from 'crypto';
import { AlipaySdk, type AlipaySdkConfig } from 'alipay-sdk';
import { PaymentManager } from '@/lib/payments/PaymentManager';
import { WechatServiceProviderClient } from '@/lib/payments/wechatPartnerClient';
import { loadSecretFromEnv } from '@/lib/payments/loadSecret';
import type { PayResult, PaymentOrderUpdater, WebhookDispatchResult } from '@/lib/payments/types';
import { getOptiAiApiOrigin } from '@/lib/optiAiPublic';

function centsFromYuan(yuan: number): number {
  return Math.round(yuan * 100);
}

function generateOutTradeNo(): string {
  return `PAY-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function normalizeHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase();
    o[key] = Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  }
  return o;
}

function resolveAlipayAppAuthToken(subMchId: string): string | undefined {
  const raw = process.env.ALIPAY_APP_AUTH_TOKENS_JSON?.trim();
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      const t = map[subMchId];
      if (t) return t;
    } catch {
      // ignore
    }
  }
  return process.env.ALIPAY_APP_AUTH_TOKEN?.trim() || undefined;
}

function buildAlipaySdk(): AlipaySdk {
  const appId = process.env.ALIPAY_APP_ID?.trim();
  if (!appId) throw new Error('缺少 ALIPAY_APP_ID');

  const privateKey = loadSecretFromEnv('ALIPAY_PRIVATE_KEY').toString('utf8');

  const cfg: AlipaySdkConfig = {
    appId,
    privateKey,
    signType: 'RSA2',
    charset: 'utf-8',
    gateway: process.env.ALIPAY_GATEWAY?.trim() || 'https://openapi.alipay.com',
  };

  const root = process.env.ALIPAY_ROOT_CERT_PATH?.trim();
  const pubCert = process.env.ALIPAY_PUBLIC_CERT_PATH?.trim();
  const appCert = process.env.ALIPAY_APP_CERT_PATH?.trim();
  if (root && pubCert && appCert) {
    cfg.alipayRootCertPath = root;
    cfg.alipayPublicCertPath = pubCert;
    cfg.appCertPath = appCert;
  } else {
    const alipayPk = loadSecretFromEnv('ALIPAY_ALIPAY_PUBLIC_KEY').toString('utf8');
    cfg.alipayPublicKey = alipayPk;
  }

  if (process.env.ALIPAY_KEY_TYPE?.trim() === 'PKCS8') {
    cfg.keyType = 'PKCS8';
  }

  return new AlipaySdk(cfg);
}

/**
 * 具体实现：微信（服务商 Native）+ 支付宝（当面付 alipay.trade.precreate，主扫二维码）。
 */
export class DualServicePaymentManager extends PaymentManager {
  private readonly wx: WechatServiceProviderClient;

  private readonly alipay: AlipaySdk;

  private readonly notifyBase: string;

  constructor(onPaid: PaymentOrderUpdater) {
    super(onPaid);
    const spAppId = process.env.WXPAY_SP_APPID?.trim();
    const spMchId = process.env.WXPAY_SP_MCHID?.trim();
    if (!spAppId || !spMchId) throw new Error('缺少 WXPAY_SP_APPID 或 WXPAY_SP_MCHID');

    const merchantCert = loadSecretFromEnv('WXPAY_MERCHANT_CERT_PEM');
    const privateKey = loadSecretFromEnv('WXPAY_PRIVATE_KEY_PEM');
    const serialNo = process.env.WXPAY_SERIAL_NO?.trim();
    if (!serialNo) throw new Error('缺少 WXPAY_SERIAL_NO');

    const apiV3 = process.env.WXPAY_APIV3_KEY?.trim();
    if (!apiV3) throw new Error('缺少 WXPAY_APIV3_KEY（回调解密验签需要）');

    this.wx = new WechatServiceProviderClient({
      appid: spAppId,
      mchid: spMchId,
      serial_no: serialNo,
      publicKey: merchantCert,
      privateKey,
      key: apiV3,
      userAgent: process.env.WXPAY_USER_AGENT?.trim() || 'opti-ai/1.0',
    });

    this.alipay = buildAlipaySdk();

    this.notifyBase =
      process.env.PAY_NOTIFY_PUBLIC_BASE_URL?.trim() || getOptiAiApiOrigin();
  }

  protected async executeWechatPartnerNative(amountYuan: number, subMchId: string): Promise<PayResult> {
    const spAppId = process.env.WXPAY_SP_APPID!.trim();
    const spMchId = process.env.WXPAY_SP_MCHID!.trim();
    const outTradeNo = generateOutTradeNo();
    const notifyUrl = `${this.notifyBase.replace(/\/+$/, '')}/api/payments/wechat/notify`;

    const body: Record<string, unknown> = {
      sp_appid: spAppId,
      sp_mchid: spMchId,
      sub_mchid: subMchId,
      description: process.env.WXPAY_ORDER_DESC?.trim() || '眼镜门店订单',
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total: centsFromYuan(amountYuan),
        currency: 'CNY',
      },
    };

    const subAppId = process.env.WXPAY_SUB_APPID?.trim();
    if (subAppId) body.sub_appid = subAppId;

    const res = await this.wx.partnerTransactionsNative(body);
    if (res.status !== 200 || !res.data?.code_url) {
      const err =
        (res.data as { message?: string })?.message ||
        (typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.status));
      return { ok: false, outTradeNo, error: `微信下单失败: ${err}` };
    }
    return {
      ok: true,
      outTradeNo,
      payload: { codeUrl: res.data.code_url, raw: res.data },
    };
  }

  protected async executeAlipayFacePrecreate(amountYuan: number, subMchId: string): Promise<PayResult> {
    const outTradeNo = generateOutTradeNo();
    const notifyUrl = `${this.notifyBase.replace(/\/+$/, '')}/api/payments/alipay/notify`;
    const appAuthToken = resolveAlipayAppAuthToken(subMchId);

    const result = (await this.alipay.exec('alipay.trade.precreate', {
      notifyUrl,
      appAuthToken,
      bizContent: {
        out_trade_no: outTradeNo,
        subject: process.env.ALIPAY_ORDER_SUBJECT?.trim() || '眼镜门店订单',
        total_amount: amountYuan.toFixed(2),
        product_code: 'FACE_TO_FACE_PAYMENT',
      },
    })) as {
      code?: string;
      msg?: string;
      qrCode?: string;
      qr_code?: string;
      sub_code?: string;
      sub_msg?: string;
    };

    if (result.code !== '10000') {
      return {
        ok: false,
        outTradeNo,
        error: `支付宝预创建失败: ${result.sub_code || result.code || ''} ${result.sub_msg || result.msg || ''}`,
      };
    }

    const trade = result.qrCode || result.qr_code;
    if (!trade) {
      return {
        ok: false,
        outTradeNo,
        error: `支付宝预创建未返回 qr_code: ${JSON.stringify(result)}`,
      };
    }

    return {
      ok: true,
      outTradeNo,
      payload: { qrCode: trade, raw: result },
    };
  }

  async handleWechatNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WebhookDispatchResult> {
    const h = normalizeHeaders(headers);
    const okSign = await this.wx.verifySign({
      timestamp: h['wechatpay-timestamp'] || '',
      nonce: h['wechatpay-nonce'] || '',
      body: rawBody,
      serial: h['wechatpay-serial'] || '',
      signature: h['wechatpay-signature'] || '',
    });

    if (!okSign) {
      return {
        ok: false,
        provider: 'wechat',
        responseBody: JSON.stringify({ code: 'FAIL', message: 'sign' }),
        httpStatus: 401,
        error: '微信回调验签失败',
      };
    }

    let body: {
      resource?: {
        ciphertext: string;
        nonce: string;
        associated_data: string;
      };
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return {
        ok: false,
        provider: 'wechat',
        responseBody: JSON.stringify({ code: 'FAIL', message: 'body' }),
        httpStatus: 400,
        error: '微信回调 JSON 无效',
      };
    }

    const r = body.resource;
    if (!r?.ciphertext) {
      return {
        ok: false,
        provider: 'wechat',
        responseBody: JSON.stringify({ code: 'FAIL', message: 'resource' }),
        httpStatus: 400,
      };
    }

    const plain = this.wx.decipher_gcm<{
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      success_time?: string;
    }>(r.ciphertext, r.associated_data || '', r.nonce);

    const state = plain.trade_state || '';
    const outTradeNo = plain.out_trade_no || '';

    if (state === 'SUCCESS' && outTradeNo) {
      await this.onPaid({
        provider: 'wechat',
        outTradeNo,
        tradeState: state,
        platformTradeNo: plain.transaction_id,
        paidAt: plain.success_time,
      });
    }

    return {
      ok: true,
      provider: 'wechat',
      responseBody: JSON.stringify({ code: 'SUCCESS', message: '成功' }),
      httpStatus: 200,
    };
  }

  async handleAlipayNotify(formFields: Record<string, string>): Promise<WebhookDispatchResult> {
    const ok = this.alipay.checkNotifySign(formFields);
    if (!ok) {
      return {
        ok: false,
        provider: 'alipay',
        responseBody: 'fail',
        httpStatus: 401,
        error: '支付宝回调验签失败',
      };
    }

    const status = formFields.trade_status || '';
    const outTradeNo = formFields.out_trade_no || '';
    if ((status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') && outTradeNo) {
      await this.onPaid({
        provider: 'alipay',
        outTradeNo,
        tradeState: status,
        platformTradeNo: formFields.trade_no,
        paidAt: formFields.gmt_payment,
      });
    }

    return {
      ok: true,
      provider: 'alipay',
      httpStatus: 200,
      responseBody: 'success',
    };
  }
}

export function createDualServicePaymentManager(onPaid: PaymentOrderUpdater): DualServicePaymentManager {
  return new DualServicePaymentManager(onPaid);
}
