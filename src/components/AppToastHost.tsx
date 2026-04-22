'use client';

import { useEffect, useState, useCallback } from 'react';

type ToastItem = { id: number; message: string; variant: 'error' | 'info' };

/**
 * 监听 `window` 上的 `opti-app-toast`，用于非 React 上下文（如 apiFetch）触发的轻提示。
 */
export default function AppToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, variant: ToastItem['variant']) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, variant }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  useEffect(() => {
    const onToast = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string; variant?: ToastItem['variant'] }>;
      const message = String(ce.detail?.message || '').trim();
      if (!message) return;
      push(message, ce.detail?.variant === 'info' ? 'info' : 'error');
    };
    window.addEventListener('opti-app-toast', onToast as EventListener);
    return () => window.removeEventListener('opti-app-toast', onToast as EventListener);
  }, [push]);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            t.variant === 'error'
              ? 'border-red-200 bg-red-50/95 text-red-900'
              : 'border-slate-200 bg-white/95 text-slate-800'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
