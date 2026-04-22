'use client';

import { useRef } from 'react';
import { Bot, PanelLeftClose, UserRound, X } from 'lucide-react';
import { APP_VERSION } from '@/lib/appVersion';

export type TabletAuxDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileTitle: string;
  profileSub: string;
  versionLine: string;
  onCollapseNav: () => void;
  onForceLogoutOthers: () => void;
  onLogout: () => void;
  deviceLoading: boolean;
  deviceCount: number | null;
  /** 与当前壳层导航形态一致：店员侧栏 / 老板底栏 */
  navMode: 'staff-sidebar' | 'boss-dock';
};

/**
 * 视口 &lt;1280px（与 Tailwind `max-xl` 一致）：右侧系统栏收进「账户」底部抽屉，
 * 与左侧窄轨配合，把横向空间让给主操作区。小精灵由 AppShell 挂载的 OptiBot 悬浮球负责。
 */
export function TabletAuxDrawer({
  open,
  onOpenChange,
  profileTitle,
  profileSub,
  versionLine,
  onCollapseNav,
  onForceLogoutOthers,
  onLogout,
  deviceLoading,
  deviceCount,
  navMode,
}: TabletAuxDrawerProps) {
  const hideNavLabel =
    navMode === 'boss-dock' ? '隐藏底部导航栏（腾出主区域宽度）' : '隐藏左侧导航（腾出宽度）';
  const triggerPanRef = useRef<{ x: number; y: number; t: number } | null>(null);

  return (
    <>
      <button
        type="button"
        className="fixed z-[58] flex min-h-[44px] h-12 min-w-[3.25rem] items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3.5 text-xs font-bold text-slate-800 shadow-lg backdrop-blur-sm touch-manipulation xl:hidden"
        style={{
          left: 'max(0.75rem, env(safe-area-inset-left))',
          bottom: 'max(5.75rem, calc(0.75rem + env(safe-area-inset-bottom)))',
        }}
        aria-expanded={open}
        aria-controls="tablet-aux-drawer"
        onPointerDown={(e) => {
          triggerPanRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        }}
        onPointerUp={(e) => {
          const s = triggerPanRef.current;
          triggerPanRef.current = null;
          if (!s) return;
          const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
          const elapsed = performance.now() - s.t;
          // 仅短按点击触发，避免快速滑动结账时误触弹出。
          if (moved <= 10 && elapsed <= 450) onOpenChange(!open);
        }}
        onPointerCancel={() => {
          triggerPanRef.current = null;
        }}
      >
        <UserRound className="h-4 w-4 shrink-0" aria-hidden />
        账户
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[59] bg-black/45 backdrop-blur-[2px] xl:hidden"
          role="presentation"
          onClick={() => onOpenChange(false)}
        >
          <div
            id="tablet-aux-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="账户与系统"
            className="absolute inset-x-0 bottom-0 grid max-h-[min(88dvh,680px)] grid-rows-[auto_1fr] overflow-y-auto overflow-x-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl touch-manipulation"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">当前账号</p>
                <p className="truncate text-sm font-bold text-slate-900">{profileTitle}</p>
                <p className="truncate text-xs text-slate-600">{profileSub}</p>
                <p className="text-[11px] text-slate-400">{versionLine}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[min(70dvh,520px)] space-y-2 overflow-y-auto overscroll-y-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-sm active:bg-emerald-700"
                onClick={() => {
                  onOpenChange(false);
                  window.dispatchEvent(new CustomEvent('opti-bot:open'));
                }}
              >
                <Bot className="h-4 w-4 shrink-0" aria-hidden />
                打开小精灵
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onCollapseNav();
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
                {hideNavLabel}
              </button>

              <button
                type="button"
                onClick={() => void onForceLogoutOthers()}
                disabled={deviceLoading}
                className="w-full min-h-[44px] rounded-xl border border-orange-200 bg-orange-50/80 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-50 disabled:opacity-50"
              >
                {deviceLoading ? '处理中…' : '下线其他设备'}
                {deviceCount != null ? `（当前 ${deviceCount} 台）` : ''}
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onLogout();
                }}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                退出登录
              </button>

              <p className="text-center text-[10px] leading-relaxed text-slate-400">
                平板模式 · 断点 1280px · v{APP_VERSION}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
