'use client';
import { getPrintTechSupportLineSync, resolveStoreDisplayName } from '@/lib/storeDisplayName';

type RxEye = {
  ds?: string | null;
  dc?: string | null;
  axis?: string | null;
  pd?: string | null;
  add?: string | null;
};

type RxData = {
  right?: RxEye | null;
  left?: RxEye | null;
};

type PrintLineItem = {
  name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  unitPrice?: number | null;
  line_total?: number | null;
  lineTotal?: number | null;
  rx?: RxData | null;
  tintInfo?: {
    id?: string | null;
    name?: string | null;
    hex?: string | null;
    surchargeYuan?: number | null;
  } | null;
};

type PaymentMethod = 'cash' | 'wechat' | 'alipay' | 'meituan_douyin' | string;

export type PrintOrder = {
  order_no?: string | null;
  orderNo?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  store_name?: string | null;
  storeName?: string | null;
  customer_name?: string | null;
  customerName?: string | null;
  customer_phone?: string | null;
  customerPhone?: string | null;
  payment_method?: PaymentMethod | null;
  paymentMethod?: PaymentMethod | null;
  payment_note?: string | null;
  paymentNote?: string | null;
  meituan_voucher?: string | null;
  meituanVoucher?: string | null;
  total_amount?: number | null;
  totalAmount?: number | null;
  rx?: RxData | null;
  items?: PrintLineItem[] | null;
};

type Props = {
  order: PrintOrder;
  className?: string;
};

function text(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || '-';
}

function toMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function lineTotal(item: PrintLineItem): number {
  const explicit = Number(item.line_total ?? item.lineTotal);
  if (Number.isFinite(explicit)) return explicit;
  const qty = Number(item.quantity ?? 0);
  const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
  return Number.isFinite(qty * unit) ? qty * unit : 0;
}

function normalizeMethodLabel(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('meituan') || m.includes('美团') || m.includes('douyin') || m.includes('抖音')) return '美团/抖音';
  if (m.includes('wechat') || m.includes('微信')) return '微信支付';
  if (m.includes('alipay') || m.includes('支付宝')) return '支付宝支付';
  if (m.includes('cash') || m.includes('现金')) return '现金';
  return text(raw);
}

function parseMethods(raw: string): string[] {
  const parts = raw
    .split(/[,+/|，、\s]+/u)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) return [normalizeMethodLabel(raw)];
  return parts.map((p) => normalizeMethodLabel(p));
}

function axisCell(v: unknown): string {
  return text(v).replace(/°+$/u, '');
}

type LensDiagramProps = { data: PrintOrder };

/**
 * 销售单「分段保护」中的第二段：镜片厚度示意单独 `print-doc-card`，与第一段收据主体解耦，
 * 长收据分页时不腰斩示意区。显式 print-color-adjust 保留浅色底与描边。
 */
