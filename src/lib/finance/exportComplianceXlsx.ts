import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { APP_NAME } from '@/lib/constants';
import type { EyewearFinanceSaleDocument, ProfitLossPeriodOverride } from './complianceTypes';

export const CURRENCY_NUMFMT = '"¥"#,##0.00;[Red]-"¥"#,##0.00';

const THIN: ExcelJS.Border = { style: 'thin', color: { argb: 'FFCCCCCC' } };
const MEDIUM: ExcelJS.Border = { style: 'medium', color: { argb: 'FF333333' } };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 未提供 profit_loss 时：按含税行占比拆分不含税收入，成本/税金取自 financial_summary；本年累计默认等同本月（单笔导出场景） */
export function deriveProfitLossPeriodFromDocument(
  doc: EyewearFinanceSaleDocument,
): ProfitLossPeriodOverride {
  if (doc.profit_loss) return doc.profit_loss;

  const totalInc = doc.line_items.reduce((s, l) => s + Number(l.line_amount_tax_inclusive || 0), 0);
  const totalExc = round2(doc.financial_summary.revenue_tax_exclusive);
  const k = totalInc > 0 ? totalExc / totalInc : 0;

  let frameInc = 0;
  let lensGroupInc = 0;
  for (const l of doc.line_items) {
    const a = Number(l.line_amount_tax_inclusive || 0);
    if (l.category === 'frame') frameInc += a;
    else lensGroupInc += a;
  }
  if (frameInc === 0 && lensGroupInc === 0 && doc.line_items.length === 0) {
    lensGroupInc = totalInc;
  }

  const frameExc = round2(frameInc * k);
  const lensExc = round2(totalExc - frameExc);
  const cost = round2(doc.financial_summary.total_cost);
  const tax = round2(doc.financial_summary.output_vat_amount);

  return {
    revenue_frames: { current_month: frameExc, year_to_date: frameExc },
    revenue_lenses_and_accessories: { current_month: lensExc, year_to_date: lensExc },
    cost_of_sales: { current_month: cost, year_to_date: cost },
    inventory_provision: { current_month: 0, year_to_date: 0 },
    business_taxes_and_surcharges: { current_month: tax, year_to_date: tax },
    selling_expenses: { current_month: 0, year_to_date: 0 },
    net_non_operating: { current_month: 0, year_to_date: 0 },
  };
}

function effectiveCost(pl: ProfitLossPeriodOverride, col: 'cm' | 'ytd'): number {
  const cos = col === 'cm' ? pl.cost_of_sales.current_month : pl.cost_of_sales.year_to_date;
  const prov = col === 'cm' ? pl.inventory_provision.current_month : pl.inventory_provision.year_to_date;
  return round2(cos - prov);
}

/** 营业利润 = 营业收入 − 有效营业成本 − 营业税金及附加 − 销售费用（与参考表逻辑一致） */
export function computeOperatingProfit(pl: ProfitLossPeriodOverride, col: 'cm' | 'ytd'): number {
  const rf = col === 'cm' ? pl.revenue_frames.current_month : pl.revenue_frames.year_to_date;
  const rl =
    col === 'cm'
      ? pl.revenue_lenses_and_accessories.current_month
      : pl.revenue_lenses_and_accessories.year_to_date;
  const tax =
    col === 'cm'
      ? pl.business_taxes_and_surcharges.current_month
      : pl.business_taxes_and_surcharges.year_to_date;
  const sell = col === 'cm' ? pl.selling_expenses.current_month : pl.selling_expenses.year_to_date;
  return round2(rf + rl - effectiveCost(pl, col) - tax - sell);
}

export function computeTotalProfitBeforeTax(pl: ProfitLossPeriodOverride, col: 'cm' | 'ytd'): number {
  const op = computeOperatingProfit(pl, col);
  const n = pl.net_non_operating
    ? col === 'cm'
      ? pl.net_non_operating.current_month
      : pl.net_non_operating.year_to_date
    : 0;
  return round2(op + n);
}

