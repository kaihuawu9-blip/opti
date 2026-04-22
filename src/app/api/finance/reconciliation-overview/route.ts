import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function GET() {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [todayRows, monthRows, yearRows] = await Promise.all([
      prisma.sales.findMany({
        where: { created_at: { gte: todayStart } },
        select: { total_amount: true },
      }),
      prisma.sales.findMany({
        where: { created_at: { gte: monthStart } },
        select: { total_amount: true },
      }),
      prisma.sales.findMany({
        where: { created_at: { gte: yearStart } },
        select: { total_amount: true },
      }),
    ]);

    const todayReceived = todayRows.reduce((sum, r) => sum + toNum(r.total_amount), 0);
    const monthReceived = monthRows.reduce((sum, r) => sum + toNum(r.total_amount), 0);
    const yearReceived = yearRows.reduce((sum, r) => sum + toNum(r.total_amount), 0);

    const estGrossProfit = todayReceived * 0.38;

    return NextResponse.json({
      ok: true,
      data: {
        todayReceived,
        pendingBalance: monthReceived,
        estGrossProfit,
        monthReceived,
        yearReceived,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
