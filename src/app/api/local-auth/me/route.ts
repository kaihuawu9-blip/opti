import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromRequest } from '@/lib/localAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveSessionFromRequest(req);
    if (!resolved) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
    return NextResponse.json({
      ok: true,
      session: {
        user: { id: resolved.user.id, email: resolved.user.email || '' },
      },
      profile: {
        user_id: resolved.user.id,
        full_name: resolved.user.email || '本地账号',
        role: resolved.user.role,
        store_id: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
