import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  fileRecordFromCreateBody,
  loadInventoryFile,
  mergeFileRecordFromBody,
  newInventoryId,
  saveInventoryFile,
  isLocalInventoryFileEnabled,
  parseProductExtensionFromBody,
  PRODUCT_EXTENSION_DEFAULTS,
} from '@/lib/inventoryFileStore';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PRODUCT_BASE_SELECT = {
  id: true,
  store_id: true,
  name: true,
  stock: true,
  price: true,
  attributes: true,
} as const;

const EXTENSION_FIELD_KEYS = [
  'category',
  'brand',
  'model',
  'frame_type',
  'lens_type',
  'refractive_index',
  'coating',
  'low_stock_threshold',
  'is_hot',
  'is_promo',
  'promo_price',
  'allow_discount',
  'allow_points',
  'allow_promo_price',
] as const;

function hasExtensionKeyInBody(body: Record<string, unknown>): boolean {
  return (EXTENSION_FIELD_KEYS as readonly string[]).some((k) => k in body);
}

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

function optionalFiniteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategory(raw: unknown): string {
  try {
    if (raw == null) return '其他';
    const s = String(raw).trim();
    return s || '其他';
  } catch {
    return '其他';
  }
}

type MappedProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  brand: string | null;
  model: string | null;
  frame_type: string | null;
  lens_type: string | null;
  refractive_index: number | null;
  coating: string | null;
  created_at: string;
  allow_discount: boolean;
  allow_points: boolean;
  allow_promo_price: boolean;
  is_hot: boolean;
  is_promo: boolean;
  promo_price: number | null;
  low_stock_threshold: number;
  store_id: string | null;
};

function fallbackMappedRow(partialId: string): MappedProduct {
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
    refractive_index: null,
    coating: null,
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
 * 统一映射：Prisma 行会先把 `attributes` JSON 展平再进入此处，与本地 `FileInventoryRecord` 同形。
 */
function mapRow(
  p: {
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
    refractive_index?: unknown;
    coating?: unknown;
    low_stock_threshold?: unknown;
    allow_discount?: unknown;
    allow_points?: unknown;
    allow_promo_price?: unknown;
    is_hot?: unknown;
    is_promo?: unknown;
    promo_price?: unknown;
  },
) {
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
      refractive_index: optionalFiniteNumber(p.refractive_index),
      coating: optionalTrimmedString(p.coating),
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

type PrismaProductRow = {
  id: string;
  store_id: string | null;
  name: string | null;
  stock: number | null;
  price: unknown;
  attributes: unknown;
};

function flattenPrismaRowForMap(r: PrismaProductRow): Parameters<typeof mapRow>[0] {
  const a = r.attributes;
  const { attributes: _drop, ...base } = r;
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    return { ...base, ...(a as Record<string, unknown>) } as Parameters<typeof mapRow>[0];
  }
  return base as Parameters<typeof mapRow>[0];
}

function prismaBasePayload(body: Record<string, unknown>) {
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
    if (isLocalInventoryFileEnabled()) {
      const rows = await loadInventoryFile();
      const sorted = [...rows].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return NextResponse.json({ ok: true, data: sorted.map((r) => mapRow(r)) });
    }
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const rows = await prisma.products.findMany({
      orderBy: { name: 'asc' },
      select: PRODUCT_BASE_SELECT,
    });
    return NextResponse.json({ ok: true, data: rows.map((r) => mapRow(flattenPrismaRowForMap(r))) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (isLocalInventoryFileEnabled()) {
      const n = body.name != null ? String(body.name).trim() : '';
      if (!n) {
        return NextResponse.json({ ok: false, error: 'MISSING_NAME' }, { status: 400 });
      }
      const id = newInventoryId();
      const row = fileRecordFromCreateBody(body, id);
      const all = await loadInventoryFile();
      all.push(row);
      await saveInventoryFile(all);
      return NextResponse.json({ ok: true, data: mapRow(row) });
    }
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
    const { name, stock, price, store_id } = prismaBasePayload(body);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'MISSING_NAME' }, { status: 400 });
    }
    const attr = parseProductExtensionFromBody(body, { ...PRODUCT_EXTENSION_DEFAULTS });
    const row = await prisma.products.create({
      data: {
        name,
        stock: stock ?? 0,
        price: price ?? null,
        store_id,
        attributes: attr as Prisma.InputJsonValue,
      },
      select: PRODUCT_BASE_SELECT,
    });
    return NextResponse.json({ ok: true, data: mapRow(flattenPrismaRowForMap(row)) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });

    if (isLocalInventoryFileEnabled()) {
      const all = await loadInventoryFile();
      const idx = all.findIndex((r) => r.id === id);
      if (idx < 0) {
        return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
      }
      const next = mergeFileRecordFromBody(all[idx], body);
      all[idx] = next;
      await saveInventoryFile(all);
      return NextResponse.json({ ok: true, data: mapRow(next) });
    }
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
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
    if (hasExtensionKeyInBody(body)) {
      const current = await prisma.products.findUnique({
        where: { id },
        select: { attributes: true },
      });
      const prev = (() => {
        const a = current?.attributes;
        if (a && typeof a === 'object' && !Array.isArray(a)) {
          return a as Record<string, unknown>;
        }
        return {};
      })();
      const next = parseProductExtensionFromBody(body, prev);
      data.attributes = next as Prisma.InputJsonValue;
    }

    const row = await prisma.products.update({
      where: { id },
      data,
      select: PRODUCT_BASE_SELECT,
    });
    return NextResponse.json({ ok: true, data: mapRow(flattenPrismaRowForMap(row)) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')?.trim();
    if (!id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });

    if (isLocalInventoryFileEnabled()) {
      const all = await loadInventoryFile();
      const next = all.filter((r) => r.id !== id);
      if (next.length === all.length) {
        return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
      }
      await saveInventoryFile(next);
      return NextResponse.json({ ok: true });
    }
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }
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
