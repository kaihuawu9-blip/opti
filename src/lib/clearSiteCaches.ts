/**
 * 注销本站 Service Worker 并清空 Cache Storage（不碰 localStorage 业务数据）。
 * 用于解决「普通窗口白屏/卡住、无痕却能打开」等缓存错配问题。
 */
export async function unregisterServiceWorkersAndCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}
