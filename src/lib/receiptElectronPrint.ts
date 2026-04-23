/**
 * 桌面端小票打印桥接。
 *
 * 消费两种订单载荷（二选一，类型守卫分流）：
 *   1) 历史 `LegacyReceiptOrder`（销售表原 row，items[] 结构）
 *   2) `EyewearReceiptPayload`（= `AdaptResult.order[]` + meta，来自 `dataAdapter`）
 *
 * 所有 `window.electronAPI` / `navigator.bluetooth` 访问均走窄化守卫，杜绝 `any` 泄漏。
 */

import {
  computeOrderItemTotalYuan,
  computeReceiptTotalYuan,
  isEyewearReceiptPayload,
  type EyePrescription,
  type EyewearOrderItem,
  type EyewearReceiptPayload,
} from './api/dataAdapter';

// ─── 历史销售订单类型（尽量宽松，兼容 snake/camel） ─────────────────────────

export interface LegacyReceiptItem {
  name?: string;
  quantity?: number;
  unit_price?: number;
  unitPrice?: number;
  line_total?: number;
  lineTotal?: number;
}

export interface LegacyReceiptOrder {
  store_name?: string;
  storeName?: string;
  order_no?: string;
  orderNo?: string;
  created_at?: string;
  createdAt?: string;
  customer_name?: string;
  customerName?: string;
  customer_phone?: string;
  customerPhone?: string;
  total_amount?: number;
  totalAmount?: number;
  items?: readonly LegacyReceiptItem[];
}

export type PrintableReceiptOrder =
  | LegacyReceiptOrder
  | EyewearReceiptPayload
  | null
  | undefined;

// ─── localStorage 偏好 ─────────────────────────────────────────────────────

const STORAGE_KEY = 'sale_system_receipt_printer_device_v1';
const COMPAT_MODE_KEY = 'sale_system_printer_compat_mode_v1';

function looksLikeFilePrinter(name: string | null | undefined): boolean {
  const t = String(name ?? '').trim().toLowerCase();
  if (!t) return false;
  return /pdf|onenote|xps|fax|document writer|save as|导出|保存为|virtual/.test(t);
}

export function getSavedReceiptPrinterDevice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export function setSavedReceiptPrinterDevice(name: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!name?.trim()) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, name.trim());
  } catch {
    // ignore quota
  }
}

export function getPrinterCompatMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COMPAT_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPrinterCompatMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.localStorage.setItem(COMPAT_MODE_KEY, 'true');
    } else {
      window.localStorage.removeItem(COMPAT_MODE_KEY);
    }
  } catch {
    // ignore quota
  }
}

// ─── Web Bluetooth 最小类型（避免依赖 `@types/web-bluetooth`） ───────────────

type BluetoothServiceUUID = number | string;
type BluetoothCharacteristicUUID = number | string;

interface BluetoothCharacteristicProperties {
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
}

interface BluetoothRemoteGATTCharacteristic {
  readonly properties: BluetoothCharacteristicProperties;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
  disconnect(): void;
}

interface BluetoothRemoteGATT {
  connect(): Promise<BluetoothRemoteGATTServer>;
}

interface BluetoothDevice {
  readonly gatt?: BluetoothRemoteGATT;
}

interface RequestDeviceOptions {
  acceptAllDevices?: boolean;
  optionalServices?: readonly BluetoothServiceUUID[];
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
}

// ─── Electron / Bluetooth 桥接类型（局部窄化，不污染全局） ───────────────────

interface ElectronPrintResult {
  status?: 'success' | 'failure' | string;
  error?: string;
  message?: string;
}

interface ElectronPrintRequest {
  order: PrintableReceiptOrder;
  htmlContent: string;
  deviceName?: string;
}

interface ElectronPrintApi {
  print?: (req: ElectronPrintRequest) => Promise<ElectronPrintResult>;
  glassOrderPrintTest?: (
    order: PrintableReceiptOrder,
  ) => Promise<ElectronPrintResult | void>;
}

function getElectronApi(): ElectronPrintApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { electronAPI?: ElectronPrintApi }).electronAPI;
  return api ?? null;
}

type NavigatorWithBluetooth = Navigator & { bluetooth?: Bluetooth };

function getBluetooth(): Bluetooth | null {
  if (typeof navigator === 'undefined') return null;
  const bt = (navigator as NavigatorWithBluetooth).bluetooth;
  return bt ?? null;
}

// ─── 浏览器打印兜底（react-to-print 注入） ─────────────────────────────────

