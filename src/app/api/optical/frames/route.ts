import { NextRequest, NextResponse } from 'next/server';
import { createFrame, listFrames } from '@/lib/opticalRepo';

export const dynamic = 'force-dynamic';

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function GET() {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const data = await listFrames();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    const body = (await req.json()) as Record<string, unknown>;
    const brand = String(body.brand ?? '').trim();
    const model = String(body.model ?? '').trim();
    const size = String(body.size ?? '').trim();
    const color = String(body.color ?? '').trim();
    const material = String(body.material ?? '').trim();
    const price = Number(body.price);
    const inventory = Number(body.inventory ?? 0);
    const ossImageUrl = body.ossImageUrl != null ? String(body.ossImageUrl) : null;

    if (!brand || !model || !size || !color || !material || !Number.isFinite(price)) {
      return NextResponse.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
    }

    const row = await createFrame({
      brand,
      model,
      size,
      color,
      material,
      price,
      inventory: Number.isFinite(inventory) ? Math.trunc(inventory) : 0,
      ossImageUrl,
    });
    return NextResponse.json({ ok: true, data: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
