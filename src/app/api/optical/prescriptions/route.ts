import { NextRequest, NextResponse } from 'next/server';
import { createPrescription, listPrescriptions } from '@/lib/opticalRepo';

export const dynamic = 'force-dynamic';

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function n(v: unknown): number {
  return Number(v);
}

export async function GET(req: NextRequest) {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const phone = req.nextUrl.searchParams.get('phone') || undefined;
    const data = await listPrescriptions(phone);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const body = (await req.json()) as Record<string, unknown>;
    const rightSph = n(body.rightSph);
    const leftSph = n(body.leftSph);
    const pd = n(body.pd);

    if (!Number.isFinite(rightSph) || !Number.isFinite(leftSph) || !Number.isFinite(pd)) {
      return NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
    }

    const row = await createPrescription({
      customerName: body.customerName != null ? String(body.customerName) : null,
      phone: body.phone != null ? String(body.phone) : null,
      rightSph,
      rightCyl: body.rightCyl != null ? n(body.rightCyl) : null,
      rightAxis: body.rightAxis != null ? Math.trunc(n(body.rightAxis)) : null,
      leftSph,
      leftCyl: body.leftCyl != null ? n(body.leftCyl) : null,
      leftAxis: body.leftAxis != null ? Math.trunc(n(body.leftAxis)) : null,
      pd,
      ph: body.ph != null ? n(body.ph) : null,
    });
    return NextResponse.json({ ok: true, data: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