let cashierBrowserPrintOverride: (() => void | Promise<void>) | null = null;

export function setCashierBrowserPrintOverride(
  handler: (() => void | Promise<void>) | null,
): void {
  cashierBrowserPrintOverride = handler;
}

function tryBrowserPrintFallback(): boolean {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return false;
  if (cashierBrowserPrintOverride) {
    void Promise.resolve(cashierBrowserPrintOverride());
    return true;
  }
  window.setTimeout(() => window.print(), 0);
  return true;
}

// ─── 格式化工具 ────────────────────────────────────────────────────────────

const LINE_WIDTH = 32; // 58mm 热敏纸单行字符数（按 ASCII 估算；中文各占 2 位）

function hr(char = '-'): string {
  return char.repeat(LINE_WIDTH);
}

function fmtDiopter(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '-' : ' ';
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

function fmtYuan(n: number): string {
  return Number.isFinite(n) ? `￥${n.toFixed(2)}` : '￥0.00';
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function asFiniteNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── Eyewear 订单 → 行缓冲 ─────────────────────────────────────────────────

function renderEyePrescriptionLine(label: 'OD' | 'OS', eye: EyePrescription): string {
  const sph = fmtDiopter(eye.sphere);
  const cyl = fmtDiopter(eye.cylinder);
  const ax = String(Math.max(0, Math.min(180, eye.axis))).padStart(3, '0');
  const add = eye.addPower != null ? `ADD${fmtDiopter(eye.addPower)}` : '       ';
  const pd = eye.pdMm != null ? `PD${eye.pdMm.toFixed(1)}` : '';
  return ` ${label} ${sph} ${cyl} AX${ax} ${add} ${pd}`.trimEnd();
}

function renderEyewearItemLines(item: EyewearOrderItem, index: number): string[] {
  const lines: string[] = [];
  const { lens, prescription, price } = item;

  lines.push(`#${index + 1} ${lens.brand}`);
  const subset = lens.subset ? `（${lens.subset}）` : '';
  lines.push(` ${lens.series}${subset}`);
  lines.push(` 折射率 ${lens.index}  膜层 ${lens.coating}`);
  if (lens.lensType) lines.push(` 类型 ${lens.lensType}`);

  lines.push(renderEyePrescriptionLine('OD', prescription.od));
  lines.push(renderEyePrescriptionLine('OS', prescription.os));

  if (prescription.pdBinocularMm != null) {
    lines.push(` 瞳距 PD  ${prescription.pdBinocularMm.toFixed(1)} mm`);
  } else if (prescription.od.pdMm != null && prescription.os.pdMm != null) {
    const sum = prescription.od.pdMm + prescription.os.pdMm;
    lines.push(` 瞳距 PD  ${sum.toFixed(1)} mm（OD+OS）`);
  }
  if (prescription.fittingHeightMm != null) {
    lines.push(` 瞳高 FH  ${prescription.fittingHeightMm.toFixed(1)} mm`);
  }

  lines.push(` 零售 ${fmtYuan(price.retailYuan)}`);
  lines.push(` 折后 ${fmtYuan(price.discountedYuan)}`);
  if (price.processingFeeYuan > 0) {
    lines.push(` 加工 ${fmtYuan(price.processingFeeYuan)}`);
  }
  lines.push(` 小计 ${fmtYuan(computeOrderItemTotalYuan(item))}`);
  if (item.remark) {
    lines.push(` 备注：${item.remark}`);
  }
  return lines;
}

function buildLinesFromEyewearReceipt(payload: EyewearReceiptPayload): string[] {
  const lines: string[] = [];
  lines.push(payload.storeName);
  lines.push(hr());
  if (payload.orderNo) lines.push(`单号: ${payload.orderNo}`);
  if (payload.createdAt) lines.push(`时间: ${payload.createdAt}`);
  if (payload.customerName) lines.push(`客户: ${payload.customerName}`);
  if (payload.customerPhone) lines.push(`电话: ${payload.customerPhone}`);
  lines.push(hr());
  lines.push('镜片明细');

  payload.items.forEach((item, i) => {
    lines.push(hr('·'));
    for (const l of renderEyewearItemLines(item, i)) lines.push(l);
  });

  lines.push(hr());
  lines.push(`合计: ${fmtYuan(computeReceiptTotalYuan(payload))}`);
  lines.push('');
  lines.push('谢谢惠顾，欢迎再来');
  return lines;
}

// ─── 历史订单 → 行缓冲 ─────────────────────────────────────────────────────

function buildLinesFromLegacyOrder(order: LegacyReceiptOrder): string[] {
  const lines: string[] = [];
  const items: readonly LegacyReceiptItem[] = Array.isArray(order.items) ? order.items : [];
  const store =
    asString(order.store_name) || asString(order.storeName) || '门店';
  const orderNo = asString(order.order_no) || asString(order.orderNo);
  const createdAt = asString(order.created_at) || asString(order.createdAt);
  const customer = asString(order.customer_name) || asString(order.customerName);
  const phone = asString(order.customer_phone) || asString(order.customerPhone);
  const total = asFiniteNumber(order.total_amount ?? order.totalAmount ?? 0);

  lines.push(store);
  lines.push(hr());
  if (orderNo) lines.push(`单号: ${orderNo}`);
  if (createdAt) lines.push(`时间: ${createdAt}`);
  if (customer) lines.push(`客户: ${customer}`);
  if (phone) lines.push(`电话: ${phone}`);
  lines.push(hr());
  lines.push('商品');
  for (const it of items) {
    const name = asString(it.name) || '商品';
    const qty = asFiniteNumber(it.quantity);
    const unit = asFiniteNumber(it.unit_price ?? it.unitPrice);
    const sub = asFiniteNumber(it.line_total ?? it.lineTotal ?? qty * unit);
    lines.push(`${name.slice(0, 16)} x${qty}`);
    lines.push(`  ${fmtYuan(unit)}  小计${fmtYuan(sub)}`);
  }
  lines.push(hr());
  lines.push(`合计: ${fmtYuan(total)}`);
  lines.push('');
  lines.push('谢谢惠顾，欢迎再来');
  return lines;
}

// ─── ESC/POS 编码 ──────────────────────────────────────────────────────────

function buildEscPosBytesFromOrder(order: PrintableReceiptOrder): Uint8Array {
  const lines = isEyewearReceiptPayload(order)
    ? buildLinesFromEyewearReceipt(order)
    : buildLinesFromLegacyOrder((order ?? {}) as LegacyReceiptOrder);

  const text = `${lines.join('\n')}\n\n\n`;
  const payload = new TextEncoder().encode(text);

  // ESC/POS: 初始化 + 左对齐 + 文本 + 进纸 + 切刀
  const prefix = new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00]);
  const suffix = new Uint8Array([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x41, 0x00]);
  const out = new Uint8Array(prefix.length + payload.length + suffix.length);
  out.set(prefix, 0);
  out.set(payload, prefix.length);
  out.set(suffix, prefix.length + payload.length);
  return out;
}

