import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMeituanVoucher } from '@/lib/api/meituan';
import { getCloudRestServiceKey, getCloudRestUrl } from '@/lib/cloudRest';

type VerifyReq = {
  voucherCode?: string;
  storeId?: string;
  amount?: number;
  customerName?: string;
  customerPhone?: string;
};

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as VerifyReq;
    const voucherCode = String(body.voucherCode ?? '').trim();
    const storeId = String(body.storeId ?? '').trim();
    const amount = Number(body.amount ?? 0);
    const customerName = String(body.customerName ?? '').trim();
    const customerPhone = String(body.customerPhone ?? '').trim();

    if (!voucherCode) {
      return NextResponse.json({ ok: false, error: '券码为空' }, { status: 400 });
    }
    if (!isUuid(storeId)) {
      return NextResponse.json({ ok: false, error: '门店ID无效' }, { status: 400 });
    }

    const apiKey = process.env.MEITUAN_API_KEY?.trim() || '';
    const apiSecret = process.env.MEITUAN_API_SECRET?.trim() || '';
    const verify = await verifyMeituanVoucher({
      voucherCode,
      apiKey,
      apiSecret,
      baseUrl: process.env.MEITUAN_API_BASE_URL,
    });
    if (!verify.success) {
      return NextResponse.json({ ok: false, error: verify.message, raw: verify.raw }, { status: 400 });
    }

    const cloudRestUrl = getCloudRestUrl();
    const cloudRestServiceKey = getCloudRestServiceKey();
    if (cloudRestUrl && cloudRestServiceKey) {
      const admin = createClient(cloudRestUrl, cloudRestServiceKey, { auth: { persistSession: false } });
      const saleNo = `MTV-${Date.now()}`;
      const { error: insertError } = await admin.from('sales').insert({
        product_id: null,
        store_id: storeId,
        sale_no: saleNo,
        sale_status: '已完成',
        quantity: 1,
        total_price: Number.isFinite(amount) && amount > 0 ? amount : 0,
        customer_name: customerName || '美团顾客',
        customer_phone: customerPhone || null,
        product_category: '美团核销',
        product_brand: 'Meituan',
        product_model: verify.verifyId || voucherCode,
        frame_type: null,
        lens_type: null,
        prescription: { source: 'meituan_verify', voucher_code: voucherCode, verify_id: verify.verifyId },
      });
      if (insertError) {
        return NextResponse.json({ ok: false, error: `核销成功但写 sales 失败: ${insertError.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, message: '核销成功并已写入销售记录', verifyId: verify.verifyId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

