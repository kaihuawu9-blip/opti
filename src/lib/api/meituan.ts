/**
 * @deprecated StandardEye 已不再对接美团外卖核销。
 * 本模块保留一个签名兼容的占位，使得历史引用点（如 `src/app/api/meituan/verify/route.ts`）
 * 仍可编译，并始终返回失败。新业务请改走 `src/lib/api/dataAdapter.ts`（OCR 数据海关）。
 */

export type MeituanVerifyResult = {
  success: false;
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

const DEPRECATED_MESSAGE = '美团外卖核销已下线；StandardEye 不再对接该通道。';

export async function verifyMeituanVoucher(
  _payload: VerifyPayload,
): Promise<MeituanVerifyResult> {
  void _payload;
  return {
    success: false,
    message: DEPRECATED_MESSAGE,
  };
}
