/**
 * 微信小程序：client_credential access_token 缓存 + 手机号 code 换号
 * @see https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html
 */

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getMiniProgramAccessToken(): Promise<string> {
  const appid = process.env.WECHAT_MINI_APP_ID || process.env.WXP_APP_ID || '';
  const secret = process.env.WECHAT_MINI_APP_SECRET || process.env.WXP_APP_SECRET || '';
  if (!appid || !secret) {
    throw new Error('服务端未配置 WECHAT_MINI_APP_ID 或 WECHAT_MINI_APP_SECRET');
  }
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!data.access_token) {
    throw new Error(data.errmsg || `获取 access_token 失败 errcode=${data.errcode}`);
  }
  const ttlSec = data.expires_in ?? 7200;
  tokenCache = { token: data.access_token, expiresAt: now + ttlSec * 1000 };
  return tokenCache.token;
}

/** 将 getPhoneNumber 回调里的 code 换为纯数字手机号（一般为 11 位） */
export async function getPurePhoneNumberFromWxCode(code: string): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('code 为空');

  const accessToken = await getMiniProgramAccessToken();
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: trimmed }),
    },
  );
  const data = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    phone_info?: { purePhoneNumber?: string; phoneNumber?: string };
  };
  if (data.errcode !== 0) {
    throw new Error(data.errmsg || `getuserphonenumber 失败 errcode=${data.errcode}`);
  }
  const raw = data.phone_info?.purePhoneNumber || data.phone_info?.phoneNumber || '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 11) {
    throw new Error('未解析到有效手机号');
  }
  return digits.slice(-11);
}
