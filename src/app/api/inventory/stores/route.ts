import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function GET() {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const rows = await prisma.stores.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return NextResponse.json({ ok: true, data: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** 无门店时由收银台/bootstrap 创建默认门店（与 Prisma stores 表一致） */
export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name ?? '镜售总店').trim() || '镜售总店';
    const row = await prisma.stores.create({
      data: { name },
      select: { id: true, name: true },
    });
    return NextResponse.json({ ok: true, data: row });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
