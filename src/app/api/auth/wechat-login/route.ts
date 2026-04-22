import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signMiniprogramToken } from '@/lib/auth/miniprogramJwt';

export const runtime = 'nodejs';

type WechatSessionResponse = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

function getWechatConfig() {
  const appId = (process.env.WXP_APP_ID || '').trim();
  const appSecret = (process.env.WXP_APP_SECRET || '').trim();
  const loginUrl = (process.env.WXP_LOGIN_URL || 'https://qq.com/sns/jscode2session').trim();

  if (!appId || !appSecret) {
    throw new Error('服务端未配置 WXP_APP_ID 或 WXP_APP_SECRET');
  }

  return { appId, appSecret, loginUrl };
}

async function exchangeCodeForOpenid(code: string): Promise<string> {
  const { appId, appSecret, loginUrl } = getWechatConfig();
  const url = new URL(loginUrl);
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const raw = await resp.text();
    throw new Error(`微信鉴权请求失败: ${raw.slice(0, 300)}`);
  }

  let data: WechatSessionResponse;
  try {
    data = (await resp.json()) as WechatSessionResponse;
  } catch {
    throw new Error('微信鉴权响应不是 JSON');
  }

  if (data.errcode) {
    throw new Error(`微信鉴权失败: ${data.errmsg || `errcode=${data.errcode}`}`);
  }

  const openid = (data.openid || '').trim();
  if (!openid) {
    throw new Error('微信返回 openid 为空');
  }

  return openid;
}

function normalizeRole(input: unknown): 'customer' | 'staff' {
  return typeof input === 'string' && input.trim().toLowerCase() === 'staff' ? 'staff' : 'customer';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { code?: string; role?: string };
    const code = (body.code || '').trim();
    if (!code) {
      return NextResponse.json({ ok: false, error: 'code 不能为空' }, { status: 400 });
    }

    const role = normalizeRole(body.role);
    const openid = await exchangeCodeForOpenid(code);

    const existingUser = await prisma.user.findUnique({
      where: { openid },
      select: {
        id: true,
        openid: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const user =
      existingUser ||
      (await prisma.user.create({
        data: {
          openid,
          role,
          status: role === 'staff' ? 'PENDING_REVIEW' : 'ACTIVE',
        },
        select: {
          id: true,
          openid: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }));

    const accessToken = signMiniprogramToken({
      sub: user.id,
      openid: user.openid,
      role: user.role,
      status: user.status,
    });

    return NextResponse.json({
      ok: true,
      isNew: !existingUser,
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 60 * 60 * 24 * 7,
      user,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
