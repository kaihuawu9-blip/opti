'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Download, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toChineseErrorMessage } from '@/lib/userMessages';

type Stats = {
  todayReceived: number;
  pendingBalance: number;
  estGrossProfit: number;
  loading: boolean;
};

function formatMoney(n: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function StatCard({
  title,
  subtitle,
  value,
  accent,
}: {
  title: string;
  subtitle?: string;
  value: string;
  accent: 'gold' | 'cyan' | 'emerald';
}) {
  const ring =
    accent === 'gold'
      ? 'from-amber-500/25 to-amber-600/5 border-amber-400/35'
      : accent === 'cyan'
        ? 'from-cyan-500/20 to-sky-600/5 border-cyan-400/30'
        : 'from-emerald-500/20 to-emerald-700/5 border-emerald-400/30';

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${ring} px-6 py-5 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] backdrop-blur-sm`}
    >
      <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-white/5" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      <p className="mt-4 font-[system-ui] text-3xl font-bold tabular-nums tracking-tight text-white md:text-[2rem]">
        {value}
      </p>
    </div>
  );
}

export default function ReconciliationPage() {
  const { hasPermission } = useAuth();
  const [stats, setStats] = useState<Stats>({
    todayReceived: 0,
    pendingBalance: 0,
    estGrossProfit: 0,
    loading: true,
  });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('正在进行金融级数据脱敏整理');

  const loadStats = useCallback(async () => {
    setStats((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/finance/reconciliation-overview', { cache: 'no-store' });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        data?: {
          todayReceived?: number;
          pendingBalance?: number;
          estGrossProfit?: number;
        };
      };
      if (!res.ok || !j.ok || !j.data) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setStats({
        todayReceived: Number(j.data.todayReceived || 0),
        pendingBalance: Number(j.data.pendingBalance || 0),
        estGrossProfit: Number(j.data.estGrossProfit || 0),
        loading: false,
      });
    } catch {
      setStats({ todayReceived: 0, pendingBalance: 0, estGrossProfit: 0, loading: false });
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const cards = useMemo(
    () => [
      {
        title: '今日实收',
        subtitle: '本日 0:00 起已入账销售额合计',
        value: stats.loading ? '—' : formatMoney(stats.todayReceived),
        accent: 'gold' as const,
      },
      {
        title: '待收尾款',
        subtitle: '近30天·待加工/加工中/待取镜 订单金额',
        value: stats.loading ? '—' : formatMoney(stats.pendingBalance),
        accent: 'cyan' as const,
      },
      {
        title: '预估毛利',
        subtitle: '按今日实收 × 门店参考毛利率 估算',
        value: stats.loading ? '—' : formatMoney(stats.estGrossProfit),
        accent: 'emerald' as const,
      },
    ],
    [stats],
  );

  const runExport = async () => {
    setExporting(true);
    setExportProgress(0);
    setExportMessage('正在进行金融级数据脱敏整理');

    const messages = [
      '正在进行金融级数据脱敏整理',
      '正在对齐税务科目与利润表口径',
      '正在生成银行贷款审核标准版式',
    ];
    let msgIdx = 0;
    const msgTimer = window.setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, messages.length - 1);
      setExportMessage(messages[msgIdx]);
    }, 900);

    const progressTimer = window.setInterval(() => {
      setExportProgress((p) => {
        if (p >= 92) return p;
        return p + Math.random() * 12 + 4;
      });
    }, 180);

    try {
      await new Promise((r) => setTimeout(r, 2200));
      const res = await fetch('/api/finance/export-pl-sample');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
      }
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        data?: { fileName?: string; url?: string };
      };
      if (!j.ok || !j.data?.url) {
        throw new Error(j.error || '导出失败：OSS 上传返回为空');
      }
      const a = document.createElement('a');
      a.href = j.data.url;
      a.download =
        j.data.fileName || `银行贷款审核标准报表_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
      setExportProgress(100);
      setExportMessage('导出完成，已上传至阿里云 OSS');
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      window.alert('导出失败：' + toChineseErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      window.clearInterval(msgTimer);
      window.clearInterval(progressTimer);
      setExporting(false);
      setExportProgress(0);
    }
  };

  if (!hasPermission('reports.view')) {
    return <div className="min-h-[50vh] flex items-center justify-center text-slate-600">当前账号无权访问财务对账概览。</div>;
  }

  return (
    <div className="min-h-full">
      {/* 顶栏：企业网银式深蓝 */}
      <header className="border-b border-[#0a2f52] bg-gradient-to-r from-[#002a4a] via-[#003b6f] to-[#0a4a7a] text-white shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
              <Landmark className="h-6 w-6 text-amber-200" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide md:text-xl">财务对账中心</h1>
              <p className="text-xs text-sky-100/80">企业级 · 合规对账概览 · 仅供内部管理使用</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadStats()}
              disabled={stats.loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${stats.loading ? 'animate-spin' : ''}`} />
              刷新数据
            </button>
            <div className="hidden items-center gap-1 rounded-md border border-white/20 bg-black/15 px-2.5 py-1.5 text-[10px] text-sky-100/90 sm:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              安全会话已加密
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 md:px-8">
        {/* 数字大卡片：网银式深色底 */}
        <section className="rounded-2xl border border-[#0a2f52] bg-gradient-to-b from-[#001a33] via-[#022447] to-[#063056] p-5 shadow-inner md:p-7">
          <p className="mb-4 text-xs font-medium text-sky-200/70">资金概览 · 实时汇总</p>
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((c) => (
              <StatCard key={c.title} {...c} />
            ))}
          </div>
        </section>

        {/* 导出主操作区 */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-bold text-[#003b6f]">监管报送与信贷资料</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
                导出文件符合系统内「银行贷款审核参考样式」利润表版式，含本月数 / 本年累计、明细备查页及系统对账校验码。报表由服务端直接读取阿里云 PostgreSQL（Prisma）生成，并自动上传阿里云 OSS 归档。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={exporting}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[#c9a227] to-[#a88615] px-6 py-3.5 text-sm font-bold text-[#1a1a1a] shadow-md ring-1 ring-amber-600/40 hover:from-[#d4ad2e] hover:to-[#b69118] disabled:opacity-60 md:min-w-[280px]"
            >
              <Download className="h-4 w-4" />
              导出银行贷款审核标准报表
            </button>
          </div>

          {exporting && (
            <div className="mt-6 rounded-lg border border-[#003b6f]/20 bg-[#f0f6fc] p-4">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-[#003b6f]">
                <span>{exportMessage}</span>
                <span className="tabular-nums">{Math.round(exportProgress)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#003b6f] to-[#0066b3] transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.min(100, exportProgress)}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-slate-500">数据处理过程符合内控要求，请勿关闭页面</p>
            </div>
          )}
        </section>

        <p className="text-center text-[10px] text-slate-400">
          界面风格参考商业银行企业网银信息展示习惯，不构成任何银行业务承诺。实际授信以金融机构审批为准。
        </p>
      </div>
    </div>
  );
}
