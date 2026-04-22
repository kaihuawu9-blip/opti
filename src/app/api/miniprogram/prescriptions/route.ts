import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPurePhoneNumberFromWxCode } from '@/lib/wechatMiniPhone';
import { getCloudRestServiceKey, getCloudRestUrl } from '@/lib/cloudRest';
import { customerPhoneSearchVariants, maskPhoneMiddle } from '@/lib/phoneVariants';
import { extractBearerToken, verifyMiniprogramToken } from '@/lib/auth/miniprogramJwt';

export const runtime = 'nodejs';

type RxEye = { ds: string; dc: string; axis: string; va: string; pd: string };

type Prescription = { right: RxEye; left: RxEye } | null;

const rateBucket = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const item = rateBucket.get(key);
  if (!item || now > item.resetAt) {
    rateBucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (item.count >= limit) return false;
  item.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const bearer = extractBearerToken(req.headers.get('authorization') || '');
    if (!bearer) {
      return NextResponse.json({ error: '缺少 Bearer Token' }, { status: 401 });
    }
    try {
      verifyMiniprogramToken(bearer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token 无效';
      return NextResponse.json({ error: `鉴权失败: ${msg}` }, { status: 401 });
    }

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(`rx:${clientIp}`, 30, 60_000)) {
      return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
    }

    const body = (await req.json()) as { code?: string };
    const code = (body.code || '').trim();
    if (!code) {
      return NextResponse.json({ error: '缺少微信返回的 code' }, { status: 400 });
    }

    const url = getCloudRestUrl();
    const service = getCloudRestServiceKey();
    if (!url || !service) {
      return NextResponse.json({ error: '服务端未配置 ALIYUN_REST_URL / ALIYUN_REST_SERVICE_KEY' }, { status: 500 });
    }

    let phone11: string;
    try {
      phone11 = await getPurePhoneNumberFromWxCode(code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '换取手机号失败';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const variants = customerPhoneSearchVariants(phone11);
    const sb = createClient(url, service, { auth: { persistSession: false } });

    const { data: rows, error } = await sb
      .from('sales')
      .select(
        `
        id,
        created_at,
        sale_no,
        prescription,
        customer_name,
        product_category,
        product_brand,
        product_model,
        frame_type,
        lens_type,
        products (name, category, brand, model, frame_type, lens_type),
        stores (name)
      `,
      )
      .in('customer_phone', variants)
      .not('prescription', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const records = (rows ?? []).map((row) => {
      const s = row as {
        id: string;
        created_at: string;
        sale_no?: string | null;
        prescription: Prescription;
        customer_name?: string | null;
        product_category?: string | null;
        product_brand?: string | null;
        product_model?: string | null;
        frame_type?: string | null;
        lens_type?: string | null;
        products?: {
          name?: string | null;
          category?: string | null;
          brand?: string | null;
          model?: string | null;
          frame_type?: string | null;
          lens_type?: string | null;
        } | null;
        stores?: { name?: string | null } | null;
      };
      return {
        id: s.id,
        created_at: s.created_at,
        sale_no: s.sale_no ?? null,
        prescription: s.prescription,
        customer_name: s.customer_name ?? null,
        store_name: s.stores?.name ?? null,
        product_name: s.products?.name ?? null,
        spec: [
          s.product_brand || s.products?.brand,
          s.product_model || s.products?.model,
          s.lens_type || s.products?.lens_type,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    });

    return NextResponse.json({
      phone_masked: maskPhoneMiddle(phone11),
      records,
      hint:
        records.length === 0
          ? '未找到带验光数据的订单。请确认收银台登记的手机号与本微信授权号码一致，且该笔配镜为镜片订单并已保存验光。'
          : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
