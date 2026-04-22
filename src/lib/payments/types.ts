export type PayChannel = 'wechat' | 'alipay';

export type PayResult = {
  ok: boolean;
  /** 商户侧订单号，需写入 payment_transactions.external_txn_no（或你方约定字段）以便回调对账 */
  outTradeNo: string;
  /** 微信 Native：code_url；支付宝预创建：qr_code（或当面付扩展字段） */
  payload?: {
    codeUrl?: string;
    qrCode?: string;
    raw?: unknown;
  };
  error?: string;
};

export type WebhookDispatchResult = {
  ok: boolean;
  provider: PayChannel;
  /** 应答支付平台用的 body（微信 V3 须 JSON） */
  responseBody: string;
  httpStatus: number;
  /** 验签失败等原因 */
  error?: string;
};

/** 验签通过后由业务层更新库 */
export type PaymentOrderUpdater = (ctx: {
  provider: PayChannel;
  outTradeNo: string;
  /** 微信 SUCCESS / 支付宝 TRADE_SUCCESS 等 */
  tradeState: string;
  platformTradeNo?: string;
  paidAt?: string;
}) => Promise<void>;
