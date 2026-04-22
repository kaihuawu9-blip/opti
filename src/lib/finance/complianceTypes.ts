/** 眼镜店财务合规报表 — 与 JSON 设计对齐（导出 Excel 的输入类型） */

export type FinanceLineCategory = 'frame' | 'lens' | 'processing_fee' | 'accessory' | 'other';

export type PaymentChannelCode = 'wechat' | 'alipay' | 'cash' | 'medical_insurance_card' | 'other';

export type FinanceLineItem = {
  line_no: number;
  category: FinanceLineCategory;
  category_label: string;
  sku_or_name: string;
  quantity: number;
  unit_price_tax_inclusive: number;
  line_amount_tax_inclusive: number;
  unit_cost: number;
  line_cost: number;
  tax_code?: string;
  remark?: string | null;
};

export type PaymentChannelRow = {
  channel: PaymentChannelCode;
  channel_label: string;
  amount: number;
};

export type FinancialSummary = {
  currency: string;
  vat_rate: number;
  revenue_tax_inclusive: number;
  revenue_tax_exclusive: number;
  output_vat_amount: number;
  total_cost: number;
  gross_profit?: number;
  amount_receivable: number;
  amount_received: number;
  balance_due: number;
  allocation_note?: string;
};

export type PrescriptionRef = {
  prescription_doc_no?: string;
  internal_sale_id?: string;
  linked_sale_no?: string;
  prescription_snapshot_hash?: string;
  examiner_license_no?: string;
  remark?: string;
};

export type ComplianceMeta = {
  currency: string;
  vat_rate: number;
  rounding_rule?: string;
  generated_at: string;
};

/** 利润表「本月 / 本年累计」成对金额（银行贷款审核式报表用） */
export type PeriodMoney = {
  current_month: number;
  year_to_date: number;
};

/**
 * 可选：手工覆盖利润表各栏；不传时由 deriveProfitLossPeriodFromDocument 从单笔明细推算。
 * 成本口径：营业利润 = 营业收入合计 − (营业成本 − 存货跌价准备冲减) − 营业税金及附加 − 销售费用
 * （inventory_provision 为正表示从营业成本中扣减的金额，即降低有效成本；若为 0 则忽略）
 */
export type ProfitLossPeriodOverride = {
  report_title?: string;
  /** 编制单位，如门店名 */
  reporting_entity?: string;
  /** 报表期间说明，如 2026年4月 */
  period_label?: string;
  revenue_frames: PeriodMoney;
  revenue_lenses_and_accessories: PeriodMoney;
  cost_of_sales: PeriodMoney;
  /** 减：存货跌价准备（正数 = 从营业成本中减去该金额得到有效成本） */
  inventory_provision: PeriodMoney;
  business_taxes_and_surcharges: PeriodMoney;
  selling_expenses: PeriodMoney;
  /** 营业外收支净额等，计入「利润总额」在营业利润基础上加总 */
  net_non_operating?: PeriodMoney;
};

export type EyewearFinanceSaleDocument = {
  doc_type: string;
  sale_no: string;
  sale_datetime: string;
  store_id?: string;
  store_name?: string;
  line_items: FinanceLineItem[];
  payment_channels: PaymentChannelRow[];
  financial_summary: FinancialSummary;
  prescription_ref?: PrescriptionRef;
  compliance_meta: ComplianceMeta;
  /** 若填写则优先用于利润表；否则按 line_items + financial_summary 自动拆分本月数，本年累计默认等于本月数 */
  profit_loss?: ProfitLossPeriodOverride;
};
