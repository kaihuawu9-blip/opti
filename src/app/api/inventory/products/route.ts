import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PRODUCT_BASE_SELECT = {
  id: true,
  store_id: true,
  name: true,
  stock: true,
  price: true,
} as const;

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function safeFiniteNumber(v: unknown, fallback: number): number {
  try {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function safeInt(v: unknown, fallback: number): number {
  try {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  } catch {
    return fallback;
  }
}

function optionalTrimmedString(v: unknown): string | null {
  try {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

/** 库表可能没有 category 等扩展列：有则用字符串，否则「其他」。任意一步异常都不向上抛出。 */
function normalizeCategory(raw: unknown): string {
  try {
    if (raw == null) return '其他';
    const s = String(raw).trim();
    return s || '其他';
  } catch {
    return '其他';
  }
}

/** 单行映射失败时返回可序列化的兜底对象，避免 GET 整表 map 时一条脏数据拖垮 API。 */
function fallbackMappedRow(partialId: string): {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  brand: string | null;
  model: string | null;
  frame_type: string | null;
  lens_type: string | null;
  created_at: string;
  allow_discount: boolean;
  allow_points: boolean;
  allow_promo_price: boolean;
  is_hot: boolean;
  is_promo: boolean;
  promo_price: number | null;
  low_stock_threshold: number;
  store_id: string | null;
} {
  return {
    id: partialId || 'unknown',
    name: '',
    price: 0,
    stock: 0,
    category: '其他',
    brand: null,
    model: null,
    frame_type: null,
    lens_type: null,
    created_at: new Date().toISOString(),
    allow_discount: true,
    allow_points: true,
    allow_promo_price: true,
    is_hot: false,
    is_promo: false,
    promo_price: null,
    low_stock_threshold: 10,
    store_id: null,
  };
}

/**
 * 当前 Prisma 模型以 id/store_id/name/stock/price 为主；若库里有 category 等列（未反映在 schema 时也可能经扩展查询传入），在此安全读取。
 * 全程 try-catch + 空值保护，避免 Decimal/异常类型导致整接口 500。
 */
function mapRow(p: {
  id: string;
  store_id: string | null;
  name: string | null;
  stock: number | null;
  price: unknown;
  category?: unknown;
  brand?: unknown;
  model?: unknown;
  frame_type?: unknown;
  lens_type?: unknown;
  low_stock_threshold?: unknown;
  allow_discount?: unknown;
  allow_points?: unknown;
  allow_promo_price?: unknown;
  is_hot?: unknown;
  is_promo?: unknown;
  promo_price?: unknown;
}) {
  try {
    const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : '';
    if (!id) {
      return fallbackMappedRow('');
    }

    const category = Object.prototype.hasOwnProperty.call(p, 'category')
      ? normalizeCategory(p.category)
      : '其他';

    return {
      id,
      name: p.name != null ? String(p.name) : '',
      price: safeFiniteNumber(p.price, 0),
      stock: safeInt(p.stock, 0),
      category,
      brand: optionalTrimmedString(p.brand),
      model: optionalTrimmedString(p.model),
      frame_type: optionalTrimmedString(p.frame_type),
      lens_type: optionalTrimmedString(p.lens_type),
      created_at: new Date().toISOString(),
      allow_discount: p.allow_discount !== false,
      allow_points: p.allow_points !== false,
      allow_promo_price: p.allow_promo_price !== false,
      is_hot: Boolean(p.is_hot),
      is_promo: Boolean(p.is_promo),
      promo_price: (() => {
        if (p.promo_price == null || p.promo_price === '') return null;
        const n = Number(p.promo_price);
        return Number.isFinite(n) ? n : null;
      })(),
      low_stock_threshold: Math.max(0, safeInt(p.low_stock_threshold, 10)),
      store_id: typeof p.store_id === 'string' && p.store_id.trim() ? p.store_id.trim() : null,
    };
  } catch (e) {
    console.warn('[api/inventory/products] mapRow failed', e);
    const id = typeof p?.id === 'string' ? p.id.trim() : '';
    return fallbackMappedRow(id);
  }
}

function prismaPayload(body: Record<string, unknown>) {
  const name = body.name != null ? String(body.name).trim() || null : null;
  const stock = body.stock != null ? Number(body.stock) : null;
  const price = body.price != null ? Number(body.price) : null;
  const store_id =
    typeof body.store_id === 'string' && body.store_id.trim() ? body.store_id.trim() : null;
  return {
    name,
    stock: stock != null && Number.isFinite(stock) ? Math.trunc(stock) : null,
    price: price != null && Number.isFinite(price) ? price : null,
    store_id,
  };
}

export async function GET() {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const rows = await prisma.products.findMany({
      orderBy: { name: 'asc' },
      select: PRODUCT_BASE_SELECT,
    });
    return NextResponse.json({ ok: true, data: rows.map(mapRow) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const { name, stock, price, store_id } = prismaPayload(body);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'MISSING_NAME' }, { status: 400 });
    }
    const row = await prisma.products.create({
      data: {
        name,
        stock: stock ?? 0,
        price: price ?? null,
        store_id,
      },
      select: PRODUCT_BASE_SELECT,
    });
    return NextResponse.json({ ok: true, data: mapRow(row) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
    const data: Prisma.productsUpdateInput = {};
    if ('name' in body) {
      const n = body.name != null ? String(body.name).trim() : '';
      data.name = n || null;
    }
    if ('stock' in body) {
      const s = Number(body.stock);
      if (Number.isFinite(s)) data.stock = Math.trunc(s);
    }
    if ('price' in body) {
      const p = Number(body.price);
      data.price = Number.isFinite(p) ? p : null;
    }
    if ('store_id' in body) {
      data.store_id =
        typeof body.store_id === 'string' && body.store_id.trim() ? body.store_id.trim() : null;
    }
    await prisma.products.update({
      where: { id },
      data,
      select: { id: true },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const id = req.nextUrl.searchParams.get('id')?.trim();
    if (!id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
    await prisma.products.delete({
      where: { id },
      select: { id: true },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
