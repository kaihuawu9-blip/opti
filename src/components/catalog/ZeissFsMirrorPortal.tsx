'use client';

/**
 * ZeissFsMirrorPortal — 全屏镜像唯一入口（body 末级 Portal）
 *
 * 焦土规约：
 * - 严禁 `@/styles/page-flip.css` / stf__* / ScaledBlock。
 * - Portal 的 React 子树仅 **一个** `div.fixed.inset-0`（`data-zeiss-fs-portal-root`），其内为双图 + 透明路由 + 侧栏。
 */

import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '@/styles/zeiss-fs-mirror-portal.css';
import { ZeissFullscreenMirror } from '@/components/catalog/ZeissFullscreenMirror';

export interface ZeissFsMirrorPortalProps {
  open: boolean;
  appMounted: boolean;
  portalReactKey: string | number;
  currentPage: number;
  total: number;
  onNavigate: (delta: number) => void;
  onNavigateToPage: (page0: number) => void;
  onClose: () => void;
}

export function ZeissFsMirrorPortal({
  open,
  appMounted,
  portalReactKey,
  currentPage,
  total,
  onNavigate,
  onNavigateToPage,
  onClose,
}: ZeissFsMirrorPortalProps) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!appMounted || !open) {
      setPortalHost((prev) => {
        if (prev?.isConnected) prev.remove();
        return null;
      });
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('data-zeiss-fs-portal-host', '1');
    host.style.cssText =
      'position:fixed;left:0;top:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:visible;z-index:2147483646;pointer-events:auto;box-sizing:border-box;';
    document.body.appendChild(host);
    setPortalHost(host);
    return () => {
      host.remove();
      setPortalHost(null);
    };
  }, [appMounted, open]);

  if (!portalHost || !open || !appMounted) return null;

  return createPortal(
    <div
      key={portalReactKey}
      data-zeiss-fs-portal-root="1"
      role="dialog"
      aria-modal
      aria-label="蔡司价目手册 · 全屏沉浸"
      className="fixed inset-0"
    >
      <ZeissFullscreenMirror
        currentPage={currentPage}
        total={total}
        onNavigate={onNavigate}
        onNavigateToPage={onNavigateToPage}
        onClose={onClose}
      />
    </div>,
    portalHost,
  );
}
