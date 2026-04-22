import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Line = {
  product_id: string;
  quantity: number;
  name?: string;
  price?: number | null;
  store_id?: string | null;
};

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * 收银结算扣库：有则扣减数量；无则插入一条新商品，库存直接记为 -quantity（先卖后补）。
 */
export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 503 });
    }
    const body = (await req.json()) as { lines?: Line[] };
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length === 0) {
      return NextResponse.json({ ok: true });
    }

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const id = String(line.product_id || '').trim();
        const qty = Math.trunc(Number(line.quantity));
        if (!id || qty <= 0) continue;

        const existing = await tx.products.findUnique({ where: { id } });
        if (!existing) {
          await tx.products.create({
            data: {
              id,
              name: (line.name && line.name.trim()) || '未命名商品',
              stock: -qty,
              price: line.price != null && Number.isFinite(Number(line.price)) ? Number(line.price) : null,
              store_id:
                line.store_id && String(line.store_id).trim() ? String(line.store_id).trim() : null,
            },
          });
        } else {
          const prev = existing.stock ?? 0;
          await tx.products.update({
            where: { id },
            data: { stock: prev - qty },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
