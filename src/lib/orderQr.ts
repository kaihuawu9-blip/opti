/**
 * 小票底部「取镜扫码」二维码载荷：jsorder:v1|<sale_no>|<primary_sale_uuid>
 * primary_sale_uuid 为插入后首行 sales.id，便于校验；查询以 sale_no 拉齐整单明细。
 */

export const ORDER_QR_MAGIC = 'jsorder:v1';

export function buildOrderQrPayload(saleNo: string, primarySaleId: string): string {
  const sn = String(saleNo || '').trim();
  const id = String(primarySaleId || '').trim();
  if (!sn || !id) return '';
  return `${ORDER_QR_MAGIC}|${sn}|${id}`;
}

export function parseOrderQrPayload(raw: string): { saleNo: string; primarySaleId: string } | null {
  const t = String(raw || '').trim();
  if (!t.startsWith(`${ORDER_QR_MAGIC}|`)) return null;
  const rest = t.slice(ORDER_QR_MAGIC.length + 1);
  const lastPipe = rest.lastIndexOf('|');
  if (lastPipe <= 0) return null;
  const saleNo = rest.slice(0, lastPipe).trim();
  const primarySaleId = rest.slice(lastPipe + 1).trim();
  if (!saleNo || !primarySaleId) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(primarySaleId)) {
    return null;
  }
  return { saleNo, primarySaleId };
}
