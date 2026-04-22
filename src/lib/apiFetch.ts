/**
 * 本站 `/api/*` 请求的 JSON 安全封装：避免把 Nginx/HTML 404 误当 JSON 解析。
 */

export const API_ROUTE_MISCONFIGURED_ZH = '網關路徑配置錯誤';

export class ApiJsonFetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ApiJsonFetchError';
    this.status = status;
    this.url = url;
  }
}

function isProbablyHtml(contentType: string | null, bodyPreview: string): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  if (/<!doctype\s+html/i.test(bodyPreview) || /<html[\s>]/i.test(bodyPreview)) return true;
  return false;
}

function includesDoctypeHtml(body: string): boolean {
  return /<!doctype\s+html/i.test(body);
}

function notifyApiRouteMisconfigured() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('opti-app-toast', {
        detail: { message: API_ROUTE_MISCONFIGURED_ZH, variant: 'error' as const },
      }),
    );
  } catch {
    window.alert(API_ROUTE_MISCONFIGURED_ZH);
  }
}

/**
 * `fetch` 后读取 JSON：若响应为 404 或 HTML 错误页，提示架构问题并中止解析。
 * @param input 建议传入同源路径 `/api/...`。
 */
export async function fetchApiJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ res: Response; data: T }> {
  const res = await fetch(input, init);
  const ct = res.headers.get('content-type');
  const resolvedUrl = res.url || (typeof input === 'string' ? input : String(input));
  let pathname = '';
  try {
    pathname = new URL(resolvedUrl, 'http://localhost').pathname;
  } catch {
    pathname = '';
  }

  if (res.status === 404 && pathname.startsWith('/api/')) {
    notifyApiRouteMisconfigured();
    throw new ApiJsonFetchError(API_ROUTE_MISCONFIGURED_ZH, 404, resolvedUrl);
  }

  const text = await res.text();
  if (includesDoctypeHtml(text) || isProbablyHtml(ct, text.slice(0, 600))) {
    notifyApiRouteMisconfigured();
    throw new ApiJsonFetchError('網關路徑配置錯誤：接口返回 HTML，请检查 REST 网关路径。', res.status, resolvedUrl);
  }

  const lowerCt = (ct || '').toLowerCase();
  if (!lowerCt.includes('application/json')) {
    try {
      const data = JSON.parse(text || 'null') as T;
      return { res, data };
    } catch {
      throw new ApiJsonFetchError('响应不是合法 JSON', res.status, resolvedUrl);
    }
  }

  try {
    const data = (text ? JSON.parse(text) : null) as T;
    return { res, data };
  } catch {
    notifyApiRouteMisconfigured();
    throw new ApiJsonFetchError('JSON 解析失败（可能为 HTML 错误页）', res.status, resolvedUrl);
  }
}
