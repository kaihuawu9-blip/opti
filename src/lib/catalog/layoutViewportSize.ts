/**
 * Layout viewport CSS 像素（`document.documentElement.clientWidth/Height`）。
 * 用于非全屏手册等场景；**蔡司全屏 Hard-Fill 指纹分母请用 `window.innerWidth/Height`**
 * （见 {@link mountZeissFullscreenDomVars} / HandbookFsInteractionZone），勿用本函数替代。
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

const CSS_VAR_FS_W = '--fs-w';
const CSS_VAR_FS_H = '--fs-h';

/**
 * 在 `document.documentElement` 上写入 `--fs-w` / `--fs-h`（像素），与 `window.innerWidth/Height`
 * 同步，并在 **resize** 与 **visualViewport** resize/scroll 时重新采样，避免「只在挂载时算一次」冻结。
 *
 * 全屏关闭时务必调用返回的 `revoke()` 移除监听与变量。
 */
export function mountZeissFullscreenDomVars(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }
  const root = document.documentElement;

  const apply = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 0) root.style.setProperty(CSS_VAR_FS_W, `${w}px`);
    if (h > 0) root.style.setProperty(CSS_VAR_FS_H, `${h}px`);
  };

  apply();

  window.addEventListener('resize', apply);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);

  return () => {
    window.removeEventListener('resize', apply);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    root.style.removeProperty(CSS_VAR_FS_W);
    root.style.removeProperty(CSS_VAR_FS_H);
  };
}