// ─── 蓝牙直连（保留原路径，去 any） ─────────────────────────────────────────

const BLE_OPTIONAL_SERVICES: readonly BluetoothServiceUUID[] = [
  0xffe0,
  0x18f0,
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const BLE_CHAR_CANDIDATES: readonly string[] = [
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '49535343-1e4d-4bd9-ba61-23c647249616',
];

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    try {
      for (const uuid of BLE_CHAR_CANDIDATES) {
        try {
          const c = await svc.getCharacteristic(uuid);
          if (c.properties.write || c.properties.writeWithoutResponse) return c;
        } catch {
          // continue
        }
      }
      const chars = await svc.getCharacteristics();
      const writable = chars.find(
        (c) => c.properties.write || c.properties.writeWithoutResponse,
      );
      if (writable) return writable;
    } catch {
      // continue
    }
  }
  throw new Error('未找到可写入的蓝牙特征值（characteristic）');
}

/**
 * 平板/浏览器蓝牙直连打印。首次会弹出蓝牙设备选择框。
 */
export async function printReceiptViaWebBluetooth(
  order?: PrintableReceiptOrder,
): Promise<void> {
  const bluetooth = getBluetooth();
  if (!bluetooth) {
    throw new Error('当前浏览器不支持 Web Bluetooth');
  }
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [...BLE_OPTIONAL_SERVICES],
  });
  if (!device.gatt) throw new Error('设备不支持 GATT');
  const server = await device.gatt.connect();
  try {
    const ch = await findWritableCharacteristic(server);
    const bytes = buildEscPosBytesFromOrder(order ?? null);
    const chunkSize = 180;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const part = bytes.slice(i, i + chunkSize);
      await ch.writeValue(part);
      await new Promise<void>((r) => setTimeout(r, 20));
    }
  } finally {
    try {
      server.disconnect();
    } catch {
      // ignore
    }
  }
}

// ─── Electron 打印主路径 ───────────────────────────────────────────────────

