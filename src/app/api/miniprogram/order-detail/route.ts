import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractBearerToken, verifyMiniprogramToken } from '@/lib/auth/miniprogramJwt';

export const runtime = 'nodejs';

type Body = {
  orderId?: string;
  orderNo?: string;
};

type UpdateBody = Body & {
  tint?: {
    id?: string;
    name?: string;
    hex?: string;
  };
};

function stripTintSuffix(lensType: string | null | undefined): string {
  return (lensType || '').replace(/\s*\/\s*染色:.+$/u, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const bearer = extractBearerToken(req.headers.get('authorization') || '');
    if (!bearer) {
      return NextResponse.json({ ok: false, error: '缺少 Bearer Token' }, { status: 401 });
    }
    try {
      verifyMiniprogramToken(bearer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token 无效';
      return NextResponse.json({ ok: false, error: `鉴权失败: ${msg}` }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const orderId = (body.orderId || '').trim();
    const orderNo = (body.orderNo || '').trim();
    if (!orderId && !orderNo) {
      return NextResponse.json({ ok: false, error: 'orderId 或 orderNo 至少提供一个' }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [
          ...(orderId ? [{ id: orderId }] : []),
          ...(orderNo ? [{ orderNo }] : []),
        ],
      },
      include: {
        prescription: true,
        frame: true,
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: '未找到订单' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        totalPrice: order.totalPrice,
        lensType: order.lensType,
        lensThickness: order.lensThickness,
        createdAt: order.createdAt,
        prescription: {
          id: order.prescription.id,
          customerName: order.prescription.customerName,
          phone: order.prescription.phone,
          right: {
            ds: order.prescription.rightSph,
            dc: order.prescription.rightCyl,
            axis: order.prescription.rightAxis,
          },
          left: {
            ds: order.prescription.leftSph,
            dc: order.prescription.leftCyl,
            axis: order.prescription.leftAxis,
          },
          pd: order.prescription.pd,
          ph: order.prescription.ph,
          createdAt: order.prescription.createdAt,
        },
        frame: order.frame
          ? {
              id: order.frame.id,
              brand: order.frame.brand,
              model: order.frame.model,
              size: order.frame.size,
              color: order.frame.color,
              material: order.frame.material,
              imageUrl: order.frame.ossImageUrl,
            }
          : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const bearer = extractBearerToken(req.headers.get('authorization') || '');
    if (!bearer) {
      return NextResponse.json({ ok: false, error: '缺少 Bearer Token' }, { status: 401 });
    }
    try {
      verifyMiniprogramToken(bearer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token 无效';
      return NextResponse.json({ ok: false, error: `鉴权失败: ${msg}` }, { status: 401 });
    }

    const body = (await req.json()) as UpdateBody;
    const orderId = (body.orderId || '').trim();
    const orderNo = (body.orderNo || '').trim();
    if (!orderId && !orderNo) {
      return NextResponse.json({ ok: false, error: 'orderId 或 orderNo 至少提供一个' }, { status: 400 });
    }

    const tintName = (body.tint && body.tint.name ? body.tint.name : '').trim();
    if (!tintName) {
      return NextResponse.json({ ok: false, error: '染色名称不能为空' }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [
          ...(orderId ? [{ id: orderId }] : []),
          ...(orderNo ? [{ orderNo }] : []),
        ],
      },
      select: {
        id: true,
        lensType: true,
      },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: '未找到订单' }, { status: 404 });
    }

    const baseLensType = stripTintSuffix(order.lensType) || '镜片';
    const nextLensType = `${baseLensType} / 染色:${tintName}`;
    await prisma.order.update({
      where: { id: order.id },
      data: { lensType: nextLensType },
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: order.id,
        lensType: nextLensType,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
