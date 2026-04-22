/**
 * 镜售 Opti-AI 公网域名（解析如 114.55.227.24 的 ECS）。
 * 在项目根 `.env` 中覆盖下列 NEXT_PUBLIC_* 即可切换环境，无需改业务代码。
 *
 * - NEXT_PUBLIC_API_URL              对外 API 根（优先于下方两项），如 https://opti-ai.cn
 * - NEXT_PUBLIC_OPTI_AI_SITE_ORIGIN  主站根地址，默认 https://opti-ai.cn
 * - NEXT_PUBLIC_OPTI_AI_API_ORIGIN   API 根（未设 NEXT_PUBLIC_API_URL 时使用），默认 https://api.opti-ai.cn
 * - NEXT_PUBLIC_ALIYUN_REST_URL 可选；浏览器侧访问云端 REST 网关（与 ALIYUN_REST_URL 对齐）
 */

export const OPTI_AI_SITE_ORIGIN_DEFAULT = 'https://opti-ai.cn';
// 默认与主站同源，避免未配置 api 子域时触发跨域或证书问题。
export const OPTI_AI_API_ORIGIN_DEFAULT = 'https://opti-ai.cn';
const OPTI_AI_ALLOWED_HOSTS = new Set(['opti-ai.cn', 'www.opti-ai.cn']);

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

function normalizeOrigin(raw: string | undefined, fallback: string): string {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  const normalized = trimTrailingSlashes(v);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:') return fallback;
    if (!OPTI_AI_ALLOWED_HOSTS.has(parsed.hostname)) return fallback;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}

/** 主站 origin，无末尾斜杠 */
export function getOptiAiSiteOrigin(): string {
  return normalizeOrigin(process.env.NEXT_PUBLIC_OPTI_AI_SITE_ORIGIN, OPTI_AI_SITE_ORIGIN_DEFAULT);
}

/** API 网关 origin，无末尾斜杠（优先 NEXT_PUBLIC_API_URL，其次 NEXT_PUBLIC_OPTI_AI_API_ORIGIN） */
export function getOptiAiApiOrigin(): string {
  const primary = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (primary) return normalizeOrigin(primary, OPTI_AI_API_ORIGIN_DEFAULT);
  return normalizeOrigin(process.env.NEXT_PUBLIC_OPTI_AI_API_ORIGIN, OPTI_AI_API_ORIGIN_DEFAULT);
}

/** 拼接 API 绝对 URL，path 须以 / 开头 */
export function optiAiApiUrl(path: string): string {
  const base = getOptiAiApiOrigin();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * 浏览器端解析 API 根：在已备案主域（含 www）上优先使用当前页面的 origin，
 * 避免 NEXT_PUBLIC_API_URL 指向 apex 而用户从 www 访问时跨站丢 Cookie。
 */
export function resolveClientApiOriginForBrowser(): string {
  if (typeof window === 'undefined') return getOptiAiApiOrigin();
  const h = window.location.hostname;
  if (h === 'opti-ai.cn' || h === 'www.opti-ai.cn') {
    return window.location.origin.replace(/\/+$/, '');
  }
  return getOptiAiApiOrigin();
}

/** 桌面端更新清单默认地址（可被 NEXT_PUBLIC_UPDATE_MANIFEST_URL 覆盖） */
export function getDefaultUpdateManifestUrl(): string {
  return `${getOptiAiSiteOrigin()}/update-manifest.json`;
}