async function waitForReceiptPrintDom(maxWaitMs = 3000): Promise<HTMLElement | null> {
  if (typeof document === 'undefined') return null;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const root =
      document.getElementById('print-bundle-area') ||
      document.getElementById('receipt-print-area');
    if (root && root.innerHTML.replace(/\s+/g, ' ').trim().length > 80) {
      return root;
    }
    await new Promise<void>((r) => setTimeout(r, 120));
  }
  return (
    document.getElementById('print-bundle-area') ||
    document.getElementById('receipt-print-area')
  );
}

async function runCompatModePrint(
  api: ElectronPrintApi,
  order: PrintableReceiptOrder,
): Promise<void> {
  if (!api.glassOrderPrintTest) {
    console.error('electronAPI.glassOrderPrintTest 不可用');
    window.alert('兼容模式打印通道不可用，请重启桌面端后重试');
    return;
  }
  await api.glassOrderPrintTest(order);
  console.log('GlassOrderPrinter 指令已发送');
}

/**
 * 收银 / 报表小票：使用 Electron IPC 打印到保存的热敏打印机；
 * 支持历史 `LegacyReceiptOrder` 与 `EyewearReceiptPayload` 两种载荷。
 */
export async function printReceiptWithElectronPreference(
  order?: PrintableReceiptOrder,
): Promise<void> {
  try {
    const api = getElectronApi();
    const compatMode = getPrinterCompatMode();

    if (compatMode) {
      console.log('兼容模式开启，使用 GlassOrderPrinter ESC/POS 纯文本打印...');
      if (!order) {
        console.warn('兼容模式需要订单对象，无法打印');
        window.alert('兼容模式需要订单数据，请重新结算后再试');
        return;
      }
      if (!api) {
        console.error('electronAPI 桥不可用');
        window.alert('桌面打印桥不可用，请重启桌面端后重试');
        return;
      }
      await runCompatModePrint(api, order);
      return;
    }

    console.log('兼容模式关闭，使用标准高清打印...');
    const hasStandardPrint = Boolean(api?.print);
    const hasCompatPrint = Boolean(api?.glassOrderPrintTest);

    if (!hasStandardPrint && !hasCompatPrint) {
      console.error('electronAPI.print / glassOrderPrintTest 均不可用');
      if (!tryBrowserPrintFallback()) {
        window.alert('当前不在桌面打印环境（或桥接未注入），且浏览器打印不可用。');
      }
      return;
    }

    let root =
      typeof document !== 'undefined'
        ? document.getElementById('print-bundle-area') ||
          document.getElementById('receipt-print-area')
        : null;
    if (
      typeof document !== 'undefined' &&
      (!root || root.innerHTML.replace(/\s+/g, ' ').trim().length < 80)
    ) {
      root = await waitForReceiptPrintDom();
    }
    const htmlContent = root
      ? `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>html,body{margin:0;padding:0;background:#fff;}body{display:flex;justify-content:center;}</style></head><body>${root.innerHTML}</body></html>`
      : '';
    const preferredPrinter = getSavedReceiptPrinterDevice();

    // 老驱动兜底：未选择真实打印机 / 误选虚拟打印机，直接走 ESC/POS
    if (
      (!preferredPrinter || looksLikeFilePrinter(preferredPrinter)) &&
      order &&
      hasCompatPrint &&
      api
    ) {
      await runCompatModePrint(api, order);
      console.log('未配置有效实体打印机，已自动走兼容模式打印');
      return;
    }

    let result: ElectronPrintResult | null = null;
    if (hasStandardPrint && api?.print) {
      result = await api.print({
        order: order ?? null,
        htmlContent,
        deviceName: preferredPrinter ?? undefined,
      });
    }

    console.log('打印结果:', result);

    if (result?.status === 'success') {
      console.log('打印成功！');
      return;
    }

    console.error('标准打印失败:', result);
    if (order && hasCompatPrint && api) {
      try {
        await runCompatModePrint(api, order);
        console.log('已回退到兼容模式打印');
      } catch (fallbackErr) {
        console.error('兼容模式兜底打印失败:', fallbackErr);
        if (!tryBrowserPrintFallback()) {
          window.alert('打印失败：标准与兼容打印都未成功，请检查打印机连接/驱动。');
        }
      }
      return;
    }

    if (!tryBrowserPrintFallback()) {
      window.alert('打印失败：请检查打印机连接，并在「打印设置」中测试打印。');
    }
  } catch (e) {
    console.error('打印异常:', e);
  }
}
