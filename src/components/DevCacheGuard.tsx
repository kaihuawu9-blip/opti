'use client';

import { useEffect } from 'react';

export default function DevCacheGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

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
