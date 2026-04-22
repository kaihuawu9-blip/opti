import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * 未匹配到任何具体 `app/api/.../route.ts` 的路径时兜底，避免 Next 默认 HTML 404。
 * 更具体的路由优先于本 optional catch-all。
 */
function notFound() {
  return NextResponse.json({ error: 'API_NOT_FOUND' }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
