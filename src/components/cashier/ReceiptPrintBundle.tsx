'use client';

import dynamic from 'next/dynamic';
import { forwardRef } from 'react';
import type { PrintOrder } from '@/components/PrintTemplate';

const PrintTemplate = dynamic(() => import('@/components/PrintTemplate'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-gray-500">加载小票模板…</div>,
});

const WorkorderTemplate = dynamic(() => import('@/components/WorkorderTemplate'), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-gray-500">加载加工单模板…</div>,
});

type BundleProps = { order: PrintOrder };

/**
 * 打印 bundle：销售单 vs 加工单策略不同（与 globals `.print-doc-card` 配合）。
 *
 * - 销售单（Receipt / #receipt-print-area）：分段保护。内容由 PrintTemplate 内多块
 *   `print-doc-card` 承担（收据主体一段、镜片厚度示意一段），长单可在自然分页处断开，
 *   且避免把「示意图」从中间撕开。此处外层不再套 `print-doc-card`，以免整张小票被
 *   `page-break-inside: avoid` 锁成一页、挤出大段空白。
 *
 * - 加工单（Workorder / #workorder-print-area）：整体保护。工厂生产凭证宜整页完整，
 *   便于裁切后贴包装袋；整条加工单由本层唯一 `print-doc-card` 包住（条码/镜片参数等
 *   将来都放在 WorkorderTemplate 内即可，勿在内部再叠一层 `print-doc-card`）。
 *
 * 预览：`#print-bundle-area` 不可 `hidden`，否则屏幕上看不到小票预览。
 */
export const ReceiptPrintBundle = forwardRef<HTMLDivElement, BundleProps>(function ReceiptPrintBundle(
  { order },
  ref,
) {
  return (
    <div
      id="print-bundle-area"
      ref={ref}
      className="w-full min-h-0 space-y-4 print:block print:space-y-4 print:w-full print:min-h-0 print:max-w-none"
    >
      <div
        id="receipt-print-area"
        className="bg-white p-3 shadow-xl print:shadow-none print:p-0 print:block print:min-h-0 print:w-full"
      >
        <PrintTemplate order={order} />
      </div>
      <div
        id="workorder-print-area"
        className="print-doc-card bg-white p-3 shadow-xl print:shadow-none print:p-0 print:block print:min-h-0 print:w-full"
      >
        <WorkorderTemplate order={order} />
      </div>
    </div>
  );
});

ReceiptPrintBundle.displayName = 'ReceiptPrintBundle';
