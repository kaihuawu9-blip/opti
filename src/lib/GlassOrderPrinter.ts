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

export class GlassOrderPrinter {
  private esc = '\x1B';
  private gs = '\x1D';

  private init = this.esc + '@';
  private reset = this.esc + '!' + '\x00';
  private boldOn = this.esc + 'E' + '\x01';
  private boldOff = this.esc + 'E' + '\x00';
  private doubleWidth = this.esc + '!' + '\x20';
  private centerAlign = this.esc + 'a' + '\x01';
  private leftAlign = this.esc + 'a' + '\x00';
  private cut = this.gs + 'V' + '\x41' + '\x00';
  private feed = '\n';

  constructor() {}

  private text(v: unknown): string {
    const s = String(v ?? '').trim();
    return s || '-';
  }

  private toMoney(v: unknown): string {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }

  private lineTotal(item: PrintLineItem): number {
    const explicit = Number(item.line_total ?? item.lineTotal);
    if (Number.isFinite(explicit)) return explicit;
    const qty = Number(item.quantity ?? 0);
    const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
    return Number.isFinite(qty * unit) ? qty * unit : 0;
  }

  private padLeft(str: string | null | undefined, len: number): string {
    const s = this.text(str);
    const spaces = Math.max(0, len - s.length);
    return ' '.repeat(spaces) + s;
  }

  private padRight(str: string | null | undefined, len: number): string {
    const s = this.text(str);
    const spaces = Math.max(0, len - s.length);
    return s + ' '.repeat(spaces);
  }

  private normalizeMethodLabel(raw: string): string {
    const m = raw.toLowerCase();
    if (m.includes('meituan') || m.includes('美团') || m.includes('douyin') || m.includes('抖音')) return '美团/抖音';
    if (m.includes('wechat') || m.includes('微信')) return '微信支付';
    if (m.includes('alipay') || m.includes('支付宝')) return '支付宝支付';
    if (m.includes('cash') || m.includes('现金')) return '现金';
    return this.text(raw);
  }

  private axisCell(v: unknown): string {
    return this.text(v).replace(/°+$/u, '');
  }

  generateESC_POS(order: PrintOrder): string {
    const orderNo = this.text(order.order_no ?? order.orderNo);
    const storeName = this.text(order.store_name ?? order.storeName);
    const createdAt = this.text(order.created_at ?? order.createdAt);
    const customerName = this.text(order.customer_name ?? order.customerName);
    const customerPhone = this.text(order.customer_phone ?? order.customerPhone);
    const paymentRaw = this.text(order.payment_method ?? order.paymentMethod ?? 'cash');
    const paymentLabel = this.normalizeMethodLabel(paymentRaw);
    const hasMeituan = /(meituan|美团|douyin|抖音)/iu.test(paymentRaw);
    const hasWechat = /(wechat|微信)/iu.test(paymentRaw);
    const voucher = this.text(order.meituan_voucher ?? order.meituanVoucher);
    const paymentNote = this.text(order.payment_note ?? order.paymentNote);
    const items = order.items ?? [];
    const total = order.total_amount ?? order.totalAmount ?? items.reduce((sum, it) => sum + this.lineTotal(it), 0);

    const orderRx = order.rx ?? items.find((it) => Boolean(it.rx?.right || it.rx?.left))?.rx ?? null;
    const right = orderRx?.right ?? {};
    const left = orderRx?.left ?? {};

    let output = '';

    output += this.init;
    output += this.reset;
    output += this.feed;

    output += this.centerAlign;
    output += this.doubleWidth;
    output += this.boldOn;
    output += storeName + this.feed;
    output += this.boldOff;
    output += this.reset;
    output += '验光配镜销售单' + this.feed;
    output += this.feed;

    output += this.leftAlign;
    output += '订单号: ' + orderNo + this.feed;
    output += '时间: ' + createdAt + this.feed;
    output += '客户: ' + customerName + this.feed;
    output += '电话: ' + customerPhone + this.feed;
    output += this.feed;

    output += '================================' + this.feed;
    output += this.centerAlign;
    output += '专业验光表' + this.feed;
    output += this.leftAlign;
    output += '--------------------------------' + this.feed;
    output += '验光项目      右眼(OD)   左眼(OS)' + this.feed;
    output += '--------------------------------' + this.feed;
    output += '球镜(SPH): ' + this.padLeft(right.ds, 8) + '  ' + this.padLeft(left.ds, 8) + this.feed;
    output += '散光(CYL): ' + this.padLeft(right.dc, 8) + '  ' + this.padLeft(left.dc, 8) + this.feed;
    output += '轴位(AXIS):' + this.padLeft(this.axisCell(right.axis), 8) + '  ' + this.padLeft(this.axisCell(left.axis), 8) + this.feed;
    output += '瞳距(PD):  ' + this.padLeft(right.pd, 8) + '  ' + this.padLeft(left.pd, 8) + this.feed;
    output += '下加(ADD): ' + this.padLeft(right.add, 8) + '  ' + this.padLeft(left.add, 8) + this.feed;
    output += '================================' + this.feed;
    output += this.feed;

    output += '商品明细:' + this.feed;
    output += '--------------------------------' + this.feed;
    output += this.padRight('商品', 16) + ' ' + this.padLeft('单价', 6) + ' ' + this.padLeft('数量', 4) + ' ' + this.padLeft('小计', 8) + this.feed;
    output += '--------------------------------' + this.feed;

    for (const item of items) {
      const name = this.text(item.name);
      const unit = Number(item.unit_price ?? item.unitPrice ?? 0);
      const qty = Number(item.quantity ?? 0);
      const subtotal = this.lineTotal(item);

      const displayName = name.length > 14 ? name.substring(0, 14) + '..' : name;
      output += this.padRight(displayName, 16) + ' ';
      output += this.padLeft(this.toMoney(unit), 6) + ' ';
      output += this.padLeft(String(Number.isFinite(qty) ? qty : 0), 4) + ' ';
      output += this.padLeft(this.toMoney(subtotal), 8) + this.feed;
    }

    output += '--------------------------------' + this.feed;
    output += this.feed;

    output += '【结算区】' + this.feed;
    output += '支付方式: ' + paymentLabel + this.feed;
    output += this.boldOn;
    output += '应收合计: ￥' + this.toMoney(total) + this.feed;
    output += this.boldOff;

    if (hasMeituan && voucher && voucher !== '-') {
      output += '【美团团购券号】' + voucher + this.feed;
    }
    if (hasWechat && paymentNote && paymentNote !== '-') {
      output += '微信备注: ' + paymentNote + this.feed;
    }

    output += this.feed;
    output += '--------------------------------' + this.feed;
    output += this.centerAlign;
    output += this.boldOn;
    output += '凭此单据取镜' + this.feed;
    output += this.boldOff;
    output += '温馨提示: 建议半年复查视力' + this.feed;
    output += this.leftAlign;

    output += this.feed;
    output += this.feed;
    output += this.feed;
    output += this.feed;
    output += this.feed;

    output += this.cut;

    return output;
  }
}
