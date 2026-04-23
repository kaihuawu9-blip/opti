/** 桌面端：保存的热敏打印机系统名（Electron deviceName），用于静默直打、不经 PDF 另存 */

const STORAGE_KEY = 'sale_system_receipt_printer_device_v1';
const COMPAT_MODE_KEY = 'sale_system_printer_compat_mode_v1';

function looksLikeFilePrinter(name: string | null | undefined): boolean {
  const t = String(name || '').trim().toLowerCase();
  if (!t) return false;
  return /pdf|onenote|xps|fax|document writer|save as|导出|保存为|virtual/.test(t);
}

/** 收银预览挂载时由 CashierPage 注入：用 react-to-print 只打票据 DOM，避免整页 visibility 规则打出白纸 */
let cashierBrowserPrintOverride: (() => void | Promise<void>) | null = null;

export function setCashierBrowserPrintOverride(handler: (() => void | Promise<void>) | null): void {
  cashierBrowserPrintOverride = handler;
}

function tryBrowserPrintFallback(): boolean {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return false;
  if (cashierBrowserPrintOverride) {
    void Promise.resolve(cashierBrowserPrintOverride());
    return true;
  }
  // 让当前 tick 的 UI 更新（预览区渲染）先完成，再弹浏览器打印对话框。
  window.setTimeout(() => window.print(), 0);
  return true;
}

const BLE_OPTIONAL_SERVICES: BluetoothServiceUUID[] = [
  0xffe0, // 常见热敏蓝牙服务
  0x18f0, // 某些票据机使用
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // SPP over BLE 常见
];

const BLE_CHAR_CANDIDATES = [
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '49535343-1e4d-4bd9-ba61-23c647249616',
];

function buildEscPosBytesFromOrder(order: any): Uint8Array {
  const items = Array.isArray(order?.items) ? order.items : [];
  const lines: string[] = [];
  const store = String(order?.store_name || order?.storeName || '门店').trim() || '门店';
  const orderNo = String(order?.order_no || order?.orderNo || '').trim();
  const createdAt = String(order?.created_at || order?.createdAt || '').trim();
  const customer = String(order?.customer_name || order?.customerName || '').trim();
  const phone = String(order?.customer_phone || order?.customerPhone || '').trim();
  const total = Number(order?.total_amount ?? order?.totalAmount ?? 0);

  lines.push(store);
  lines.push('------------------------------');
  if (orderNo) lines.push(`单号: ${orderNo}`);
  if (createdAt) lines.push(`时间: ${createdAt}`);
  if (customer) lines.push(`客户: ${customer}`);
  if (phone) lines.push(`电话: ${phone}`);
  lines.push('------------------------------');
  lines.push('商品');
  for (const it of items) {
    const name = String(it?.name || '').trim() || '商品';
    const qty = Number(it?.quantity ?? 0);
    const unit = Number(it?.unit_price ?? it?.unitPrice ?? 0);
    const sub = Number(it?.line_total ?? it?.lineTotal ?? qty * unit);
    lines.push(`${name.slice(0, 16)} x${Number.isFinite(qty) ? qty : 0}`);
    lines.push(`  ￥${Number.isFinite(unit) ? unit.toFixed(2) : '0.00'}  小计￥${Number.isFinite(sub) ? sub.toFixed(2) : '0.00'}`);
  }
  lines.push('------------------------------');
  lines.push(`合计: ￥${Number.isFinite(total) ? total.toFixed(2) : '0.00'}`);
  lines.push('');
  lines.push('谢谢惠顾，欢迎再来');

  const text = lines.join('\n') + '\n\n\n';
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

async function findWritableCharacteristic(server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
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
      const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) return writable;
    } catch {
      // continue
    }
  }
  throw new Error('未找到可写入的蓝牙特征值（characteristic）');
}

/**
 * 平板/浏览器蓝牙直连打印（Web Bluetooth）。
 * 使用常见热敏打印机服务与 ESC/POS 指令；首次会弹蓝牙设备选择框。
 */
export async function printReceiptViaWebBluetooth(order?: any): Promise<void> {
  if (typeof navigator === 'undefined' || !(navigator as any).bluetooth) {
    throw new Error('当前浏览器不支持 Web Bluetooth');
  }
  const bluetooth = (navigator as any).bluetooth as Bluetooth;
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_OPTIONAL_SERVICES,
  });
  if (!device.gatt) throw new Error('设备不支持 GATT');
  const server = await device.gatt.connect();
  try {
    const ch = await findWritableCharacteristic(server);
    const bytes = buildEscPosBytesFromOrder(order || {});
    const chunkSize = 180;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const part = bytes.slice(i, i + chunkSize);
      await ch.writeValue(part);
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    try {
      server.disconnect();
    } catch {
      // ignore
    }
  }
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

