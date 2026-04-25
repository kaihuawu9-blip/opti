'use client';

import { useLayoutEffect, useState } from 'react';

function readWindowSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * 视口 `innerWidth` / `innerHeight`；`resize` 时更新。客户端 `useState` 初始即读一次，避免全屏/缩放首帧为 0 变 microscope。
 */
export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => readWindowSize());

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const r = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    r();
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  return size;
}
