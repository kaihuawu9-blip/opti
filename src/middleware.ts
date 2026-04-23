import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * 返回二进制或非 JSON 的 Route（勿在 middleware 里强行覆盖 Content-Type）。
 * 新增流式/文件接口时请在此登记。
 */
const API_BINARY_OR_STREAM_PREFIXES: readonly string[] = [
  '/api/tts/edge',
  '/api/proxy-image',
  '/api/try-on/oss-read',
  '/api/video/generate',
];

function shouldSkipJsonContentType(pathname: string): boolean {
  return API_BINARY_OR_STREAM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isMultipartRequest(request: NextRequest): boolean {
  const t = (request.headers.get('content-type') || '').toLowerCase();
  return t.includes('multipart/form-data');
}

/**
 * `/api/*`：
 * - 禁止在此做 HTML 登录重定向；鉴权失败应走各 Route 的 `NextResponse.json`。
 * - 为 JSON API 统一附加 `Content-Type: application/json`（二进制路由见白名单跳过）。
 * - 对 `multipart/form-data` 的 POST 勿在 middleware 中预设响应 Content-Type，否则在部分运行时下 Route 内 `formData()` 会报类型不符。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const res = NextResponse.next();
  const skipJson = shouldSkipJsonContentType(pathname) || isMultipartRequest(request);
  if (!skipJson) {
    res.headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  res.headers.set('X-Opti-Api-Gateway', '1');
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
