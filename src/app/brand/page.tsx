'use client';

import Link from 'next/link';
import { NeuralBackground } from '@/components/brand/NeuralBackground';
import { ICP_RECORD_NUMBER, MIIT_ICP_LINK } from '@/lib/constants';

const sellingPoints = [
  {
    title: '官方直连：0.33% 费率',
    desc: '支付通道合规直连，成本透明可控，让利给门店增长。',
  },
  {
    title: 'AI 导购：业绩提升 40%',
    desc: '验光话术、连带推荐、库存解答，让每一次对话都更接近成交。',
  },
  {
    title: '多端同步：数据永不丢失',
    desc: '桌面、浏览器、小程序一体协同，云端实时一致，断电也不丢单。',
  },
] as const;

export default function BrandPage() {
  return (
    <div className="relative min-h-screen min-h-dvh overflow-x-hidden bg-[#030816] text-slate-100">
      <NeuralBackground />

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(59,130,246,0.22),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#030816]/70 via-transparent to-[#030816]"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex min-h-screen min-h-dvh max-w-6xl flex-col px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
        <header className="mb-16 flex flex-col items-center text-center sm:mb-20">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.35em] text-sky-400/80">
            JINGSHOU · META · 2025
          </p>
          <h1 className="max-w-4xl font-sans text-[clamp(2rem,6vw,3.75rem)] font-bold leading-[1.12] tracking-tight">
            <span className="jingshou-glow inline-block cursor-default text-sky-100">镜售</span>
            <span className="text-sky-200/90">·元</span>
            <span className="mt-3 block text-[clamp(1rem,2.8vw,1.5rem)] font-medium text-sky-100/75">
              — AI 驱动的眼镜店智慧大脑
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            未来感不是噱头，而是把验光、库存、支付与增长，收束进同一套神经回路。
          </p>
        </header>

        <section className="grid flex-1 gap-5 sm:grid-cols-3 sm:gap-6">
          {sellingPoints.map((item) => (
            <article
              key={item.title}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.12] bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_24px_80px_-32px_rgba(59,130,246,0.35)] backdrop-blur-xl transition-[transform,box-shadow,border-color] duration-500 hover:-translate-y-1 hover:border-sky-400/25 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.15)_inset,0_32px_100px_-28px_rgba(34,211,238,0.25)]"
            >
              <div
                className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-sky-500/15 blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-60"
                aria-hidden
              />
              <div className="relative">
                <div className="mb-3 h-px w-10 bg-gradient-to-r from-sky-400/80 to-transparent" />
                <h2 className="text-lg font-semibold tracking-tight text-sky-50 sm:text-xl">{item.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{item.desc}</p>
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-16 flex flex-col items-center gap-4 border-t border-white/[0.08] pt-10 text-center sm:mt-20">
          <p className="text-xs text-slate-500">镜售 · 眼镜门店数字化</p>
          <a
            href={MIIT_ICP_LINK}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 transition-colors hover:text-sky-200"
          >
            {ICP_RECORD_NUMBER}
          </a>
          <Link
            href="/"
            className="rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-medium text-sky-200/90 backdrop-blur-md transition-colors hover:border-sky-400/40 hover:bg-sky-500/10 hover:text-sky-100"
          >
            进入系统
          </Link>
        </footer>
      </div>
    </div>
  );
}
