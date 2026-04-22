/**
 * Web Bluetooth 能力检测（收银小票蓝牙直连打印用）。
 * 注意：iPad/iPhone 全系浏览器目前均不提供 Web Bluetooth，与是否 Chrome 图标无关。
 */

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 常伪装成 Macintosh
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  if (/iPad/.test(ua)) return true;
  return false;
}

export function hasWebBluetooth(): boolean {
  if (typeof navigator === 'undefined') return false;
  const bt = (navigator as Navigator & { bluetooth?: { requestDevice?: unknown } }).bluetooth;
  return typeof bt !== 'undefined' && typeof bt?.requestDevice === 'function';
}

/** 非空表示当前环境无法使用 Web Bluetooth，可直接展示给用户 */
export function webBluetoothUnavailableReason(): string | null {
  if (hasWebBluetooth()) return null;
  if (isAppleTouchDevice()) {
    return 'iPad / iPhone 上的 Safari、Chrome、微信内置浏览器等目前都不支持 Web Bluetooth，无法在网页里弹出蓝牙小票机选择框。请使用安卓平板 + Chrome（HTTPS），或使用本页「系统打印」走 AirPrint；Windows 电脑请用镜售桌面版 USB 打印。';
  }
  return '当前浏览器未提供 Web Bluetooth（部分国产浏览器会移除该能力）。请在 HTTPS 环境下使用 Chrome / Edge 最新版，或使用「系统打印」。';
}
