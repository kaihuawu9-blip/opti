import axios from 'axios';
import WxPay from 'wechatpay-node-v3';

const PARTNER_NATIVE_URL = 'https://api.mch.weixin.qq.com/v3/pay/partner/transactions/native';

/**
 * 继承 WxPay 以使用受保护的 buildAuthorization / getHeaders，请求服务商 Native 下单。
 */
export class WechatServiceProviderClient extends WxPay {
  async partnerTransactionsNative(body: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wechatpay-node-v3 签名参数类型较宽
    const authorization = this.buildAuthorization('POST', PARTNER_NATIVE_URL, body as Record<string, any>);
    const headers = this.getHeaders(authorization, { 'Content-Type': 'application/json' });
    return axios.post<{ code_url?: string }>(PARTNER_NATIVE_URL, body, {
      headers: headers as Record<string, string>,
      validateStatus: () => true,
    });
  }
}
