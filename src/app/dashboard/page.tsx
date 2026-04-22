'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ClipboardList,
  Eye,
  Glasses,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { disableAuthMode } from '@/core/auth';
import { cloudRest, isCloudRestConfigured, cloudRestConfigHint } from '@/lib/cloudRest';
import { useAuth } from '@/components/AuthProvider';
import { useAppNavigate } from '@/lib/useAppNavigate';

type RxEye = { ds: string; dc: string; axis: string; va: string; pd: string; add?: string };

type RxRow = {
  id: string;
  created_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  sale_status?: string | null;
  prescription?: { right: RxEye; left: RxEye } | null;
  products?: { name?: string | null } | null;
  stores?: { name?: string | null } | null;
};

function formatRxOneLine(p: RxRow['prescription']): string {
  if (!p?.right || !p?.left) return '—';
  const r = p.right;
  const l = p.left;
  const addR = String(r.add ?? '').trim();
  const addL = String(l.add ?? '').trim();
  const addSeg = addR || addL ? ` ADD ${addR || '—'}/${addL || '—'}` : '';
  return `R ${r.ds}/${r.dc}×${r.axis}  L ${l.ds}/${l.dc}×${l.axis}${addSeg}`;
}

const DEMO_REVENUE = 12860.5;
const DEMO_PENDING = 14;

