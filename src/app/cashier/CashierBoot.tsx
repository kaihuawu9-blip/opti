'use client';

import dynamic from 'next/dynamic';

const CashierPageClient = dynamic(() => import('./CashierPageClient'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-gray-600">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600"
        aria-hidden
      />
      <p className="text-sm">加载收银台…</p>
    </div>
  ),
});

export default function CashierBoot() {
  return <CashierPageClient />;
}
