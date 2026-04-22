import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionForUser,
  ensureLocalAuthSchema,
  hashPassword,
  maybeBootstrapLocalAdmin,
  ONE_YEAR_SECONDS,
  requestIsHttps,
  setSessionCookie,
  verifyPassword,
} from '@/lib/localAuth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type LoginBody = { email?: unknown; password?: unknown };

export async function POST(req: NextRequest) {
  try {
    await ensureLocalAuthSchema();
    const body = (await req.json().catch(() => ({}))) as LoginBody;
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '').trim();
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: '请输入账号和密码' }, { status: 400 });
    }

    let rows = (await prisma.$queryRawUnsafe(
      `
        SELECT id, email, role, status, password_hash
          FROM users
         WHERE lower(email) = $1
         LIMIT 1
      `,
      email,
    )) as Array<{ id: string; email: string | null; role: string; status: string; password_hash: string | null }>;

    if (!rows[0]) {
      const bootstrap = await maybeBootstrapLocalAdmin(email, password);
      if (bootstrap) {
        rows = [
          {
            id: bootstrap.id,
            email: bootstrap.email,
            role: bootstrap.role,
            status: bootstrap.status,
            password_hash: null,
          },
        ];
      }
    }

    const user = rows[0];
    if (!user) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 401 });
    if (String(user.status || '').toUpperCase() !== 'ACTIVE') {
      return NextResponse.json({ ok: false, error: '账号已禁用' }, { status: 403 });
    }

    if (user.password_hash && !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 });
    }

    if (!user.password_hash) {
      const firstHash = hashPassword(password);
      await prisma.$executeRawUnsafe(`UPDATE users SET password_hash = $2, "updatedAt" = NOW() WHERE id = $1`, user.id, firstHash);
    }

    const session = await createSessionForUser(user.id, req.headers.get('user-agent'));
    const res = NextResponse.json({
      ok: true,
      session: {
        user: { id: user.id, email: user.email || email },
        expiresAt: session.expiresAtIso,
      },
      profile: {
        user_id: user.id,
        full_name: user.email || email,
        role: user.role,
        store_id: null,
      },
    });
    setSessionCookie(res, session.id, session.secret, ONE_YEAR_SECONDS, { secure: requestIsHttps(req) });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
