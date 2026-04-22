import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, parseSessionCookie, requestIsHttps } from '@/lib/localAuth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const parsed = parseSessionCookie(req.cookies.get('opti_local_session_v1')?.value);
    if (parsed?.id) {
      await prisma.$executeRawUnsafe(
        `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        parsed.id,
      );
    }
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res, { secure: requestIsHttps(req) });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const res = NextResponse.json({ ok: false, error: message }, { status: 500 });
    clearSessionCookie(res, { secure: requestIsHttps(req) });
    return res;
  }
}
