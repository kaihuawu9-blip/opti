'use client';

import { lazy, Suspense } from 'react';

const DashboardPage = lazy(() => import('./dashboard/page'));

export default function Home() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500 text-sm">加载工作台…</div>}>
      <DashboardPage />
    </Suspense>
  );
}
