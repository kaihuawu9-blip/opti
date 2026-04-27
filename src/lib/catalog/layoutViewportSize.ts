/**
 * Layout viewport CSS 像素（`document.documentElement.clientWidth/Height`）。
 * 用于全屏 cover 分母与 `screenRel*` 指纹，优先于 `window.innerWidth/Height`，
 * 以减少高分屏 / 平板上与 visualViewport 或 UI 缩放相关的漂移。
 */
export function getLayoutViewportCssSize(): { w: number; h: number } {
  if (typeof document === 'undefined') return { w: 1, h: 1 };
  const de = document.documentElement;
  let w = de.clientWidth;
  let h = de.clientHeight;
  if (typeof window !== 'undefined') {
    if (!(w > 0)) w = window.innerWidth;
    if (!(h > 0)) h = window.innerHeight;
  }
  return { w: w > 0 ? w : 1, h: h > 0 ? h : 1 };
}

/**
 * 整屏物理像素（`window.screen.width/height`，CSS px）。
 * 蔡司全屏「暴力撞边」缩放分母：不按 layout 视口避让标签/工具栏；若 `screen` 不可用则回退 {@link getLayoutViewportCssSize}。
 */
export function getPhysicalScreenCssSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1, h: 1 };
  const sw = window.screen?.width;
  const sh = window.screen?.height;
  const w = typeof sw === 'number' && sw > 0 ? sw : 0;
  const h = typeof sh === 'number' && sh > 0 ? sh : 0;
  if (w > 0 && h > 0) return { w, h };
  return getLayoutViewportCssSize();
}
