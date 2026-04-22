import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractBearerToken, verifyMiniprogramToken } from '@/lib/auth/miniprogramJwt';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const bearer = extractBearerToken(req.headers.get('authorization') || '');
    if (!bearer) {
      return NextResponse.json({ ok: false, error: '缺少 Bearer Token' }, { status: 401 });
    }

    let payload;
    try {
      payload = verifyMiniprogramToken(bearer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token 无效';
      return NextResponse.json({ ok: false, error: `鉴权失败: ${msg}` }, { status: 401 });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ id: payload.sub }, { openid: payload.openid }],
      },
      select: {
        id: true,
        openid: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: '用户不存在，请重新登录' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      user,
      role: user.role,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
