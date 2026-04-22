import type { PayChannel, PayResult, PaymentOrderUpdater, WebhookDispatchResult } from '@/lib/payments/types';

/**
 * 双通道支付管理器（微信服务商 Native + 支付宝当面付预下单）。
 * 证书/私钥仅允许从环境变量或 *_PATH 指向的文件加载。
 */
export abstract class PaymentManager {
  protected constructor(protected readonly onPaid: PaymentOrderUpdater) {}

  /**
   * 统一下单入口：`amount` 单位为元；`subMchId` 为微信 sub_mchid / 支付宝侧用于解析 app_auth_token 的键。
   */
  async pay(type: PayChannel, amount: number, subMchId: string): Promise<PayResult> {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, outTradeNo: '', error: 'amount 必须为正数（元）' };
    }
    const sub = subMchId.trim();
    if (!sub) {
      return { ok: false, outTradeNo: '', error: 'subMchId 不能为空' };
    }
    if (type === 'wechat') return this.executeWechatPartnerNative(amount, sub);
    return this.executeAlipayFacePrecreate(amount, sub);
  }

  protected abstract executeWechatPartnerNative(amountYuan: number, subMchId: string): Promise<PayResult>;

  protected abstract executeAlipayFacePrecreate(amountYuan: number, subMchId: string): Promise<PayResult>;

  /** 微信支付 V3 异步通知（JSON body） */
  abstract handleWechatNotify(headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<WebhookDispatchResult>;

  /** 支付宝异步通知（form-urlencoded / 表单字段） */
  abstract handleAlipayNotify(formFields: Record<string, string>): Promise<WebhookDispatchResult>;
}
