'use client';

import dynamic from 'next/dynamic';
import type { PrintOrder } from '@/components/PrintTemplate';

const PrintTemplate = dynamic(() => import('@/components/PrintTemplate'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-gray-500">加载小票模板…</div>,
});

const WorkorderTemplate = dynamic(() => import('@/components/WorkorderTemplate'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-gray-500">加载加工单模板…</div>,
});

export function ReceiptPrintBundle({ order }: { order: PrintOrder }) {
  return (
    <>
      <div id="receipt-print-area" className="bg-white p-3 shadow-xl print:shadow-none print:p-0">
        <PrintTemplate order={order} />
      </div>
      <div id="workorder-print-area" className="bg-white p-3 shadow-xl print:shadow-none print:p-0">
        <WorkorderTemplate order={order} />
      </div>
    </>
  );
}
