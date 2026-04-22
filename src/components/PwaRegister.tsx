'use client';

import { useEffect, useLayoutEffect } from 'react';
import { APP_VERSION } from '@/lib/appVersion';
import { unregisterServiceWorkersAndCaches } from '@/lib/clearSiteCaches';

const ASSET_VERSION_STORAGE_KEY = 'opti-app-asset-version';
/** 发版自愈只自动 reload 一轮，避免 localStorage 写入失败时出现死循环 */
const VERSION_HEAL_SESSION_KEY = 'opti-version-heal-done';
const ENABLE_SW_IN_PROD = String(process.env.NEXT_PUBLIC_ENABLE_PWA_SW || '').trim().toLowerCase() === 'true';

/**
 * 生产环境注册 /sw.js；并在发版后首轮清理 SW + Cache（与 package 版本对齐）。
 * `window.__optiClearCachesAndReload` 供 layout 兜底脚本与加载页按钮调用。
 */
export default function PwaRegister() {
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    (window as Window & { __optiClearCachesAndReload?: () => void }).__optiClearCachesAndReload = () => {
      void unregisterServiceWorkersAndCaches().finally(() => {
        window.location.reload();
      });
    };

    if (process.env.NODE_ENV !== 'production') return;

    void (async () => {
      try {
        if (sessionStorage.getItem(VERSION_HEAL_SESSION_KEY) === '1') {
          sessionStorage.removeItem(VERSION_HEAL_SESSION_KEY);
          try {
            localStorage.setItem(ASSET_VERSION_STORAGE_KEY, APP_VERSION);
          } catch {
            // ignore
          }
          return;
        }

        let prev: string | null;
        try {
          prev = localStorage.getItem(ASSET_VERSION_STORAGE_KEY);
        } catch {
          return;
        }

        if (!prev) {
          try {
            localStorage.setItem(ASSET_VERSION_STORAGE_KEY, APP_VERSION);
          } catch {
            // ignore
          }
          return;
        }

        if (prev === APP_VERSION) return;

        sessionStorage.setItem(VERSION_HEAL_SESSION_KEY, '1');
        await unregisterServiceWorkersAndCaches();
        try {
          localStorage.setItem(ASSET_VERSION_STORAGE_KEY, APP_VERSION);
        } catch {
          // 仍刷新一次以加载新脚本；下次进页会走 VERSION_HEAL_SESSION_KEY 分支，不再连刷
        }
        window.location.reload();
      } catch {
        try {
          sessionStorage.removeItem(VERSION_HEAL_SESSION_KEY);
        } catch {
          // ignore
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const run = async () => {
      const runningInElectronApp = window.location.protocol === 'app:';
      if (runningInElectronApp) {
        await unregisterServiceWorkersAndCaches();
        return;
      }

      if (process.env.NODE_ENV !== 'production') return;
      /** 默认禁用生产 SW，优先保证多终端（尤其平板）不吃到旧缓存导致界面错乱。 */
      if (!ENABLE_SW_IN_PROD) {
        await unregisterServiceWorkersAndCaches();
        return;
      }
      await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };

    void run();
  }, []);

  return null;
}