const DEMO_RX: RxRow[] = [
  {
    id: '1',
    created_at: new Date().toISOString(),
    customer_name: '张**',
    customer_phone: '138****2280',
    sale_status: '待加工',
    prescription: {
      right: { ds: '-5.25', dc: '-0.75', axis: '180', va: '1.0', pd: '32', add: '+1.50' },
      left: { ds: '-5.00', dc: '-0.50', axis: '175', va: '1.0', pd: '32', add: '+1.50' },
    },
    products: { name: '1.67 非球面镜片' },
    stores: { name: '总店' },
  },
  {
    id: '2',
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    customer_name: '李**',
    customer_phone: '159****6612',
    sale_status: '加工中',
    prescription: {
      right: { ds: '-3.00', dc: '-1.25', axis: '90', va: '0.9', pd: '31.5' },
      left: { ds: '-2.75', dc: '-1.00', axis: '85', va: '0.9', pd: '31.5' },
    },
    products: { name: '渐进多焦点' },
    stores: { name: '总店' },
  },
  {
    id: '3',
    created_at: new Date(Date.now() - 7200_000).toISOString(),
    customer_name: '王**',
    customer_phone: '186****9031',
    sale_status: '待取镜',
    prescription: {
      right: { ds: '-6.00', dc: '-0.50', axis: '10', va: '1.0', pd: '33' },
      left: { ds: '-5.75', dc: '-0.50', axis: '170', va: '1.0', pd: '33' },
    },
    products: { name: 'TR90 镜架 + 防蓝光' },
    stores: { name: '分店1' },
  },
];

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useAppNavigate();
  const [loading, setLoading] = useState(true);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [rxRows, setRxRows] = useState<RxRow[]>([]);
  const [demoMode, setDemoMode] = useState(false);

  const { dayStart, dayEnd } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    return { dayStart: start.toISOString(), dayEnd: end.toISOString() };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isCloudRestConfigured) {
        setDemoMode(true);
        setTodayRevenue(DEMO_REVENUE);
        setPendingCount(DEMO_PENDING);
        setRxRows(DEMO_RX);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        let revQ = cloudRest
          .from('sales')
          .select('total_price')
          .gte('created_at', dayStart)
          .lt('created_at', dayEnd)
          .neq('sale_status', '已退单');
        if (profile?.role !== 'owner' && profile?.store_id) {
          revQ = revQ.eq('store_id', profile.store_id);
        }
        const { data: revRows } = await revQ;

        let pendQ = cloudRest
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .in('sale_status', ['待加工', '加工中']);
        if (profile?.role !== 'owner' && profile?.store_id) {
          pendQ = pendQ.eq('store_id', profile.store_id);
        }
        const { count: pend } = await pendQ;

        let rxQ = cloudRest
          .from('sales')
          .select(
            `
            id,
            created_at,
            customer_name,
            customer_phone,
            sale_status,
            prescription,
            products (name),
            stores (name)
          `,
          )
          .not('prescription', 'is', null)
          .order('created_at', { ascending: false })
          .limit(12);
        if (profile?.role !== 'owner' && profile?.store_id) {
          rxQ = rxQ.eq('store_id', profile.store_id);
        }
        const { data: rxData } = await rxQ;

        if (cancelled) return;
        const sum = (revRows ?? []).reduce((a, r) => a + Number((r as { total_price: unknown }).total_price || 0), 0);
        setTodayRevenue(sum);
        setPendingCount(pend ?? 0);
        setRxRows((rxData as RxRow[]) ?? []);
        setDemoMode(false);
      } catch {
        if (!cancelled) {
          setDemoMode(true);
          setTodayRevenue(DEMO_REVENUE);
          setPendingCount(DEMO_PENDING);
          setRxRows(DEMO_RX);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.role, profile?.store_id, dayStart, dayEnd]);

  const revenueDisplay = todayRevenue.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="h-full min-h-0 max-w-full overflow-x-hidden">
      <div className="min-h-0 space-y-8">
      {/* 页头 */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1e4d8c]/70">
            ERP · 工作台
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            门店运营看板
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            今日经营概况与验光配镜动态一览
            {demoMode && (
              <span className="ml-2 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200/80">
                演示数据
              </span>
            )}
          </p>
        </div>
        {!isCloudRestConfigured && !disableAuthMode && (
          <p className="max-w-md text-xs text-slate-400">{cloudRestConfigHint}</p>
        )}
      </div>

      {/* 顶部大卡片 */}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white p-6 shadow-[0_1px_3px_rgba(15,60,120,0.08),0_8px_24px_rgba(30,77,140,0.06)] ring-1 ring-slate-200/60 md:p-8">
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#1e5a9e]/[0.07]"
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e5a9e] text-white shadow-lg shadow-[#1e5a9e]/25">
              <TrendingUp className="h-6 w-6" strokeWidth={2} />
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/80">
              <Activity className="h-3.5 w-3.5" />
              实时汇总
            </span>
          </div>
          <p className="relative mt-6 text-sm font-medium text-slate-500">今日营业额</p>
          <p className="relative mt-2 font-mono text-3xl font-bold tracking-tight text-[#0f3468] md:text-4xl">
            {loading ? (
              <span className="inline-block h-10 w-48 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <>￥{revenueDisplay}</>
            )}
          </p>
          <p className="relative mt-3 text-xs text-slate-400">
            已排除「已退单」销售明细 · 按门店数据权限过滤
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white p-6 shadow-[0_1px_3px_rgba(15,60,120,0.08),0_8px_24px_rgba(30,77,140,0.06)] ring-1 ring-slate-200/60 md:p-8">
          <div
            className="pointer-events-none absolute -right-6 top-1/2 h-36 w-36 -translate-y-1/2 rounded-full bg-[#0d9488]/[0.06]"
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0f766e] text-white shadow-lg shadow-teal-900/20">
              <ClipboardList className="h-6 w-6" strokeWidth={2} />
            </div>
            <button
              type="button"
              onClick={() => navigate('/cashier')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e5a9e] transition hover:text-[#0f3468]"
            >
              去收银台
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="relative mt-6 text-sm font-medium text-slate-500">待加工订单</p>
          <p className="relative mt-2 font-mono text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            {loading ? (
              <span className="inline-block h-10 w-24 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <>
                {pendingCount}
                <span className="ml-2 text-lg font-semibold text-slate-400">单</span>
              </>
            )}
          </p>
          <p className="relative mt-3 text-xs text-slate-400">
            状态为「待加工」「加工中」的镜片相关订单数量
          </p>
        </div>
      </div>

      {/* 最近验光记录 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,60,120,0.06)] ring-1 ring-slate-200/50">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-[#f8fafc] to-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1e5a9e]/10 text-[#1e5a9e]">
              <Eye className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">最近验光记录</h2>
              <p className="text-xs text-slate-500">含配镜处方数据的最近销售明细</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/reports')}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-[#1e5a9e]/30 hover:bg-slate-50 hover:text-[#1e5a9e] sm:self-auto"
          >
            <Glasses className="h-4 w-4 text-[#1e5a9e]" />
            财务报表
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            <ul className="divide-y divide-slate-50">
              {[1, 2, 3, 4, 5].map((i) => (
                <li key={i} className="flex gap-4 px-5 py-4 sm:px-6">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-50" />
                  </div>
                </li>
              ))}
            </ul>
          ) : rxRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <Sparkles className="h-10 w-10 text-slate-200" />
              <p className="text-sm font-medium text-slate-600">暂无带验光数据的记录</p>
              <p className="text-xs text-slate-400">镜片订单保存验光后，将在此展示</p>
            </div>
          ) : (
            <ul className="max-h-[min(52vh,560px)] overflow-y-auto overscroll-contain">
              {rxRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                >
                  <div className="flex shrink-0 items-center gap-3 sm:w-44">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Glasses className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {row.customer_name?.trim() || '未登记姓名'}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {row.customer_phone?.trim() || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs leading-relaxed text-slate-700">
                      {formatRxOneLine(row.prescription)}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {row.products?.name || '—'} · {row.stores?.name || '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                        row.sale_status === '加工中'
                          ? 'bg-sky-50 text-sky-800 ring-sky-200'
                          : row.sale_status === '待加工'
                            ? 'bg-amber-50 text-amber-900 ring-amber-200'
                            : 'bg-slate-50 text-slate-600 ring-slate-200'
                      }`}
                    >
                      {row.sale_status || '待加工'}
                    </span>
                    <time className="text-[11px] tabular-nums text-slate-400">
                      {new Date(row.created_at).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
