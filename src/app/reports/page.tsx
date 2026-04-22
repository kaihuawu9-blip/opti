'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { disableAuthMode } from '@/core/auth';
import { cloudRest, isCloudRestConfigured } from '@/lib/cloudRest';
import { BarChart3, TrendingUp, Calendar, MapPin, Package, Pencil, Printer, Trash2, X } from 'lucide-react';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { useAuth } from '@/components/AuthProvider';
import PrintTemplate, { type PrintOrder } from '@/components/PrintTemplate';
import { resolveStoreDisplayName } from '@/lib/storeDisplayName';
import { ReceiptDesktopPrinterBar } from '@/components/ReceiptDesktopPrinterBar';
import { printReceiptWithElectronPreference } from '@/lib/receiptElectronPrint';
import '@/styles/Print.css';

/** 销售 JSON 存库形状（旧数据可能无 ADD） */
type RxEyeStored = {
  ds?: string | null;
  dc?: string | null;
  axis?: string | null;
  va?: string | null;
  pd?: string | null;
  add?: string | null;
};

/** 编辑表单：各字段归一化为字符串 */
type RxEye = {
  ds: string;
  dc: string;
  axis: string;
  va: string;
  pd: string;
  add: string;
};

type Sale = {
  id: string;
  store_id?: string | null;
  quantity: number;
  total_price: number | string;
  final_unit_price?: number | string | null;
  created_at: string;
  sale_no?: string | null;
  prescription?: { right: RxEyeStored; left: RxEyeStored } | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  product_category?: string | null;
  product_brand?: string | null;
  product_model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  sale_status?: string | null;
  refund_reason?: string | null;
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

const SALE_STATUS_OPTIONS = ['待加工', '加工中', '待取镜', '已完成', '售后', '已退单'] as const;

type EditForm = {
  id: string;
  quantity: number;
  total_price: number;
  customer_name: string;
  customer_phone: string;
  prescription: { right: RxEye; left: RxEye };
  sale_status: string;
  refund_reason: string;
};

function rxAddSuffix(e: RxEyeStored) {
  const a = String(e.add ?? '').trim();
  return a ? `/ADD${a}` : '';
}

function formatPrescriptionShort(p: Sale['prescription']): string {
  if (!p?.right || !p?.left) return '—';
  const r = p.right;
  const l = p.left;
  return `右DS${r.ds ?? ''}/DC${r.dc ?? ''}/轴${r.axis ?? ''}/VA${r.va ?? ''}/PD${r.pd ?? ''}${rxAddSuffix(r)} 左DS${l.ds ?? ''}/DC${l.dc ?? ''}/轴${l.axis ?? ''}/VA${l.va ?? ''}/PD${l.pd ?? ''}${rxAddSuffix(l)}`;
}

function displaySaleCategory(s: Sale): string {
  const c = (s.product_category ?? s.products?.category ?? '').trim();
  return c || '—';
}

function formatLineSpec(s: Sale): string {
  const cat = (s.product_category ?? '').trim();
  if (cat === '快充') {
    const m = (s.product_model ?? '').trim();
    return m ? `摘要：${m}` : '快速收款';
  }
  const brand = (s.product_brand ?? s.products?.brand ?? '').trim();
  const model = (s.product_model ?? s.products?.model ?? '').trim();
  const ft = (s.frame_type ?? s.products?.frame_type ?? '').trim();
  const lt = (s.lens_type ?? s.products?.lens_type ?? '').trim();
  const parts: string[] = [];
  if (brand) parts.push(`品牌 ${brand}`);
  if (model) parts.push(`型号 ${model}`);
  if (ft) parts.push(`镜框 ${ft}`);
  if (lt) parts.push(`镜片 ${lt}`);
  return parts.length ? parts.join(' · ') : '—';
}

function prescriptionToPrintRx(p: Sale['prescription']) {
  if (!p?.right && !p?.left) return null;
  const mapEye = (e: RxEyeStored | null | undefined) =>
    e
      ? {
          ds: e.ds ?? '',
          dc: e.dc ?? '',
          axis: e.axis ?? '',
          va: e.va ?? '',
          pd: e.pd ?? '',
          add: e.add ?? '',
        }
      : null;
  return { right: mapEye(p.right), left: mapEye(p.left) };
}

function saleRowToPrintLineItem(s: Sale): NonNullable<PrintOrder['items']>[number] {
  const qty = Math.max(1, Number(s.quantity) || 1);
  const lineTotal = Number(s.total_price) || 0;
  const fu = s.final_unit_price != null && s.final_unit_price !== '' ? Number(s.final_unit_price) : NaN;
  const unit = Number.isFinite(fu) ? fu : qty > 0 ? lineTotal / qty : lineTotal;
  const name = (s.products?.name || s.product_model || '商品').trim() || '商品';
  return {
    name,
    quantity: qty,
    unit_price: unit,
    line_total: lineTotal,
    rx: prescriptionToPrintRx(s.prescription),
  };
}

async function fetchSalesLinesForReprint(anchor: Sale): Promise<Sale[]> {
  const sn = String(anchor.sale_no ?? '').trim();
  if (!sn || !isCloudRestConfigured) {
    return [anchor];
  }
  let q = cloudRest
    .from('sales')
    .select(
      `
        *,
        products (name, price, category, brand, model, frame_type, lens_type),
        stores (name)
      `,
    )
    .eq('sale_no', sn)
    .order('created_at', { ascending: true });
  const sid = String(anchor.store_id ?? '').trim();
  if (sid) q = q.eq('store_id', sid);
  const { data, error } = await q;
  if (error) {
    console.warn('[reports] reprint fetch lines:', error.message);
    return [anchor];
  }
  if (data && data.length > 0) return data as Sale[];
  return [anchor];
}

async function resolvePaymentChannel(
  saleNo: string,
  storeId: string | null | undefined,
): Promise<{ channel: string; meituanVoucher: string }> {
  if (!isCloudRestConfigured || !String(saleNo ?? '').trim()) {
    return { channel: 'cash', meituanVoucher: '' };
  }
  const sn = String(saleNo).trim();
  const sid = String(storeId ?? '').trim();
  let q = cloudRest
    .from('payment_transactions')
    .select('channel, external_txn_no, cart_snapshot')
    .like('external_txn_no', `${sn}-%`)
    .order('paid_at', { ascending: false })
    .limit(1);
  if (sid) q = q.eq('store_id', sid);
  const { data } = await q;
  const row = (data?.[0] ?? null) as { channel?: string; cart_snapshot?: unknown } | null;
  if (!row?.channel) return { channel: 'cash', meituanVoucher: '' };
  let voucher = '';
  if (row.channel === 'meituan_douyin' && row.cart_snapshot && typeof row.cart_snapshot === 'object') {
    const snap = row.cart_snapshot as { meituanVoucher?: string };
    voucher = String(snap.meituanVoucher ?? '').trim();
  }
  return { channel: row.channel, meituanVoucher: voucher };
}

function buildPrintOrderFromSales(lines: Sale[]): PrintOrder {
  const sorted = [...lines].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const first = sorted[0];
  const saleNo = String(first.sale_no ?? '').trim();
  const orderNo = saleNo || `补打-${first.id.slice(0, 8)}`;
  const total = sorted.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0);
  const items = sorted.map(saleRowToPrintLineItem);
  return {
    order_no: orderNo,
    created_at: new Date(first.created_at).toLocaleString('zh-CN'),
    store_name: resolveStoreDisplayName(first.stores?.name),
    customer_name: String(first.customer_name ?? '').trim(),
    customer_phone: String(first.customer_phone ?? '').trim(),
    payment_method: 'cash',
    meituan_voucher: '',
    total_amount: total,
    items,
  };
}

