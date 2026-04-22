import { createClient } from '@supabase/supabase-js';
import type { PaymentOrderUpdater } from '@/lib/payments/types';
import { getCloudRestServiceKey, getCloudRestUrl } from '@/lib/cloudRest';

/**
 * 将 payment_transactions 中 **external_txn_no = 商户订单号（pay 返回的 outTradeNo）** 的行更新为已支付。
 * 收银创建 pending 记录时请写入相同的 outTradeNo 到 external_txn_no（或按需改为 qr_payload 等字段并在下方调整查询）。
 */
export function createCloudRestPaymentOrderUpdater(): PaymentOrderUpdater {
  return async ({ outTradeNo, paidAt }) => {
    const url = getCloudRestUrl();
    const key = getCloudRestServiceKey();
    if (!url || !key || url.includes('placeholder.invalid')) {
      throw new Error('缺少有效的云端 REST 网关 URL 或服务密钥（ALIYUN_REST_SERVICE_KEY），无法更新订单');
    }
    const admin = createClient(url, key, { auth: { persistSession: false } });

    const { error } = await admin
      .from('payment_transactions')
      .update({
        status: 'paid',
        paid_at: paidAt || new Date().toISOString(),
      })
      .eq('external_txn_no', outTradeNo);

    if (error) throw new Error(error.message);
  };
}
