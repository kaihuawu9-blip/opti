'use client';

import { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import JsBarcode from 'jsbarcode';

type Props = {
  saleNo: string;
};

/**
 * 小票/加工单：订单号 CODE128 条形码 + QR（便于扫码检索）
 */
export function SaleNoPrintCodes({ saleNo }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || !saleNo.trim()) return;
    try {
      while (el.firstChild) el.removeChild(el.firstChild);
      JsBarcode(el, saleNo, {
        format: 'CODE128',
        width: 1.15,
        height: 34,
        displayValue: true,
        fontSize: 9,
        textMargin: 2,
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      /* 单号含非法字符等时跳过条码，仍保留二维码 */
    }
  }, [saleNo]);

  if (!saleNo.trim()) return null;

  return (
    <div className="sale-no-codes">
      <svg ref={svgRef} className="sale-no-barcode" aria-hidden />
      <div className="sale-no-qr-wrap">
        <QRCodeSVG value={saleNo} size={76} level="M" includeMargin={false} />
      </div>
    </div>
  );
}