export function buildReconciliationChecksum(
  doc: EyewearFinanceSaleDocument,
  salt?: string,
): string {
  const s = salt ?? process.env.FINANCE_EXPORT_HMAC_SALT ?? 'opti-ai-finance-export-default-salt';
  const pl = deriveProfitLossPeriodFromDocument(doc);
  const canonical = {
    doc_type: doc.doc_type,
    sale_no: doc.sale_no,
    sale_datetime: doc.sale_datetime,
    store_id: doc.store_id ?? '',
    lines: doc.line_items.map((l) => ({
      line_no: l.line_no,
      category: l.category,
      amt: round2(l.line_amount_tax_inclusive),
      cost: round2(l.line_cost),
    })),
    payments: doc.payment_channels.map((p) => ({
      ch: p.channel,
      amt: round2(p.amount),
    })),
    fs: {
      rev_inc: round2(doc.financial_summary.revenue_tax_inclusive),
      rev_exc: round2(doc.financial_summary.revenue_tax_exclusive),
      vat: round2(doc.financial_summary.output_vat_amount),
      cost: round2(doc.financial_summary.total_cost),
      recv: round2(doc.financial_summary.amount_received),
      ar: round2(doc.financial_summary.amount_receivable),
    },
    pl_snapshot: {
      rf: pl.revenue_frames,
      rl: pl.revenue_lenses_and_accessories,
      cos: pl.cost_of_sales,
      prov: pl.inventory_provision,
      tax: pl.business_taxes_and_surcharges,
      sell: pl.selling_expenses,
      op_cm: computeOperatingProfit(pl, 'cm'),
      op_ytd: computeOperatingProfit(pl, 'ytd'),
    },
    rx: doc.prescription_ref?.prescription_doc_no ?? '',
    gen: doc.compliance_meta.generated_at,
  };
  const h = createHash('sha256')
    .update(JSON.stringify(canonical) + '|' + s)
    .digest('hex');
  return `CHK-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}`.toUpperCase();
}

/** @deprecated 请优先使用 computeOperatingProfit / 利润表工作表逻辑 */
export function computeProfitStatementFigures(doc: EyewearFinanceSaleDocument) {
  const pl = deriveProfitLossPeriodFromDocument(doc);
  const 营业收入 = round2(
    pl.revenue_frames.current_month + pl.revenue_lenses_and_accessories.current_month,
  );
  const 营业成本 = effectiveCost(pl, 'cm');
  const 营业毛利 = round2(营业收入 - 营业成本);
  const 营业税金 = pl.business_taxes_and_surcharges.current_month;
  const 销售费用 = pl.selling_expenses.current_month;
  const 净利润 = computeOperatingProfit(pl, 'cm');
  return {
    营业收入,
    营业成本,
    营业毛利,
    营业税金及附加: 营业税金,
    销售费用,
    期间费用本单未分摊: 销售费用,
    净利润,
  };
}

function setMoneyPair(row: ExcelJS.Row, cm: number, ytd: number, bold = false) {
  const f = bold ? { bold: true } : undefined;
  row.getCell(2).value = round2(cm);
  row.getCell(2).numFmt = CURRENCY_NUMFMT;
  row.getCell(2).alignment = { horizontal: 'right' };
  if (f) row.getCell(2).font = { ...f };
  row.getCell(3).value = round2(ytd);
  row.getCell(3).numFmt = CURRENCY_NUMFMT;
  row.getCell(3).alignment = { horizontal: 'right' };
  if (f) row.getCell(3).font = { ...f };
  for (const c of [1, 2, 3]) {
    row.getCell(c).border = {
      top: THIN,
      bottom: THIN,
    };
  }
}

function setLabelCell(row: ExcelJS.Row, text: string, opts?: { bold?: boolean; indent?: number }) {
  const cell = row.getCell(1);
  cell.value = text;
  cell.alignment = {
    horizontal: 'left',
    vertical: 'middle',
    wrapText: true,
    indent: opts?.indent ?? 0,
  };
  if (opts?.bold) cell.font = { bold: true };
}

function applyPlHeaderRow(row: ExcelJS.Row) {
  row.getCell(1).value = '项目 / Items';
  row.getCell(2).value = '本月数';
  row.getCell(3).value = '本年累计';
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    cell.font = { bold: true };
    cell.alignment = {
      horizontal: colNumber === 1 ? 'left' : 'right',
      vertical: 'middle',
      wrapText: true,
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F4FA' },
    };
    cell.border = {
      top: THIN,
      bottom: MEDIUM,
      left: THIN,
      right: THIN,
    };
  });
}

