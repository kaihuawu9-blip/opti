'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** 手机老板版：< 768px（含 <640 与 640~767 间隙，统一大字单列） */
export const DEVICE_BOSS_MAX_PX = 767;
/** 平板店员版：768 ~ 1024 */
export const DEVICE_STAFF_MAX_PX = 1024;
/** 电脑管理版：> 1024 */

export type DeviceLayoutMode = 'boss' | 'staff' | 'admin';

function resolveMode(width: number): DeviceLayoutMode {
  if (width <= DEVICE_BOSS_MAX_PX) return 'boss';
  if (width <= DEVICE_STAFF_MAX_PX) return 'staff';
  return 'admin';
}

type Ctx = {
  mode: DeviceLayoutMode;
  width: number;
  isBoss: boolean;
  isStaff: boolean;
  isAdmin: boolean;
};

const DeviceLayoutContext = createContext<Ctx | null>(null);

export function DeviceLayoutProvider({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(1280);

  const readWidth = useCallback(() => {
    if (typeof window === 'undefined') return;
    /** iOS Safari 等：地址栏显隐会改 innerWidth；visualViewport 更接近实际可视宽度，减少平板/横竖屏误判成错误布局档位。 */
    const vv = window.visualViewport;
    const w =
      vv && Number.isFinite(vv.width) && vv.width > 0 ? Math.round(vv.width) : window.innerWidth;
    setWidth(w);
  }, []);

  /** 首屏在 useLayoutEffect 读真实宽度，避免移动端先按 1280 排版再跳变导致点按区域错乱、像「点了没反应」。 */
  useLayoutEffect(() => {
    readWidth();
    window.addEventListener('resize', readWidth);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', readWidth);
    vv?.addEventListener('scroll', readWidth);
    return () => {
      window.removeEventListener('resize', readWidth);
      vv?.removeEventListener('resize', readWidth);
      vv?.removeEventListener('scroll', readWidth);
    };
  }, [readWidth]);

  const mode = useMemo(() => resolveMode(width), [width]);

  const value = useMemo<Ctx>(
    () => ({
      mode,
      width,
      isBoss: mode === 'boss',
      isStaff: mode === 'staff',
      isAdmin: mode === 'admin',
    }),
    [mode, width],
  );

  return <DeviceLayoutContext.Provider value={value}>{children}</DeviceLayoutContext.Provider>;
}

export function useDeviceLayout(): Ctx {
  const v = useContext(DeviceLayoutContext);
  if (!v) {
    throw new Error('useDeviceLayout must be used within DeviceLayoutProvider');
  }
  return v;
}
