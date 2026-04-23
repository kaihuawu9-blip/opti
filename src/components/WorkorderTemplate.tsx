'use client';

/**
 * 定制生产单（加工单）版式组件。
 * 「整体保护」由父级 `#workorder-print-area.print-doc-card`（ReceiptPrintBundle）统一提供：
 * 整张工厂凭证尽量不分页。本组件内请勿再包一层 `print-doc-card`，避免双重 avoid；
 * 条码、镜片车房参数等应直接排在本模板 DOM 中。
 */

import { resolveStoreDisplayName } from '@/lib/storeDisplayName';
import type { PrintOrder } from '@/components/PrintTemplate';

type TintLine = {
  productName: string;
  tintName: string;
  hex: string;
  surchargeYuan: number;
};

type Props = {
  order: PrintOrder;
};

function text(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || '-';
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function collectTintLines(order: PrintOrder): TintLine[] {
  const items = Array.isArray(order.items) ? order.items : [];
  return items
    .filter((item) => Boolean(item && item.tintInfo && item.tintInfo.name))
    .map((item) => ({
      productName: text(item.name),
      tintName: text(item.tintInfo?.name),
      hex: text(item.tintInfo?.hex),
      surchargeYuan: Number(item.tintInfo?.surchargeYuan ?? 0),
    }));
}

export default function WorkorderTemplate({ order }: Props) {
  const orderNo = text(order.order_no ?? order.orderNo);
  const storeName = resolveStoreDisplayName(order.store_name ?? order.storeName);
  const createdAt = text(order.created_at ?? order.createdAt);
  const customerName = text(order.customer_name ?? order.customerName);
  const customerPhone = text(order.customer_phone ?? order.customerPhone);
  const tintLines = collectTintLines(order);

  return (
    <section className="workorder80 print-doc-workorder">
      <header className="workorder80-header">
        <h2>定制生产单</h2>
        <p>门店: {storeName}</p>
        <p>单号: {orderNo}</p>
        <p>客户: {customerName} / {customerPhone}</p>
        <p>时间: {createdAt}</p>
      </header>

      <section className="workorder80-block">
        <h3>[染色参数]</h3>
        {tintLines.length === 0 ? (
          <p className="muted">本单暂无染色定制参数。</p>
        ) : (
          <table className="workorder80-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>颜色名称</th>
                <th>Hex</th>
                <th>加价</th>
              </tr>
            </thead>
            <tbody>
              {tintLines.map((line, idx) => (
                <tr key={`${line.productName}-${line.tintName}-${idx}`}>
                  <td>{line.productName}</td>
                  <td>{line.tintName}</td>
                  <td>{line.hex}</td>
                  <td>+¥{money(line.surchargeYuan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="workorder80-note">
        <strong>备注:</strong> 此项为工厂车房定制，生产周期 3-7 天。
      </section>

      <style jsx>{`
        .workorder80 {
          box-sizing: border-box;
          width: 74mm;
          max-width: 74mm;
          margin: 0 auto;
          padding: 3mm 2.6mm;
          color: #111827;
          background: #fff;
          font-size: 10px;
          line-height: 1.35;
          font-family:
            'Microsoft YaHei',
            'PingFang SC',
            'Noto Sans SC',
            sans-serif;
        }
        .workorder80-header h2 {
          margin: 0 0 1mm;
          font-size: 16px;
          font-weight: 900;
          text-align: center;
        }
        .workorder80-header p {
          margin: 0.5mm 0;
          font-size: 9px;
        }
        .workorder80-block {
          margin-top: 2mm;
          border-top: 1px dashed #cbd5e1;
          border-bottom: 1px dashed #cbd5e1;
          padding: 1.6mm 0;
        }
        .workorder80-block h3 {
          margin: 0 0 1mm;
          font-size: 11px;
          font-weight: 900;
        }
        .workorder80-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 8.5px;
        }
        .workorder80-table th,
        .workorder80-table td {
          border: 1px solid #111827;
          padding: 1mm 0.8mm;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }
        .workorder80-table th {
          font-weight: 900;
        }
        .workorder80-note {
          margin-top: 2mm;
          padding: 1.4mm 1.2mm;
          border: 1px solid #111827;
          background: #f9fafb;
          font-size: 9px;
          line-height: 1.4;
        }
        .muted {
          margin: 0;
          font-size: 9px;
          color: #6b7280;
        }
      `}</style>
    </section>
  );
}
