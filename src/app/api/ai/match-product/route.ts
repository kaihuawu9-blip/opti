import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type MatchRequest = {
  text?: string;
  keyword?: string;
  keywords?:
    | string[]
    | {
        name?: string;
        brand?: string;
        model?: string;
      };
  storeId?: string;
  limit?: number;
};

type ProductRow = {
  id: string;
  store_id: string | null;
  name: string | null;
  stock: number | null;
  price: unknown;
};

function normalizeText(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '').trim();
}

function toUniqueKeywords(input: MatchRequest): string[] {
  const raw: string[] = [];
  if (typeof input.text === 'string') raw.push(input.text);
  if (typeof input.keyword === 'string') raw.push(input.keyword);
  if (Array.isArray(input.keywords)) raw.push(...input.keywords);
  if (input.keywords && !Array.isArray(input.keywords)) {
    const obj = input.keywords;
    if (typeof obj.name === 'string') raw.push(obj.name);
    if (typeof obj.brand === 'string') raw.push(obj.brand);
    if (typeof obj.model === 'string') raw.push(obj.model);
  }
  return Array.from(
    new Set(
      raw
        .flatMap((x) => String(x).split(/[\s,，;；/|]+/))
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function mapProduct(p: ProductRow) {
  return {
    id: p.id,
    store_id: p.store_id,
    name: p.name ?? '',
    stock: p.stock ?? 0,
    price: Number(p.price ?? 0),
  };
}

function buildExactPhrases(input: MatchRequest, keywords: string[]): string[] {
  const out: string[] = [];
  if (input.keywords && !Array.isArray(input.keywords)) {
    const { name, brand, model } = input.keywords;
    if (typeof name === 'string' && name.trim()) out.push(name.trim());
    const bm = [brand, model].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (bm.length) {
      out.push(bm.join(' '));
      out.push(bm.join(''));
      out.push(bm.join('-'));
    }
  }
  if (typeof input.text === 'string' && input.text.trim()) {
    out.push(input.text.trim());
  }
  if (keywords.length > 1) {
    out.push(keywords.join(' '));
    out.push(keywords.join(''));
  }
  return Array.from(new Set(out.map((x) => x.trim()).filter(Boolean))).slice(0, 10);
}

function scoreCandidate(name: string, keywords: string[], exactPhrases: string[]): number {
  const normalizedName = normalizeText(name);
  const normalizedPhrases = exactPhrases.map(normalizeText).filter(Boolean);
  if (normalizedPhrases.includes(normalizedName)) return 1000;

  let score = 0;
  for (const phrase of normalizedPhrases) {
    if (phrase && normalizedName.includes(phrase)) score += 200;
  }
  for (const kw of keywords) {
    const n = normalizeText(kw);
    if (!n) continue;
    if (normalizedName.includes(n)) score += 60;
  }
  return score;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MatchRequest;
    const keywords = toUniqueKeywords(body);
    if (keywords.length === 0) {
      return NextResponse.json(
        { ok: false, error: '缺少关键词，请提供 text 或 keywords（如品牌/型号）' },
        { status: 400 },
      );
    }

    const storeId =
      typeof body.storeId === 'string' && body.storeId.trim().length > 0 ? body.storeId.trim() : null;
    const exactPhrases = buildExactPhrases(body, keywords);
    const whereBase = storeId ? { store_id: storeId } : {};

    if (exactPhrases.length > 0) {
      const exactRows = await prisma.products.findMany({
        where: {
          ...whereBase,
          OR: exactPhrases.map((phrase) => ({
            name: { equals: phrase, mode: 'insensitive' },
          })),
        },
        select: { id: true, store_id: true, name: true, stock: true, price: true },
        take: 3,
        orderBy: { name: 'asc' },
      });
      if (exactRows.length === 1) {
        return NextResponse.json({
          ok: true,
          matchType: 'exact',
          matchedBy: exactPhrases,
          product: mapProduct(exactRows[0]),
          candidates: [],
        });
      }
      if (exactRows.length > 1) {
        return NextResponse.json({
          ok: true,
          matchType: 'fuzzy',
          matchedBy: exactPhrases,
          product: null,
          candidates: exactRows.slice(0, 3).map(mapProduct),
        });
      }
    }

    const fuzzyRows = await prisma.products.findMany({
      where: {
        ...whereBase,
        OR: keywords.map((kw) => ({
          name: { contains: kw, mode: 'insensitive' },
        })),
      },
      select: { id: true, store_id: true, name: true, stock: true, price: true },
      take: Math.max(3, Math.min(Number(body.limit) || 20, 50)),
      orderBy: { name: 'asc' },
    });

    if (fuzzyRows.length === 0) {
      return NextResponse.json({
        ok: true,
        matchType: 'none',
        matchedBy: keywords,
        product: null,
        candidates: [],
      });
    }

    const ranked = fuzzyRows
      .map((r) => ({
        row: r,
        score: scoreCandidate(String(r.name || ''), keywords, exactPhrases),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best && best.score >= 1000) {
      return NextResponse.json({
        ok: true,
        matchType: 'exact',
        matchedBy: keywords,
        product: mapProduct(best.row),
        candidates: [],
      });
    }

    return NextResponse.json({
      ok: true,
      matchType: 'fuzzy',
      matchedBy: keywords,
      product: null,
      candidates: ranked.slice(0, 3).map((x) => mapProduct(x.row)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
