'use client';

import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

/**
 * 目标元素 `clientWidth` / `clientHeight`（可观察区域，不含 border），`ResizeObserver` 更新。
 */
export function useElementClientSize(
  elRef: RefObject<Element | null>,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const read = () => {
      if (!elRef.current) return;
      setSize({ width: elRef.current.clientWidth, height: elRef.current.clientHeight });
    };

    if (typeof ResizeObserver === 'undefined') {
      read();
      return;
    }
    const ro = new ResizeObserver(() => {
      read();
    });
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [elRef]);

  return size;
}
