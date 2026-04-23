'use client';

import { useEffect } from 'react';

/**
 * 开发环境清理 SW/Cache 一次即可；避免 Strict Mode 双调用 + 热更新重挂载时反复全量清缓存
 * 造成主线程阻塞与网络重复拉取，主观「整站很卡」。
 */
let devCacheClearOnce = false;

export default function DevCacheGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (devCacheClearOnce) return;
    devCacheClearOnce = true;

    const run = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch {}

      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {}
    };

    void run();
  }, []);

  return null;
}
