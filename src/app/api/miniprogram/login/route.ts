import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function getExpectedToken(): string {
  return (process.env.MINIPROGRAM_CHAT_TOKEN || process.env.NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN || '').trim();
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
}

const rateBucket = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const item = rateBucket.get(key);
  if (!item || now > item.resetAt) {
    rateBucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (item.count >= limit) return false;
  item.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const expectedToken = getExpectedToken();
    if (!expectedToken) {
      return NextResponse.json({ ok: false, error: '服务端未配置小程序鉴权 Token' }, { status: 500 });
    }

    const tokenFromHeader = (req.headers.get('x-client-token') || '').trim();
    if (tokenFromHeader !== expectedToken) {
      return NextResponse.json({ ok: false, error: '鉴权失败' }, { status: 401 });
    }

    const ip = getClientIp(req);
    if (!checkRateLimit(`wx-login:${ip}`, 60, 60_000)) {
      return NextResponse.json({ ok: false, error: '请求过于频繁，请稍后再试' }, { status: 429 });
    }

    const body = (await req.json()) as { openid?: string };
    const openid = (body.openid || '').trim();
    if (!openid) {
      return NextResponse.json({ ok: false, error: 'openid 不能为空' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { openid },
      select: { id: true, openid: true, createdAt: true, updatedAt: true },
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        isNew: false,
        user: existing,
      });
    }

    const created = await prisma.user.create({
      data: { openid },
      select: { id: true, openid: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({
      ok: true,
      isNew: true,
      user: created,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