function buildProfitLossSheet(
  ws: ExcelJS.Worksheet,
  doc: EyewearFinanceSaleDocument,
  pl: ProfitLossPeriodOverride,
  checksum: string,
): void {
  const title =
    pl.report_title ?? '利润表（眼镜零售 · 银行贷款审核参考样式）';
  const entity = pl.reporting_entity ?? doc.store_name ?? doc.store_id ?? '编制单位';
  const period = pl.period_label ?? doc.sale_datetime.slice(0, 7);

  let r = 1;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = title;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  ws.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  r += 1;
  ws.mergeCells(r, 1, r, 3);
  ws.getCell(r, 1).value = `${entity}　　期间：${period}　　单位：元`;
  ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF555555' } };
  ws.getCell(r, 1).alignment = { horizontal: 'center' };
  r += 2;

  const headerRow = ws.getRow(r);
  applyPlHeaderRow(headerRow);
  r += 1;

  const revCm = round2(
    pl.revenue_frames.current_month + pl.revenue_lenses_and_accessories.current_month,
  );
  const revYtd = round2(
    pl.revenue_frames.year_to_date + pl.revenue_lenses_and_accessories.year_to_date,
  );

  const row1 = ws.getRow(r);
  setLabelCell(row1, '一、营业收入（Total Revenue）', { bold: true });
  setMoneyPair(row1, revCm, revYtd, true);
  r += 1;

  const row1a = ws.getRow(r);
  setLabelCell(row1a, '　其中：框架眼镜销售（Frame Eyeglasses Sales）', { indent: 1 });
  setMoneyPair(row1a, pl.revenue_frames.current_month, pl.revenue_frames.year_to_date);
  r += 1;

  const row1b = ws.getRow(r);
  setLabelCell(row1b, '　其中：镜片及配件销售（Lens & Accessories Sales）', { indent: 1 });
  setMoneyPair(row1b, pl.revenue_lenses_and_accessories.current_month, pl.revenue_lenses_and_accessories.year_to_date);
  r += 1;

  const row2 = ws.getRow(r);
  setLabelCell(row2, '二、营业成本（Cost of Sales）', { bold: true });
  setMoneyPair(row2, pl.cost_of_sales.current_month, pl.cost_of_sales.year_to_date, true);
  r += 1;

  const row2a = ws.getRow(r);
  setLabelCell(row2a, '　减：存货跌价准备（Provision for inventory write-down）', { indent: 1 });
  setMoneyPair(row2a, pl.inventory_provision.current_month, pl.inventory_provision.year_to_date);
  r += 1;

  const row3 = ws.getRow(r);
  setLabelCell(row3, '三、营业税金及附加（Business Taxes & Surcharges）', { bold: true });
  setMoneyPair(
    row3,
    pl.business_taxes_and_surcharges.current_month,
    pl.business_taxes_and_surcharges.year_to_date,
    true,
  );
  r += 1;

  const row4 = ws.getRow(r);
  setLabelCell(row4, '四、销售费用（Selling Expenses）', { bold: true });
  setMoneyPair(row4, pl.selling_expenses.current_month, pl.selling_expenses.year_to_date, true);
  r += 1;

  const opCm = computeOperatingProfit(pl, 'cm');
  const opYtd = computeOperatingProfit(pl, 'ytd');
  const row5 = ws.getRow(r);
  setLabelCell(row5, '五、营业利润（Operating Profit）', { bold: true });
  setMoneyPair(row5, opCm, opYtd, true);
  row5.getCell(2).font = { bold: true };
  row5.getCell(3).font = { bold: true };
  r += 1;

  const tpCm = computeTotalProfitBeforeTax(pl, 'cm');
  const tpYtd = computeTotalProfitBeforeTax(pl, 'ytd');
  const row6 = ws.getRow(r);
  setLabelCell(row6, '六、利润总额（Total Profit before Tax）', { bold: true });
  setMoneyPair(row6, tpCm, tpYtd, true);
  row6.getCell(2).font = { bold: true };
  row6.getCell(3).font = { bold: true };
  r += 2;

  const note = ws.getRow(r);
  ws.mergeCells(r, 1, r, 3);
  note.getCell(1).value =
    '说明：营业收入为不含税口径（与 JSON financial_summary.revenue_tax_exclusive 拆分一致）；营业利润 = 营业收入合计 − (营业成本 − 存货跌价准备) − 营业税金及附加 − 销售费用。单笔导出时「本年累计」默认等于「本月数」，可在 JSON 的 profit_loss 中覆盖。';
  note.getCell(1).font = { size: 9, color: { argb: 'FF666666' } };
  note.getCell(1).alignment = { wrapText: true, vertical: 'top' };

  ws.columns = [{ width: 52 }, { width: 18 }, { width: 18 }];

  const genTime = new Date(doc.compliance_meta.generated_at || Date.now()).toLocaleString('zh-CN');
  ws.headerFooter.oddFooter = `&L&8系统对账校验码：${checksum}&R&8生成：${genTime}`;
  ws.headerFooter.oddHeader = `&C&9${doc.sale_no}`;
}

function applyHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF9' },
  };
}

