import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractBearerToken, verifyMiniprogramToken } from '@/lib/auth/miniprogramJwt';
import { getPurePhoneNumberFromWxCode } from '@/lib/wechatMiniPhone';

export const runtime = 'nodejs';

type RequestBody = {
  openid?: string;
  phone?: string;
  phoneCode?: string;
};

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 11 ? digits.slice(-11) : '';
}

function maskPhone(phone: string): string {
  if (!phone || phone.length !== 11) return '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function toPrescriptionView(row: {
  id: string;
  customerName: string | null;
  phone: string | null;
  rightSph: number;
  rightCyl: number | null;
  rightAxis: number | null;
  leftSph: number;
  leftCyl: number | null;
  leftAxis: number | null;
  pd: number;
  ph: number | null;
  status: string;
  createdAt: Date;
  orders: Array<{
    id: string;
    orderNo: string;
    createdAt: Date;
    frame: {
      id: string;
      brand: string;
      model: string;
      ossImageUrl: string | null;
    } | null;
  }>;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    customerName: row.customerName || '',
    phoneMasked: maskPhone(normalizePhone(row.phone || '')),
    status: row.status,
    prescription: {
      right: {
        ds: row.rightSph,
        dc: row.rightCyl,
        axis: row.rightAxis,
      },
      left: {
        ds: row.leftSph,
        dc: row.leftCyl,
        axis: row.leftAxis,
      },
      pd: row.pd,
      ph: row.ph,
    },
    frames: row.orders
      .filter((order) => !!order.frame)
      .map((order) => ({
        orderId: order.id,
        orderNo: order.orderNo,
        frameId: order.frame!.id,
        frameBrand: order.frame!.brand,
        frameModel: order.frame!.model,
        frameImageUrl: order.frame!.ossImageUrl,
        orderCreatedAt: order.createdAt,
      })),
  };
}

export async function POST(req: NextRequest) {
  try {
    const bearerToken = extractBearerToken(req.headers.get('authorization') || '');
    if (!bearerToken) {
      return NextResponse.json({ ok: false, error: '缺少 Bearer Token' }, { status: 401 });
    }

    let tokenPayload;
    try {
      tokenPayload = verifyMiniprogramToken(bearerToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token 无效';
      return NextResponse.json({ ok: false, error: `鉴权失败: ${msg}` }, { status: 401 });
    }

    const body = (await req.json()) as RequestBody;
    const bodyOpenid = (body.openid || '').trim();
    const tokenOpenid = (tokenPayload.openid || '').trim();
    const openid = bodyOpenid || tokenOpenid;

    if (!openid) {
      return NextResponse.json({ ok: false, error: 'openid 不能为空' }, { status: 400 });
    }
    if (bodyOpenid && bodyOpenid !== tokenOpenid) {
      return NextResponse.json({ ok: false, error: 'openid 与登录态不匹配' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { openid },
      select: {
        id: true,
        openid: true,
        phone: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: '用户不存在，请重新登录' }, { status: 404 });
    }

    let resolvedPhone = normalizePhone((body.phone || '').trim()) || normalizePhone(user.phone || '');

    const phoneCode = (body.phoneCode || '').trim();
    if (!resolvedPhone && phoneCode) {
      const phoneFromWechat = await getPurePhoneNumberFromWxCode(phoneCode);
      resolvedPhone = normalizePhone(phoneFromWechat);

      await prisma.user.update({
        where: { id: user.id },
        data: { phone: resolvedPhone },
      });
    }

    if (!resolvedPhone) {
      return NextResponse.json({
        ok: false,
        needPhoneAuth: true,
        error: '未绑定手机号，请先调用 getPhoneNumber 完成微信手机号授权',
      });
    }

    if (!user.phone || normalizePhone(user.phone) !== resolvedPhone) {
      await prisma.user.update({
        where: { id: user.id },
        data: { phone: resolvedPhone },
      });
    }

    const rows = await prisma.prescription.findMany({
      where: {
        OR: [
          { phone: resolvedPhone },
          { customer: { customerPhone: resolvedPhone } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNo: true,
            createdAt: true,
            frame: {
              select: {
                id: true,
                brand: true,
                model: true,
                ossImageUrl: true,
              },
            },
          },
        },
      },
      take: 100,
    });

    return NextResponse.json({
      ok: true,
      needPhoneAuth: false,
      phoneMasked: maskPhone(resolvedPhone),
      reports: rows.map(toPrescriptionView),
      total: rows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
