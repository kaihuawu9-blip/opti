import OSS from 'ali-oss';
import { NextResponse } from 'next/server';
import { exportEyewearFinanceSaleToXlsx, type EyewearFinanceSaleDocument } from '@/lib/finance';
import { DEFAULT_STORE_DISPLAY_FALLBACK } from '@/lib/constants';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SaleRow = {
  id: string;
  total_amount: unknown;
  created_at: Date | null;
};

function toMoney(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function normalizeEndpoint(raw: string, region: string): string {
  const t = raw.trim();
  if (!t) return region ? `https://${region}.aliyuncs.com` : '';
  if (t.startsWith('://')) return region ? `https://${region}.aliyuncs.com` : '';
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname || u.hostname === 'aliyuncs.com') {
      return region ? `https://${region}.aliyuncs.com` : withProto;
    }
    return withProto;
  } catch {
    return region ? `https://${region}.aliyuncs.com` : '';
  }
}

function getOssClient(): OSS {
  const region = (process.env.OSS_REGION || process.env.NEXT_PUBLIC_OSS_REGION || '').trim();
  const bucket = (process.env.OSS_BUCKET || process.env.NEXT_PUBLIC_OSS_BUCKET || '').trim();
  const accessKeyId = (process.env.OSS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET || '').trim();
  const endpoint = normalizeEndpoint(
    process.env.OSS_ENDPOINT || process.env.NEXT_PUBLIC_OSS_ENDPOINT || '',
    region,
  );

  if (!region || !bucket || !accessKeyId || !accessKeySecret || !endpoint) {
    throw new Error('OSS_NOT_CONFIGURED');
  }

  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
  });
}

async function readSalesForReport() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [monthRows, ytdRows] = await Promise.all([
    prisma.sales.findMany({
      where: { created_at: { gte: monthStart } },
      orderBy: { created_at: 'asc' },
      select: { id: true, total_amount: true, created_at: true },
    }),
    prisma.sales.findMany({
      where: { created_at: { gte: yearStart } },
      select: { total_amount: true },
    }),
  ]);

  return {
    now,
    monthRows: monthRows as SaleRow[],
    ytdRevenue: ytdRows.reduce((sum, r) => sum + toMoney(r.total_amount), 0),
  };
}

async function buildDocumentFromDb(): Promise<EyewearFinanceSaleDocument> {
  const { now, monthRows, ytdRevenue } = await readSalesForReport();
  const nowIso = now.toISOString();
  const saleNo = `PL-${nowIso.slice(0, 10).replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;

  let storeName = DEFAULT_STORE_DISPLAY_FALLBACK;
  try {
    const storeCfg = await prisma.store_config.findFirst({
      select: { default_store_display_name: true },
    });
    storeName =
      String(storeCfg?.default_store_display_name || '').trim() || DEFAULT_STORE_DISPLAY_FALLBACK;
  } catch {
    // 表无数据、无 store_config 表或连接失败：使用默认门店展示名，不中断导出
  }

  const totalIncMonth = monthRows.reduce((sum, row) => sum + toMoney(row.total_amount), 0);
  const vatRate = 0.13;
  const revenueTaxExclusiveMonth = toMoney(totalIncMonth / (1 + vatRate));
  const outputVatAmountMonth = toMoney(totalIncMonth - revenueTaxExclusiveMonth);
  const totalCostMonth = toMoney(revenueTaxExclusiveMonth * 0.62);

  const line_items =
    monthRows.length > 0
      ? monthRows.map((row, idx) => {
          const lineTotal = toMoney(row.total_amount);
          const cost = toMoney(lineTotal / (1 + vatRate) * 0.62);
          return {
            line_no: idx + 1,
            category: 'other' as const,
            category_label: '销售订单',
            sku_or_name: `订单 ${row.id.slice(0, 8)}`,
            quantity: 1,
            unit_price_tax_inclusive: lineTotal,
            line_amount_tax_inclusive: lineTotal,
            unit_cost: cost,
            line_cost: cost,
            tax_code: 'VAT_13',
          };
        })
      : [
          {
            line_no: 1,
            category: 'other' as const,
            category_label: '销售订单',
            sku_or_name: '本期暂无订单',
            quantity: 1,
            unit_price_tax_inclusive: 0,
            line_amount_tax_inclusive: 0,
            unit_cost: 0,
            line_cost: 0,
            tax_code: 'VAT_13',
          },
        ];

  return {
    doc_type: 'eyewear_finance_sale_v1',
    sale_no: saleNo,
    sale_datetime: nowIso,
    store_name: storeName,
    line_items,
    payment_channels: [{ channel: 'other', channel_label: '门店收款', amount: totalIncMonth }],
    financial_summary: {
      currency: 'CNY',
      vat_rate: vatRate,
      revenue_tax_inclusive: totalIncMonth,
      revenue_tax_exclusive: revenueTaxExclusiveMonth,
      output_vat_amount: outputVatAmountMonth,
      total_cost: totalCostMonth,
      amount_receivable: totalIncMonth,
      amount_received: totalIncMonth,
      balance_due: 0,
    },
    compliance_meta: {
      currency: 'CNY',
      vat_rate: vatRate,
      rounding_rule: 'half_up_2dp',
      generated_at: nowIso,
    },
    profit_loss: {
      report_title: '利润表（眼镜零售 · 银行贷款审核参考样式）',
      reporting_entity: storeName,
      period_label: `${nowIso.slice(0, 4)}年${nowIso.slice(5, 7)}月`,
      revenue_frames: { current_month: revenueTaxExclusiveMonth, year_to_date: toMoney(ytdRevenue / (1 + vatRate)) },
      revenue_lenses_and_accessories: { current_month: 0, year_to_date: 0 },
      cost_of_sales: { current_month: totalCostMonth, year_to_date: toMoney(toMoney(ytdRevenue / (1 + vatRate)) * 0.62) },
      inventory_provision: { current_month: 0, year_to_date: 0 },
      business_taxes_and_surcharges: { current_month: outputVatAmountMonth, year_to_date: toMoney(ytdRevenue - toMoney(ytdRevenue / (1 + vatRate))) },
      selling_expenses: { current_month: 0, year_to_date: 0 },
      net_non_operating: { current_month: 0, year_to_date: 0 },
    },
  };
}

export async function GET() {
  try {
    if (!dbReady()) {
      return NextResponse.json({ ok: false, error: 'DATABASE_URL_NOT_CONFIGURED' }, { status: 500 });
    }

    const doc = await buildDocumentFromDb();
    const buffer = await exportEyewearFinanceSaleToXlsx(doc);
    const fileName = `银行贷款审核标准报表_${doc.sale_no}.xlsx`;
    const objectKey = `finance/reports/${new Date().toISOString().slice(0, 7).replace('-', '/')}/${fileName}`;

    const oss = getOssClient();
    const putResult = await oss.put(objectKey, buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        fileName,
        objectKey,
        url: putResult.url || '',
        saleNo: doc.sale_no,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '导出失败';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
