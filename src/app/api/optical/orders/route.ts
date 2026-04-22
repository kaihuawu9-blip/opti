import { NextRequest, NextResponse } from 'next/server';
import { createOrder, listOrders } from '@/lib/opticalRepo';

export const dynamic = 'force-dynamic';

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function GET() {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const data = await listOrders();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const body = (await req.json()) as Record<string, unknown>;
    const orderNo = String(body.orderNo ?? '').trim();
    const prescriptionId = String(body.prescriptionId ?? '').trim();
    const totalPrice = Number(body.totalPrice);

    if (!orderNo || !prescriptionId || !Number.isFinite(totalPrice)) {
      return NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
    }

    const row = await createOrder({
      orderNo,
      prescriptionId,
      frameId: body.frameId != null ? String(body.frameId) : null,
      lensType: body.lensType != null ? String(body.lensType) : null,
      lensThickness: body.lensThickness != null ? Number(body.lensThickness) : null,
      totalPrice,
      status: body.status != null ? String(body.status) : undefined,
    });
    return NextResponse.json({ ok: true, data: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
