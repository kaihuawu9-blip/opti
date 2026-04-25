'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ZeissDigitalHandbook } from '@/components/catalog/ZeissDigitalHandbook';
import { Library } from 'lucide-react';

function catalogPagePointerToPct(e: React.PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  if (w < 1 || h < 1) return;
  const pctX = ((e.clientX - r.left) / w) * 100;
  const pctY = ((e.clientY - r.top) / h) * 100;
  // 收银/热区：以本层为 100%×100%，后续可映射到 PDF 页内或 Zeiss 舞台 rect
  console.info('[catalog] hotzone pointerUp (%)', {
    pctX: Math.round(pctX * 100) / 100,
    pctY: Math.round(pctY * 100) / 100,
    pointerId: e.pointerId,
  });
}

export default function CatalogPage() {
  const { hasPermission } = useAuth();

  const onCatalogPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button != null && e.button !== 0) return;
      catalogPagePointerToPct(e);
    },
    [],
  );

  if (!hasPermission('cashier.view')) {
    return <div className="text-slate-300">当前账号无权访问价格手册。</div>;
  }

  return (
    <div
      data-catalog-shell
      className="relative min-h-[calc(100dvh-4rem)] min-w-0 overflow-x-hidden bg-slate-950 py-6 text-slate-100 max-xl:pl-[max(0.75rem,calc(env(safe-area-inset-left)+0.5rem))] max-xl:pr-[max(0.75rem,calc(env(safe-area-inset-right)+0.5rem))] max-xl:pb-[max(1rem,env(safe-area-inset-bottom))] max-[1366px]:px-5 md:py-8 xl:px-[max(1.25rem,calc(env(safe-area-inset-left)+0.75rem))] xl:pr-[max(1.25rem,calc(env(safe-area-inset-right)+0.75rem))]"
    >
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 120% 70% at 18% 8%, rgba(0, 120, 200, 0.22), transparent 52%),
            radial-gradient(ellipse 90% 60% at 88% 22%, rgba(0, 89, 163, 0.18), transparent 48%),
            radial-gradient(ellipse 80% 55% at 50% 100%, rgba(2, 26, 46, 0.65), transparent 55%),
            radial-gradient(circle at 50% 40%, rgba(15, 35, 55, 0.9), #020617 72%)
          `,
        }}
      />
      <div className="pointer-events-none fixed inset-0 bg-slate-950/45 backdrop-blur-2xl" />

      <div
        className="relative z-10 mx-auto w-full min-w-0 max-w-[min(1320px,calc(100vw-1.25rem))] space-y-6 max-xl:max-w-[min(1320px,calc(100vw-2.25rem))]"
        onPointerUp={onCatalogPointerUp}
        data-catalog-page-layer
      >
        <header className="flex flex-wrap items-end gap-3 border-b border-white/10 pb-5">
          <Library className="h-9 w-9 shrink-0 text-[#5ba3d9]" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">蔡司数字化手册</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              双页 3D 翻页 · 右侧系列标签与页码自动对齐（文件名含「成长乐」即绑定成长乐标签）· 单页比例 3:4 等比 contained。
              请将高清 <code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-200">.jpg</code> /{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-200">.jpeg</code> 放入{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-200">public/catalog/zeiss-handbook/</code>
              ；<code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-200">ai-data/…/manifest.json</code> 仅保留书名等元数据。
            </p>
          </div>
        </header>

        <ZeissDigitalHandbook />
      </div>
    </div>
  );
}