/** 等待小票 DOM 就绪（Next dynamic 加载 PrintTemplate 前 innerHTML 很短） */
async function waitForReceiptPrintDom(maxWaitMs = 3000): Promise<Element | null> {
  if (typeof document === 'undefined') return null;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const root =
      document.getElementById('print-bundle-area') || document.getElementById('receipt-print-area');
    if (root && root.innerHTML.replace(/\s+/g, ' ').trim().length > 80) {
      return root;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return document.getElementById('print-bundle-area') || document.getElementById('receipt-print-area');
}

/** 收银 / 报表小票：使用 Electron IPC 打印到保存的热敏打印机 */
export async function printReceiptWithElectronPreference(order?: any): Promise<void> {
  try {
    const compatMode = getPrinterCompatMode();
    
    if (compatMode) {
      console.log('兼容模式开启，使用 GlassOrderPrinter ESC/POS 纯文本打印...');
      
      if (!order) {
        console.warn('兼容模式需要订单对象，无法打印');
        window.alert('兼容模式需要订单数据，请重新结算后再试');
        return;
      }
      
      try {
        if (!(window as any).electronAPI?.glassOrderPrintTest) {
          console.error('electronAPI.glassOrderPrintTest 不可用');
          window.alert('兼容模式打印通道不可用，请重启桌面端后重试');
          return;
        }
        await (window as any).electronAPI.glassOrderPrintTest(order);
        console.log('GlassOrderPrinter 指令已发送');
      } catch (e) {
        console.error('GlassOrderPrinter 打印失败:', e);
        window.alert('兼容模式打印失败，请检查控制台');
      }
    } else {
      console.log('兼容模式关闭，使用标准高清打印...');
      const hasStandardPrint = Boolean((window as any).electronAPI?.print);
      const hasCompatPrint = Boolean((window as any).electronAPI?.glassOrderPrintTest);
      if (!hasStandardPrint && !hasCompatPrint) {
        console.error('electronAPI.print / glassOrderPrintTest 均不可用');
        if (!tryBrowserPrintFallback()) {
          window.alert('当前不在桌面打印环境（或桥接未注入），且浏览器打印不可用。');
        }
        return;
      }
      
      console.log('调用 electronAPI.print...');

      let root =
        typeof document !== 'undefined'
          ? document.getElementById('print-bundle-area') || document.getElementById('receipt-print-area')
          : null;
      if (typeof document !== 'undefined' && (!root || root.innerHTML.replace(/\s+/g, ' ').trim().length < 80)) {
        root = await waitForReceiptPrintDom();
      }
      const htmlContent = root
        ? `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>html,body{margin:0;padding:0;background:#fff;}body{display:flex;justify-content:center;}</style></head><body>${root.innerHTML}</body></html>`
        : '';
      const preferredPrinter = getSavedReceiptPrinterDevice();

      // 老驱动兜底：未选择真实打印机，或误选了“输出为文件”打印机时，直接走兼容 ESC/POS
      if ((!preferredPrinter || looksLikeFilePrinter(preferredPrinter)) && order && hasCompatPrint) {
        await (window as any).electronAPI.glassOrderPrintTest(order);
        console.log('未配置有效实体打印机，已自动走兼容模式打印');
        return;
      }

      let result: any = null;
      if (hasStandardPrint) {
        result = await (window as any).electronAPI.print({
          order: order || null,
          htmlContent,
          deviceName: preferredPrinter || undefined,
        });
      }

      console.log('打印结果:', result);

      if (result?.status === 'success') {
        console.log('打印成功！');
      } else {
        console.error('标准打印失败:', result);
        // 兜底：标准打印失败时自动降级到 ESC/POS 指令打印
        if (order && hasCompatPrint) {
          try {
            await (window as any).electronAPI.glassOrderPrintTest(order);
            console.log('已回退到兼容模式打印');
          } catch (fallbackErr) {
            console.error('兼容模式兜底打印失败:', fallbackErr);
            if (!tryBrowserPrintFallback()) {
              window.alert('打印失败：标准与兼容打印都未成功，请检查打印机连接/驱动。');
            }
          }
        } else {
          if (!tryBrowserPrintFallback()) {
            window.alert('打印失败：请检查打印机连接，并在「打印设置」中测试打印。');
          }
        }
      }
    }
  } catch (e) {
    console.error('打印异常:', e);
  }
}