function LensThicknessDiagram({ data }: LensDiagramProps) {
  void data;
  return (
    <div
      className="print-doc-card rounded-md border border-gray-200/80 bg-gray-50/50 p-2 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] [&_*]:[-webkit-print-color-adjust:exact] [&_*]:[print-color-adjust:exact]"
      aria-label="镜片厚度示意"
    >
      <div className="text-xs font-bold mb-1 text-slate-800 print:text-[10px]">镜片厚度示意</div>
      <section className="print80-thickness-demo">
        <div className="thickness-visual">
          <div className="lens-group">
            <p className="lens-label">左镜片（示意）</p>
            <div className="lens-shape" />
            <p className="lens-metric">颞 4.12 mm　鼻 2.46 mm</p>
            <p className="lens-metric-sub">颞侧（下缘）2.34 mm</p>
          </div>
          <div className="thickness-center-divider" />
          <div className="lens-group">
            <p className="lens-label">右镜片（示意）</p>
            <div className="lens-shape" />
            <p className="lens-metric">鼻 2.46 mm　颞 4.12 mm</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export function PrintTemplate({ order, className = '' }: Props) {
  const orderNo = text(order.order_no ?? order.orderNo);
  const storeName = resolveStoreDisplayName(order.store_name ?? order.storeName);
  const createdAt = text(order.created_at ?? order.createdAt);
  const customerName = text(order.customer_name ?? order.customerName);
  const customerPhone = text(order.customer_phone ?? order.customerPhone);
  const paymentRaw = text(order.payment_method ?? order.paymentMethod ?? 'cash');
  const paymentLabels = parseMethods(paymentRaw);
  const hasMeituan = /(meituan|美团|douyin|抖音)/iu.test(paymentRaw);
  const hasWechat = /(wechat|微信)/iu.test(paymentRaw);
  const voucher = text(order.meituan_voucher ?? order.meituanVoucher);
  const paymentNote = text(order.payment_note ?? order.paymentNote);
  const items = order.items ?? [];
  const total = order.total_amount ?? order.totalAmount ?? items.reduce((sum, it) => sum + lineTotal(it), 0);
  const tintParams = items
    .filter((item) => Boolean(item.tintInfo?.name))
    .map((item) => ({
      productName: text(item.name),
      tintName: text(item.tintInfo?.name),
      hex: text(item.tintInfo?.hex),
      surchargeYuan: Number(item.tintInfo?.surchargeYuan ?? 0),
    }));
  const techSupportLine = getPrintTechSupportLineSync();

  /* 销售单分段：① 收据主体 ② 镜片示意；各自 print-doc-card，见 ReceiptPrintBundle 头注释。 */
  return (
    <div id="print-template-80mm" className={`print80 overflow-visible ${className}`.trim()}>
      <div className="print-doc-card mb-4 border-b-2 border-dashed border-gray-300 pb-4 print:mb-3 print:pb-3 print:border-gray-400">
      <header className="print80-header">
        <h1 className="print80-title-main">销售收据</h1>
        <p className="print80-store">{storeName}</p>
        <p className="print80-meta-line">单号: {orderNo}</p>
        <p className="print80-meta-line">客人: {customerName} / {customerPhone}</p>
        <p className="print80-meta-line">{createdAt}</p>
      </header>

      <section className="print80-block">
        <div className="print80-table-head">
          <span>项目</span>
          <span>金额</span>
        </div>
        <div className="print80-items">
          {items.map((item, idx) => {
            const name = text(item.name);
            const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
            const qty = Number(item.quantity ?? 0);
            const subtotal = lineTotal(item);
            const rx = item.rx ?? null;
            const tintInfo = item.tintInfo ?? null;
            const r = rx?.right ?? null;
            const l = rx?.left ?? null;
            return (
              <div key={`${name}-${idx}`} className="print80-item-row">
                <div className="item-main">
                  <p className="item-name">{name}</p>
                  <p className="item-sub">￥{toMoney(unit)} × {Number.isFinite(qty) ? qty : 0}</p>
                  {r || l ? (
                    <p className="item-rx">
                      右眼 DS:{text(r?.ds)} DC:{text(r?.dc)} 轴:{axisCell(r?.axis)} 视力:{text(r?.add || '-')}
                      <br />
                      左眼 DS:{text(l?.ds)} DC:{text(l?.dc)} 轴:{axisCell(l?.axis)} 视力:{text(l?.add || '-')} 瞳距:{text(r?.pd || l?.pd)}
                    </p>
                  ) : null}
                  {tintInfo?.name ? (
                    <p className="item-rx">
                      染色: {text(tintInfo.name)} ({text(tintInfo.hex)}) +¥{toMoney(tintInfo.surchargeYuan ?? 0)}
                    </p>
                  ) : null}
                </div>
                <div className="item-amt">￥{toMoney(subtotal)}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="print80-total">
        <span>合计金额</span>
        <strong>￥{toMoney(total)}</strong>
      </section>

      <section className="print80-payline">
        <p>支付方式: {paymentLabels.join(' + ')}</p>
        {hasMeituan ? <p>团购券号: {voucher}</p> : null}
        {hasWechat ? <p>微信备注: {paymentNote}</p> : null}
      </section>

      {tintParams.length > 0 ? (
        <section className="print80-block">
          <div className="print80-table-head">
            <span>[染色参数]（定制生产单）</span>
            <span>定制</span>
          </div>
          <div className="print80-items">
            {tintParams.map((row, idx) => (
              <div key={`${row.productName}-${row.tintName}-${idx}`} className="print80-item-row">
                <div className="item-main">
                  <p className="item-name">{row.productName}</p>
                  <p className="item-sub">
                    颜色: {row.tintName} / Hex: {row.hex}
                  </p>
                </div>
                <div className="item-amt">+¥{toMoney(row.surchargeYuan)}</div>
              </div>
            ))}
          </div>
          <p className="item-sub" style={{ marginTop: '1.2mm' }}>
            此项为工厂车房定制，生产周期 3-7 天。
          </p>
        </section>
      ) : null}

      <footer className="print80-footer">
        <p className="thanks">感谢光临</p>
        <p className="sub">请妥善保管此收据</p>
        <p className="tech-support">{techSupportLine}</p>
      </footer>
      </div>

      <LensThicknessDiagram data={order} />

      <style jsx>{`
        .print80 {
          box-sizing: border-box;
          width: 74mm;
          max-width: 74mm;
          margin: 0 auto;
          padding: 3mm 2.6mm;
          background: #fff;
          color: #1f2937;
          font-family:
            'Microsoft YaHei',
            'PingFang SC',
            'Noto Sans SC',
            sans-serif;
          font-size: 10px;
          line-height: 1.35;
          overflow: visible !important;
          word-break: break-word;
          overflow-wrap: anywhere;
        }

        .print80-header {
          text-align: center;
          margin-bottom: 2.2mm;
        }

        .print80-title-main {
          margin: 0;
          font-size: 20px;
          font-weight: 900;
          color: #111827;
        }

        .print80-store {
          margin: 1.1mm 0 0.7mm;
          font-size: 16px;
          font-weight: 800;
          color: #1f2937;
        }

        .print80-meta-line {
          margin: 0.2mm 0;
          font-size: 10px;
          color: #6b7280;
        }

        .print80-block {
          border-top: 1px dashed #cbd5e1;
          border-bottom: 1px dashed #cbd5e1;
          padding: 1.4mm 0;
        }

        .print80-table-head {
          display: flex;
          justify-content: space-between;
          font-weight: 800;
          color: #111827;
          margin-bottom: 1mm;
        }

        .print80-items {
          display: grid;
          gap: 1.4mm;
        }

        .print80-item-row {
          display: flex;
          justify-content: space-between;
          gap: 2mm;
        }

        .item-main {
          min-width: 0;
          flex: 1;
        }

        .item-name {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: #111827;
        }

        .item-sub {
          margin: 0.4mm 0 0;
          font-size: 10px;
          color: #6b7280;
        }

        .item-rx {
          margin: 0.6mm 0 0;
          font-size: 9px;
          color: #374151;
          line-height: 1.3;
        }

        .item-amt {
          font-size: 13px;
          font-weight: 800;
          text-align: right;
        }

        .print80-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 2mm;
          font-size: 14px;
          font-weight: 900;
          color: #111827;
        }

        .print80-total strong {
          font-size: 17px;
        }

        .print80-payline {
          margin-top: 1mm;
          font-size: 9.5px;
          color: #4b5563;
          line-height: 1.35;
        }

        .print80-payline p {
          margin: 0.3mm 0;
        }

        .print80-footer {
          margin-top: 2.8mm;
          border-top: 1px solid #e5e7eb;
          padding-top: 2.2mm;
          text-align: center;
        }

        .print80-footer .thanks {
          margin: 0;
          font-size: 28px;
          font-weight: 900;
          color: #111827;
        }

        .print80-footer .sub {
          margin: 0.8mm 0 0;
          font-size: 10px;
          font-weight: 600;
          color: #9ca3af;
        }

        .print80-footer .tech-support {
          margin: 1.1mm 0 0;
          font-size: 9px;
          color: #9ca3af;
        }

        .print80-thickness-demo {
          margin-top: 0;
          border: 1px solid #dbeafe;
          border-radius: 2.2mm;
          padding: 1.8mm 1.6mm;
          background: #f8fbff;
        }

        .thickness-visual {
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1px 1fr;
          gap: 1.2mm;
          align-items: start;
        }

        .thickness-center-divider {
          align-self: stretch;
          background: #93c5fd;
          border-radius: 999px;
          opacity: 0.8;
        }

        .lens-group {
          text-align: center;
        }

        .lens-label {
          margin: 0;
          font-size: 8.5px;
          font-weight: 700;
          color: #1e3a8a;
        }

        .lens-shape {
          width: 100%;
          height: 16mm;
          margin-top: 0.9mm;
          border: 1px solid #60a5fa;
          border-radius: 999px;
          background: #dbeafe;
        }

        .lens-metric {
          margin: 0.9mm 0 0;
          font-size: 8.4px;
          font-weight: 700;
          color: #1f2937;
        }

        .lens-metric-sub {
          margin: 0.5mm 0 0;
          font-size: 8px;
          font-weight: 700;
          color: #065f46;
        }

        @media print {
          @page {
            size: 80mm auto;
            margin: 0;
          }

          .print80 {
            width: 74mm !important;
            max-width: 74mm !important;
            margin: 0 auto !important;
            padding: 2.2mm 2.2mm !important;
            overflow: visible !important;
          }
        }
      `}</style>
    </div>
  );
}

export default PrintTemplate;