function buildDetailSheet(ws: ExcelJS.Worksheet, doc: EyewearFinanceSaleDocument): void {
  let r = 1;
  ws.getCell(r, 1).value = '销售明细与备查（关联单号：' + doc.sale_no + '）';
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.mergeCells(r, 1, r, 8);
  r += 2;

  ws.getCell(r, 1).value = '销售单号';
  ws.getCell(r, 2).value = doc.sale_no;
  ws.getCell(r, 4).value = '销售时间';
  ws.getCell(r, 5).value = doc.sale_datetime;
  r += 1;
  ws.getCell(r, 1).value = '门店';
  ws.getCell(r, 2).value = doc.store_name ?? doc.store_id ?? '—';
  r += 2;

  ws.getCell(r, 1).value = '商品明细';
  ws.getCell(r, 1).font = { bold: true };
  r += 1;

  const lineHeaders = [
    '行号',
    '类别',
    '品名/SKU',
    '数量',
    '含税单价',
    '含税金额',
    '单位成本',
    '行成本',
  ];
  const hRow = ws.getRow(r);
  lineHeaders.forEach((text, i) => {
    hRow.getCell(i + 1).value = text;
  });
  applyHeaderRow(hRow);
  r += 1;

  for (const line of doc.line_items) {
    const row = ws.getRow(r);
    row.getCell(1).value = line.line_no;
    row.getCell(2).value = line.category_label;
    row.getCell(3).value = line.sku_or_name;
    row.getCell(4).value = line.quantity;
    row.getCell(5).value = round2(line.unit_price_tax_inclusive);
    row.getCell(5).numFmt = CURRENCY_NUMFMT;
    row.getCell(6).value = round2(line.line_amount_tax_inclusive);
    row.getCell(6).numFmt = CURRENCY_NUMFMT;
    row.getCell(7).value = round2(line.unit_cost);
    row.getCell(7).numFmt = CURRENCY_NUMFMT;
    row.getCell(8).value = round2(line.line_cost);
    row.getCell(8).numFmt = CURRENCY_NUMFMT;
    r += 1;
  }
  r += 1;

  ws.getCell(r, 1).value = '支付渠道';
  ws.getCell(r, 1).font = { bold: true };
  r += 1;
  const payH = ws.getRow(r);
  ['渠道', '金额'].forEach((t, i) => payH.getCell(i + 1).value = t);
  applyHeaderRow(payH);
  r += 1;
  for (const p of doc.payment_channels) {
    const row = ws.getRow(r);
    row.getCell(1).value = p.channel_label;
    row.getCell(2).value = round2(p.amount);
    row.getCell(2).numFmt = CURRENCY_NUMFMT;
    r += 1;
  }
  r += 1;

  ws.getCell(r, 1).value =
    '含税与增值税（' + (doc.financial_summary.vat_rate * 100).toFixed(0) + '%）';
  ws.getCell(r, 1).font = { bold: true };
  r += 1;
  const taxRows: [string, number][] = [
    ['含税销售额', round2(doc.financial_summary.revenue_tax_inclusive)],
    ['不含税销售额', round2(doc.financial_summary.revenue_tax_exclusive)],
    ['销项税额', round2(doc.financial_summary.output_vat_amount)],
    ['进货成本合计', round2(doc.financial_summary.total_cost)],
    ['应收合计', round2(doc.financial_summary.amount_receivable)],
    ['实收合计', round2(doc.financial_summary.amount_received)],
    ['应收余款', round2(doc.financial_summary.balance_due)],
  ];
  for (const [label, val] of taxRows) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(2).value = val;
    row.getCell(2).numFmt = CURRENCY_NUMFMT;
    r += 1;
  }
  r += 1;

  ws.getCell(r, 1).value = '验光关联';
  ws.getCell(r, 1).font = { bold: true };
  r += 1;
  const pr = doc.prescription_ref ?? {};
  for (const [k, v] of [
    ['验光单号', pr.prescription_doc_no ?? '—'],
    ['内部销售行', pr.internal_sale_id ?? '—'],
    ['关联单号', pr.linked_sale_no ?? doc.sale_no],
  ] as const) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 2).value = v;
    ws.mergeCells(r, 2, r, 8);
    r += 1;
  }

  ws.columns = [
    { width: 14 },
    { width: 14 },
    { width: 26 },
    { width: 8 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
}

/**
 * 导出 .xlsx：Sheet1 为银行贷款参考式利润表（本月/本年累计）；Sheet2 为销售明细备查。
 */
export async function exportEyewearFinanceSaleToXlsx(
  doc: EyewearFinanceSaleDocument,
  options?: { checksumSalt?: string },
): Promise<Buffer> {
  const checksum = buildReconciliationChecksum(doc, options?.checksumSalt);
  const pl = deriveProfitLossPeriodFromDocument(doc);

  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = new Date();

  const wsPl = wb.addWorksheet('利润表', {
    properties: { defaultRowHeight: 20 },
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  buildProfitLossSheet(wsPl, doc, pl, checksum);

  const wsDet = wb.addWorksheet('明细备查', {
    properties: { defaultRowHeight: 18 },
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  buildDetailSheet(wsDet, doc);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
