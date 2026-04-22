import { createClient } from '@supabase/supabase-js';

/**
 * 阿里云侧 PostgREST / 自建 API 网关（通过 `@supabase/supabase-js` 仅作 REST 客户端，不依赖 Supabase 托管）。
 *
 * 浏览器端 **必须** 使用 `NEXT_PUBLIC_ALIYUN_REST_URL` 作为 PostgREST 根（与 `select=` 等查询前缀一致），
 * 禁止回退到 Next.js 页面站点根（否则请求落到 HTML 静态站 / 404）。
 * 服务端优先读 `ALIYUN_REST_URL`，未设时再读 `NEXT_PUBLIC_ALIYUN_REST_URL`。
 */
function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

function normalizeAliyunRestUrl(raw: string): string {
  const v = trimTrailingSlashes(raw.trim());
  if (!v) return v;
  try {
    const u = new URL(v);
    if (!/\/rest\/v1$/i.test(u.pathname)) {
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/rest/v1`.replace(/\/{2,}/g, '/');
    }
    return trimTrailingSlashes(u.toString());
  } catch {
    // 非 URL 字符串兜底拼接（例如测试环境的相对路径）
    if (/\/rest\/v1$/i.test(v)) return v;
    return `${v.replace(/\/+$/, '')}/rest/v1`;
  }
}

export function getCloudRestUrl(): string {
  if (typeof window !== 'undefined') {
    const pub = process.env.NEXT_PUBLIC_ALIYUN_REST_URL?.trim();
    if (pub) return normalizeAliyunRestUrl(pub);
    const fallback = (
      process.env.ALIYUN_REST_URL?.trim() ||
      process.env.NEXT_PUBLIC_ALIYUN_REST_URL?.trim() ||
      ''
    ).trim();
    if (fallback) return normalizeAliyunRestUrl(fallback);
    return 'https://placeholder.invalid';
  }
  return normalizeAliyunRestUrl(
    process.env.ALIYUN_REST_URL?.trim() ||
      process.env.NEXT_PUBLIC_ALIYUN_REST_URL?.trim() ||
      'https://placeholder.invalid',
  );
}

export function getCloudRestAnonKey(): string {
  return (
    process.env.ALIYUN_REST_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_ALIYUN_REST_ANON_KEY?.trim() ||
    'placeholder-anon-key'
  );
}

export function getCloudRestServiceKey(): string {
  return (process.env.ALIYUN_REST_SERVICE_KEY?.trim() || '').trim();
}

const cloudRestUrl = getCloudRestUrl();
const cloudRestAnonKey = getCloudRestAnonKey();

function isTruthyEnv(v: string | undefined): boolean {
  const normalized = String(v ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * 校验网关与 anon 是否已配置（避免 placeholder 导致前端大量失败请求）。
 * 调试可设 NEXT_PUBLIC_FORCE_CLOUD_REST_CONFIGURED=true。
 */
export const isCloudRestConfigured =
  isTruthyEnv(process.env.NEXT_PUBLIC_FORCE_CLOUD_REST_CONFIGURED) ||
  (!!cloudRestUrl &&
    !!cloudRestAnonKey &&
    !cloudRestUrl.includes('placeholder.invalid') &&
    !cloudRestAnonKey.includes('placeholder-anon-key'));

export const cloudRestConfigHint =
  '云端数据接口未配置。浏览器侧请在 `.env` 填写 **NEXT_PUBLIC_ALIYUN_REST_URL**（PostgREST 网关根，勿填 Next 页面域名）与 **NEXT_PUBLIC_ALIYUN_REST_ANON_KEY**；服务端可另设 ALIYUN_REST_URL / ALIYUN_REST_ANON_KEY。保存后重新构建并启动。';

/** 与 PostgREST 兼容的 REST 客户端（浏览器与 Node 共用同一工厂）。 */
export const cloudRest = createClient(cloudRestUrl, cloudRestAnonKey);