export default function ReportsPage() {
  const { profile, hasPermission } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [reprintOrder, setReprintOrder] = useState<PrintOrder | null>(null);
  const [showReprintModal, setShowReprintModal] = useState(false);
  const [reprintLoadingId, setReprintLoadingId] = useState<string | null>(null);

  const allowEdit = hasPermission('sales.edit');
  const allowDelete = hasPermission('sales.delete');

  async function fetchSales() {
    if (!isCloudRestConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = cloudRest
      .from('sales')
      .select(`
        *,
        products (name, price, category, brand, model, frame_type, lens_type),
        stores (name)
      `)
      .order('created_at', { ascending: false });
    if (profile?.role !== 'owner' && profile?.store_id) {
      query = query.eq('store_id', profile.store_id);
    }
    const { data } = await query;

    if (data) setSales(data as Sale[]);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      if (!isCloudRestConfigured) {
        setLoading(false);
        return;
      }
      setLoading(true);
      let query = cloudRest
        .from('sales')
        .select(`
        *,
        products (name, price, category, brand, model, frame_type, lens_type),
        stores (name)
      `)
        .order('created_at', { ascending: false });
      if (profile?.role !== 'owner' && profile?.store_id) {
        query = query.eq('store_id', profile.store_id);
      }
      const { data } = await query;
      if (data) setSales(data as Sale[]);
      setLoading(false);
    })();
  }, [profile?.role, profile?.store_id]);

  const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_price), 0);
  const totalSalesCount = sales.length;
  const totalQuantity = sales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);
  const avgItemsPerOrder = totalSalesCount > 0 ? totalQuantity / totalSalesCount : 0;
  const highValueOrders = sales.filter((sale) => Number(sale.total_price) >= 500).length;
  const highValueRate = totalSalesCount > 0 ? (highValueOrders / totalSalesCount) * 100 : 0;
  const activeCustomerCount = new Set(
    sales
      .map((sale) => `${sale.customer_name || ''}|${sale.customer_phone || ''}`.trim())
      .filter((v) => v && v !== '|'),
  ).size;

  const dailyTrend = useMemo(() => {
    const map = new Map<string, { revenue: number; orders: number }>();
    for (const sale of sales) {
      const day = new Date(sale.created_at).toLocaleDateString('zh-CN');
      const item = map.get(day) || { revenue: 0, orders: 0 };
      item.revenue += Number(sale.total_price || 0);
      item.orders += 1;
      map.set(day, item);
    }
    return Array.from(map.entries())
      .map(([day, v]) => ({ day, revenue: v.revenue, orders: v.orders }))
      .sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime())
      .slice(-7);
  }, [sales]);

  const storeRanking = useMemo(() => {
    const map = new Map<string, { revenue: number; orders: number }>();
    for (const sale of sales) {
      const key = resolveStoreDisplayName(sale.stores?.name);
      const item = map.get(key) || { revenue: 0, orders: 0 };
      item.revenue += Number(sale.total_price || 0);
      item.orders += 1;
      map.set(key, item);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, revenue: v.revenue, orders: v.orders }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [sales]);

  const productRanking = useMemo(() => {
    const map = new Map<string, { revenue: number; quantity: number }>();
    for (const sale of sales) {
      const key = sale.products?.name || sale.product_model?.trim() || '未知商品';
      const item = map.get(key) || { revenue: 0, quantity: 0 };
      item.revenue += Number(sale.total_price || 0);
      item.quantity += Number(sale.quantity || 0);
      map.set(key, item);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, revenue: v.revenue, quantity: v.quantity }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [sales]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { revenue: number; orders: number; quantity: number }>();
    for (const sale of sales) {
      const key = (sale.product_category ?? sale.products?.category ?? '').trim() || '未分类';
      const item = map.get(key) || { revenue: 0, orders: 0, quantity: 0 };
      item.revenue += Number(sale.total_price || 0);
      item.orders += 1;
      item.quantity += Number(sale.quantity || 0);
      map.set(key, item);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  const statusStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const sale of sales) {
      const key = (sale.sale_status || '待加工').trim() || '待加工';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return SALE_STATUS_OPTIONS.map((name) => ({
      name,
      count: map.get(name) || 0,
    }));
  }, [sales]);

  const filteredSales = sales.filter((sale) => {
    const k = keyword.trim().toLowerCase();
    if (!k) return true;
    const hay = [
      sale.customer_name ?? '',
      sale.customer_phone ?? '',
      sale.products?.name ?? sale.product_model ?? '',
      sale.sale_no ?? '',
      displaySaleCategory(sale),
      formatLineSpec(sale),
      sale.sale_status ?? '',
      sale.refund_reason ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(k);
  });

  const handleOpenReprint = useCallback(async (anchor: Sale) => {
    if (!isCloudRestConfigured && !disableAuthMode) {
      window.alert('未配置云端，无法补打小票。');
      return;
    }
    if (!isCloudRestConfigured && disableAuthMode) {
      window.alert('演示模式下不支持补打小票（未连接云端销售数据）。');
      return;
    }
    setReprintLoadingId(anchor.id);
    try {
      const lines = await fetchSalesLinesForReprint(anchor);
      const first = lines[0];
      const order = buildPrintOrderFromSales(lines);
      const pay = await resolvePaymentChannel(String(first.sale_no ?? '').trim(), first.store_id);
      order.payment_method = pay.channel;
      order.meituan_voucher = pay.meituanVoucher;
      setReprintOrder(order);
      setShowReprintModal(true);
    } catch (e) {
      window.alert('加载小票失败：' + toChineseErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setReprintLoadingId(null);
    }
  }, []);

  if (!hasPermission('reports.view')) {
    return <div className="text-gray-600">当前账号无权访问财务报表。</div>;
  }

  const normEye = (e: RxEyeStored | undefined): RxEye => ({
    ds: String(e?.ds ?? ''),
    dc: String(e?.dc ?? ''),
    axis: String(e?.axis ?? ''),
    va: String(e?.va ?? ''),
    pd: String(e?.pd ?? ''),
    add: String(e?.add ?? ''),
  });

  const toForm = (sale: Sale): EditForm => ({
    id: sale.id,
    quantity: Number(sale.quantity) || 1,
    total_price: Number(sale.total_price) || 0,
    customer_name: sale.customer_name ?? '',
    customer_phone: sale.customer_phone ?? '',
    prescription: sale.prescription
      ? { right: normEye(sale.prescription.right), left: normEye(sale.prescription.left) }
      : {
          right: normEye(undefined),
          left: normEye(undefined),
        },
    sale_status: (sale.sale_status || '待加工').trim() || '待加工',
    refund_reason: sale.refund_reason?.trim() ?? '',
  });

  const updateEye = (side: 'right' | 'left', key: keyof RxEye, value: string) => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      prescription: {
        ...editForm.prescription,
        [side]: {
          ...editForm.prescription[side],
          [key]: value,
        },
      },
    });
  };

  const handleSave = async () => {
    if (!editForm) return;
    if (editForm.quantity <= 0) {
      window.alert('数量必须大于 0');
      return;
    }
    if (editForm.sale_status === '已退单' && !editForm.refund_reason.trim()) {
      window.alert('已退单时必须填写退单原因');
      return;
    }
    setSaving(true);
    const status = editForm.sale_status.trim() || '待加工';
    const { error } = await cloudRest
      .from('sales')
      .update({
        quantity: editForm.quantity,
        total_price: editForm.total_price,
        customer_name: editForm.customer_name.trim(),
        customer_phone: editForm.customer_phone.trim(),
        prescription: editForm.prescription,
        sale_status: status,
        refund_reason: status === '已退单' ? editForm.refund_reason.trim() : null,
      })
      .eq('id', editForm.id);
    setSaving(false);
    if (error) {
      window.alert('保存失败：' + toChineseErrorMessage(error.message));
      return;
    }
    setEditForm(null);
    fetchSales();
  };

  const handleDelete = async (saleId: string) => {
    if (!window.confirm('确认删除这条销售记录吗？删除后不可恢复。')) return;
    setDeletingId(saleId);
    const { error } = await cloudRest.from('sales').delete().eq('id', saleId);
    setDeletingId(null);
    if (error) {
      window.alert('删除失败：' + toChineseErrorMessage(error.message));
      return;
    }
    fetchSales();
  };

  const handleReprintPrintConfirm = async () => {
    try {
      await printReceiptWithElectronPreference();
    } catch (e) {
      window.alert('打印失败：' + toChineseErrorMessage(e instanceof Error ? e.message : String(e)));
    }
  };

  if (loading) return <div className="flex justify-center items-center h-64">加载中...</div>;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">财务报表</h1>
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <span>最后更新：{new Date().toLocaleString()}</span>
        </div>
      </div>

      {/* 概览统计 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">总销售额</p>
            <h3 className="text-2xl font-bold text-gray-900">￥{totalRevenue.toFixed(2)}</h3>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-xl">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">总订单数</p>
            <h3 className="text-2xl font-bold text-gray-900">{totalSalesCount}</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">平均订单价</p>
            <h3 className="text-2xl font-bold text-gray-900">
              ￥{totalSalesCount > 0 ? (totalRevenue / totalSalesCount).toFixed(2) : '0.00'}
            </h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">件均销量</p>
            <h3 className="text-2xl font-bold text-gray-900">{avgItemsPerOrder.toFixed(2)} 件/单</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">高客单占比（≥500）</p>
            <h3 className="text-2xl font-bold text-gray-900">{highValueRate.toFixed(1)}%</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-cyan-50 text-cyan-600 rounded-xl">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">活跃客户数</p>
            <h3 className="text-2xl font-bold text-gray-900">{activeCustomerCount}</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-gray-800 mb-3">近7天趋势</h3>
          <div className="space-y-2">
            {dailyTrend.map((d) => (
              <div key={d.day} className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{d.day}</span>
                <span className="text-gray-700">订单 {d.orders}</span>
                <span className="font-semibold text-blue-600">￥{d.revenue.toFixed(2)}</span>
              </div>
            ))}
            {dailyTrend.length === 0 && <div className="text-sm text-gray-500">暂无趋势数据</div>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-gray-800 mb-3">门店业绩 Top5</h3>
          <div className="space-y-2">
            {storeRanking.map((s, idx) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{idx + 1}. {s.name}</span>
                <span className="text-gray-500">{s.orders} 单</span>
                <span className="font-semibold text-emerald-600">￥{s.revenue.toFixed(2)}</span>
              </div>
            ))}
            {storeRanking.length === 0 && <div className="text-sm text-gray-500">暂无门店排行</div>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-gray-800 mb-3">商品贡献 Top5</h3>
          <div className="space-y-2">
            {productRanking.map((p, idx) => (
              <div key={p.name} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{idx + 1}. {p.name}</span>
                <span className="text-gray-500">{p.quantity} 件</span>
                <span className="font-semibold text-purple-600">￥{p.revenue.toFixed(2)}</span>
              </div>
            ))}
            {productRanking.length === 0 && <div className="text-sm text-gray-500">暂无商品排行</div>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="text-base font-bold text-gray-800 mb-3">订单状态看板</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {statusStats.map((s) => (
            <div key={s.name} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-500">{s.name}</div>
              <div className="text-xl font-bold text-gray-800">{s.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="text-base font-bold text-gray-800 mb-3">分类销售明细（镜框 / 镜片等）</h3>
        <p className="text-xs text-gray-500 mb-3">
          按商品「分类」汇总；新订单会在结账时写入分类与镜框/镜片规格快照。请在库存里把商品分类设为镜框、镜片等。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="py-2 pr-4">分类</th>
                <th className="py-2 pr-4">笔数</th>
                <th className="py-2 pr-4">件数</th>
                <th className="py-2 text-right">销售额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categoryStats.map((row) => (
                <tr key={row.name}>
                  <td className="py-2 pr-4 font-medium text-gray-800">{row.name}</td>
                  <td className="py-2 pr-4 text-gray-600">{row.orders}</td>
                  <td className="py-2 pr-4 text-gray-600">{row.quantity}</td>
                  <td className="py-2 text-right font-semibold text-blue-600">￥{row.revenue.toFixed(2)}</td>
                </tr>
              ))}
              {categoryStats.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 详细列表 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-800">最近销售明细</h2>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full md:w-80 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500"
              placeholder="按客人、电话、商品名、分类、规格查询"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">时间</th>
                <th className="px-6 py-4">商品名称</th>
                <th className="px-6 py-4">分类</th>
                <th className="px-6 py-4 min-w-[180px]">规格明细</th>
                <th className="px-6 py-4">门店</th>
                <th className="px-6 py-4">客人</th>
                <th className="px-6 py-4">电话</th>
                <th className="px-6 py-4">状态</th>
                <th className="px-6 py-4 min-w-[140px]">退单原因</th>
                <th className="px-6 py-4">数量</th>
                <th className="px-6 py-4 min-w-[220px]">验光数据</th>
                <th className="px-6 py-4 text-right">总价 (￥)</th>
                <th className="px-6 py-4 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSales.map((sale) => (
                <tr
                  key={sale.id}
                  className={`hover:bg-gray-50 transition-colors ${(sale.sale_status || '').trim() === '已退单' ? 'bg-red-50/50' : ''}`}
                >
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(sale.created_at).toLocaleString('zh-CN', { 
                      month: '2-digit', 
                      day: '2-digit', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900 flex items-center">
                    <Package className="w-4 h-4 mr-2 text-gray-400" />
                    {sale.products?.name || sale.product_model || '—'}
                  </td>
                  <td className="px-6 py-4 text-gray-700">{displaySaleCategory(sale)}</td>
                  <td
                    className="px-6 py-4 text-xs text-gray-600 align-top max-w-[220px]"
                    title={formatLineSpec(sale)}
                  >
                    {formatLineSpec(sale)}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    <span className="flex items-center">
                      <MapPin className="w-3 h-3 mr-1 text-gray-400" />
                      {sale.stores?.name}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700">{sale.customer_name || '—'}</td>
                  <td className="px-6 py-4 text-gray-700">{sale.customer_phone || '—'}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        (sale.sale_status || '').trim() === '已退单'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {sale.sale_status || '待加工'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs align-top max-w-[180px]" title={sale.refund_reason || ''}>
                    {(sale.sale_status || '').trim() === '已退单' ? (
                      sale.refund_reason?.trim() ? (
                        <span className="text-gray-600">{sale.refund_reason.trim()}</span>
                      ) : (
                        <span className="text-red-600 font-medium">未填原因（请点修改补全）</span>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-medium">{sale.quantity}</td>
                  <td className="px-6 py-4 text-xs text-gray-600 align-top max-w-xs" title={formatPrescriptionShort(sale.prescription)}>
                    {formatPrescriptionShort(sale.prescription)}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-blue-600">
                    ￥{Number(sale.total_price).toFixed(2)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleOpenReprint(sale)}
                        disabled={reprintLoadingId === sale.id}
                        className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Printer className="w-3.5 h-3.5 mr-1" />
                        {reprintLoadingId === sale.id ? '准备中…' : '补打小票'}
                      </button>
                      {allowEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditForm(toForm(sale))}
                          className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          修改
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">无编辑权限</span>
                      )}
                      {allowDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(sale.id)}
                          disabled={deletingId === sale.id}
                          className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          {deletingId === sale.id ? '删除中...' : '删除'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-6 py-12 text-center text-gray-500">
                    暂无销售数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showReprintModal && reprintOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:p-0 print:bg-white print:static print:inset-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col print:shadow-none print:max-w-none print:w-full print:rounded-none">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center print:hidden">
              <div className="flex items-center space-x-2 text-gray-800">
                <Printer className="w-5 h-5" />
                <h3 className="font-bold">补打小票预览</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowReprintModal(false);
                  setReprintOrder(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition-all"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 flex justify-center bg-gray-50 print:bg-white print:p-0">
              <div id="receipt-print-area" className="bg-white p-3 shadow-xl print:shadow-none print:p-0">
                <PrintTemplate order={reprintOrder} />
              </div>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 space-y-3 print:hidden">
              <ReceiptDesktopPrinterBar />
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowReprintModal(false);
                    setReprintOrder(null);
                  }}
                  className="flex-1 py-3 px-4 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-100 transition-all"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={() => void handleReprintPrintConfirm()}
                  className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center space-x-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>立即打印</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editForm && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-gray-200 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">修改销售记录</h3>
              <button
                type="button"
                onClick={() => setEditForm(null)}
                className="p-2 rounded-full hover:bg-gray-100"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="sm:col-span-2 text-xs text-gray-500">
                  订单状态
                  <select
                    value={editForm.sale_status}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        sale_status: e.target.value,
                        refund_reason: e.target.value === '已退单' ? editForm.refund_reason : '',
                      })
                    }
                    className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                  >
                    {SALE_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                {editForm.sale_status === '已退单' && (
                  <label className="sm:col-span-2 text-xs text-gray-500">
                    <span className="text-red-600">*</span> 退单原因（必填）
                    <textarea
                      value={editForm.refund_reason}
                      onChange={(e) => setEditForm({ ...editForm, refund_reason: e.target.value })}
                      rows={3}
                      required
                      minLength={1}
                      className={`mt-1 w-full px-3 py-2 text-sm border rounded-lg ${
                        !editForm.refund_reason.trim() ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'
                      }`}
                      placeholder="请填写退单原因，例如：顾客取消、验光不符、库存不足等"
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={editForm.customer_name}
                  onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  placeholder="客户姓名"
                />
                <input
                  value={editForm.customer_phone}
                  onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  placeholder="客户电话"
                />
                <input
                  type="number"
                  min={1}
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: Number(e.target.value) })}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  placeholder="数量"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editForm.total_price}
                  onChange={(e) => setEditForm({ ...editForm, total_price: Number(e.target.value) })}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  placeholder="总价"
                />
              </div>
              {(['right', 'left'] as const).map((side) => (
                <div key={side} className="rounded-lg border border-gray-100 p-3 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-700 mb-2">
                    {side === 'right' ? '右眼 (OD)' : '左眼 (OS)'}
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <input value={editForm.prescription[side].ds} onChange={(e) => updateEye(side, 'ds', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="DS" />
                    <input value={editForm.prescription[side].dc} onChange={(e) => updateEye(side, 'dc', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="DC" />
                    <input value={editForm.prescription[side].axis} onChange={(e) => updateEye(side, 'axis', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="轴位" />
                    <input value={editForm.prescription[side].add} onChange={(e) => updateEye(side, 'add', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="下加 ADD" />
                    <input value={editForm.prescription[side].va} onChange={(e) => updateEye(side, 'va', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="矫正视力" />
                    <input value={editForm.prescription[side].pd} onChange={(e) => updateEye(side, 'pd', e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded" placeholder="瞳距" />
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditForm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={
                  saving ||
                  (editForm.sale_status === '已退单' && !editForm.refund_reason.trim())
                }
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
