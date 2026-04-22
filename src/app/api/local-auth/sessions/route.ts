import { NextRequest, NextResponse } from 'next/server';
import {
  clearSessionCookie,
  parseSessionCookie,
  requestIsHttps,
  resolveSessionFromRequest,
} from '@/lib/localAuth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type SessionRow = {
  id: string;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  is_current: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const current = await resolveSessionFromRequest(req);
    if (!current) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
    const currentCookie = parseSessionCookie(req.cookies.get('opti_local_session_v1')?.value);
    const rows = (await prisma.$queryRawUnsafe(
      `
        SELECT id,
               user_agent,
               expires_at::text,
               created_at::text,
               revoked_at::text,
               CASE WHEN id = $2 THEN true ELSE false END AS is_current
          FROM user_sessions
         WHERE user_id = $1
         ORDER BY created_at DESC
      `,
      current.user.id,
      currentCookie?.id || '',
    )) as SessionRow[];
    return NextResponse.json({ ok: true, sessions: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const current = await resolveSessionFromRequest(req);
    if (!current) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
    const mode = (req.nextUrl.searchParams.get('mode') || 'others').trim().toLowerCase();
    const currentCookie = parseSessionCookie(req.cookies.get('opti_local_session_v1')?.value);

    if (mode === 'all') {
      await prisma.$executeRawUnsafe(
        `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        current.user.id,
      );
      const res = NextResponse.json({ ok: true, revoked: 'all' });
      clearSessionCookie(res, { secure: requestIsHttps(req) });
      return res;
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE user_sessions
           SET revoked_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND id <> $2
      `,
      current.user.id,
      currentCookie?.id || '',
    );
    return NextResponse.json({ ok: true, revoked: 'others' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
