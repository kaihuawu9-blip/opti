/**
 * 无 React 上下文时的整页跳转（如新窗口、外链脚本）。
 * 侧栏与页内导航请优先用 {@link useAppNavigate} 以按需加载路由 chunk。
 */
export function hardNavigate(href: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = href.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return;

  if (window.location.protocol === 'app:') {
    window.location.assign(`app://index.html/${trimmed}/`);
    return;
  }

  window.location.assign(`/${trimmed}/`);
}

/** @deprecated 使用 useAppNavigate() 实现点击后懒加载路由 */
export function appNavigate(href: string): void {
  hardNavigate(href);
}
