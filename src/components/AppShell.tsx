'use client';

import dynamic from 'next/dynamic';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { toChineseErrorMessage } from '@/lib/userMessages';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/components/AuthProvider';
import { useDeviceLayout } from '@/contexts/DeviceLayoutContext';
import { roleNameMap } from '@/lib/permissions';
import { getDefaultUpdateManifestUrl } from '@/lib/optiAiPublic';
import { APP_NAME } from '@/lib/constants';
import { APP_VERSION } from '@/lib/appVersion';
import { unregisterServiceWorkersAndCaches } from '@/lib/clearSiteCaches';
import { StandardLayout } from '@/components/layout/StandardLayout';
import { TabletAuxDrawer } from '@/components/layout/TabletAuxDrawer';
import { PanelLeftClose } from 'lucide-react';

/** 独立 chunk：framer-motion 仅在此子包内，避免与路由大页同步争用 */
const OptiBotLazy = dynamic(() => import('@/components/magic/OptiBot'), {
  ssr: false,
  loading: () => (
    <div
      className="pointer-events-none flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-100 shadow-sm"
      aria-hidden
    >
      <span className="h-5 w-5 animate-pulse rounded-full bg-slate-300" />
    </div>
  ),
});

/** 三槽位先稳定绘制后，再在 idle 窗口挂载小精灵，避免与首屏脚本解析“撞车” */
function DeferredOptiBot({ userTag, className }: { userTag: string; className: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let idleHandle = 0;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const kick = () => setReady(true);
    if ('requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(kick, { timeout: 2200 });
    } else {
      timeoutHandle = window.setTimeout(kick, 120);
    }
    return () => {
      if (idleHandle !== 0 && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);
  if (!ready) {
    return (
      <div className={`${className} pointer-events-none flex items-center justify-center`} aria-hidden>
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-100 shadow-sm">
          <span className="h-5 w-5 animate-pulse rounded-full bg-slate-300" />
        </div>
      </div>
    );
  }
  return <OptiBotLazy userTag={userTag} className={className} />;
}

const NAV_COLLAPSED_STORAGE_KEY = 'app-nav-collapsed-v1';

/** 左滑超过该距离（手指位移，未乘阻尼）松手后关闭侧栏 */
const SIDEBAR_PAN_CLOSE_RAW_PX = 50;
/** 收起状态下从左缘向右滑超过该距离则展开 */
const SIDEBAR_EDGE_OPEN_RAW_PX = 84;
/** 跟手位移阻尼（越小越“重”） */
const SIDEBAR_PAN_DAMP = 0.58;
/** 超过侧栏宽度后的橡皮筋比例 */
const SIDEBAR_PAN_RUBBER = 0.28;

function dampedSidebarTranslateX(rawLeftPx: number, widthPx: number): number {
  const linear = rawLeftPx * SIDEBAR_PAN_DAMP;
  if (linear <= widthPx) return -linear;
  const over = linear - widthPx;
  return -(widthPx + over * SIDEBAR_PAN_RUBBER);
}

function NavRevealButton({
  variant,
  onExpand,
}: {
  variant: 'sidebar' | 'bossDock';
  onExpand: () => void;
}) {
  if (variant === 'bossDock') {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-[55] flex h-14 w-14 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-white shadow-lg hover:bg-gray-800 active:bg-gray-700 touch-manipulation"
        title="显示底部导航"
        aria-label="显示底部导航"
      >
        <span className="text-xs font-semibold leading-tight text-center px-1">菜单</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onExpand}
      className="fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-xl border border-l-0 border-gray-700 bg-gray-900 px-2 py-4 text-xs font-semibold text-white shadow-lg hover:bg-gray-800 active:bg-gray-700 touch-manipulation"
      style={{ writingMode: 'vertical-rl' }}
      title="显示侧栏菜单"
      aria-label="显示侧栏菜单"
    >
      菜单
    </button>
  );
}

function RouteModuleFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-gray-500 px-4">
      <div
        className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-blue-600 animate-spin"
        aria-hidden
      />
      <p className="text-sm text-center">加载模块中…</p>
      {slow ? (
        <div className="text-xs text-center text-gray-400 max-w-sm space-y-2">
          <p>若长时间停留在此，多半是脚本资源未加载完成或浏览器缓存了旧版本。</p>
          <button
            type="button"
            className="text-blue-600 underline"
            onClick={() => window.location.reload()}
          >
            点击刷新页面
          </button>
          <p className="text-[11px]">也可试 Ctrl+F5 强制刷新，或在开发者工具中清除本站缓存。</p>
        </div>
      ) : null}
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      window.alert('请输入账号和密码');
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const timeoutTask = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('登录请求超时，请检查网络或本地鉴权服务')), 12000);
      });
      const loginTaskLocal = fetch('/api/local-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe,
        }),
      });
      const loginResp = (await Promise.race([loginTaskLocal, timeoutTask])) as Response;
      const loginData = (await loginResp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!loginResp.ok || !loginData.ok) {
        window.alert('登录失败：' + toChineseErrorMessage(loginData.error || '账号或密码错误'));
        return;
      }
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert('登录失败：' + toChineseErrorMessage(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="w-full min-h-[100dvh] bg-gray-50 px-4 py-6 sm:px-6 sm:py-8"
      style={{ minHeight: '100dvh', background: '#f9fafb' }}
    >
      <div
        className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md items-center justify-center sm:min-h-[calc(100dvh-4rem)]"
        style={{ minHeight: 'calc(100dvh - 3rem)', maxWidth: 460 }}
      >
        <div
          className="w-full rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          style={{
            width: '100%',
            borderRadius: 16,
            border: '1px solid #e5e7eb',
            background: '#ffffff',
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <h1 className="mb-1 text-2xl font-bold text-gray-800">{APP_NAME}</h1>
          <p className="mb-6 text-sm text-gray-500">员工登录</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleLogin();
            }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              inputMode="email"
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-base"
              style={{ height: 44, width: '100%', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 10, padding: '0 12px' }}
              placeholder="账号（邮箱）"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-base"
              style={{ height: 44, width: '100%', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 10, padding: '0 12px' }}
              placeholder="密码"
            />
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              记住我 365 天（受信设备）
            </label>
            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              style={{ height: 44, width: '100%', borderRadius: 10, background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 600 }}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pathnameNorm = (pathname || '').replace(/\/+$/, '') || '/';
  const { loading, checked, session, profile } = useAuth();
  const { isBoss, isStaff } = useDeviceLayout();
  const [updateInfo, setUpdateInfo] = useState<{
    latestVersion: string;
    notes?: string;
    downloadUrl?: string;
    force?: boolean;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  /** 与 Tailwind `xl` 一致：&lt;1280px 为平板收银壳层 */
  const [viewportBelowXl, setViewportBelowXl] = useState(false);
  const [tabletAuxOpen, setTabletAuxOpen] = useState(false);
  const [visualViewportHeight, setVisualViewportHeight] = useState<number | null>(null);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  /** 侧栏 translateX（≤0），0 为完全展开 */
  const [sidebarTx, setSidebarTx] = useState(0);
  /** 拖动中关闭 transition，松手后过渡动画 */
  const [sidebarPanning, setSidebarPanning] = useState(false);
  /** 正在播放到完全移出后，在 transitionend 里真正收起 */
  const [sidebarClosingAnim, setSidebarClosingAnim] = useState(false);
  const sidebarPanRef = useRef<{
    pointerId: number;
    x0: number;
    y0: number;
    axis: 'h-close' | 'v' | null;
    captured: boolean;
  } | null>(null);
  const edgeOpenPanRef = useRef<{
    pointerId: number;
    x0: number;
    y0: number;
    axis: 'h-open' | 'v' | null;
  } | null>(null);

  useEffect(() => {
    try {
      setNavCollapsed(window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === '1');
    } catch {
      // ignore
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1279px)');
    const apply = () => setViewportBelowXl(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setTabletAuxOpen(false);
  }, [pathnameNorm]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setVisualViewportHeight(Math.round(vv.height));
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  const persistNavCollapsed = useCallback((collapsed: boolean) => {
    setNavCollapsed(collapsed);
    try {
      if (collapsed) window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, '1');
      else window.localStorage.removeItem(NAV_COLLAPSED_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!navCollapsed) {
      setSidebarTx(0);
      setSidebarPanning(false);
      setSidebarClosingAnim(false);
      sidebarPanRef.current = null;
    }
  }, [navCollapsed]);

  const finishSidebarCollapseAfterAnim = useCallback(() => {
    setSidebarClosingAnim(false);
    setSidebarTx(0);
    setSidebarPanning(false);
    persistNavCollapsed(true);
  }, [persistNavCollapsed]);

  const onSidebarPointerDownCapture = useCallback((e: React.PointerEvent) => {
    if (isBoss || navCollapsed) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sidebarPanRef.current = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      axis: null,
      captured: false,
    };
    setSidebarClosingAnim(false);
  }, [isBoss, navCollapsed]);

  const onSidebarPointerMoveCapture = useCallback(
    (e: React.PointerEvent) => {
      const s = sidebarPanRef.current;
      if (!s || s.pointerId !== e.pointerId || isBoss || navCollapsed) return;
      const dx = e.clientX - s.x0;
      const dy = e.clientY - s.y0;
      if (s.axis === null) {
        if (Math.hypot(dx, dy) < 10) return;
        const closingLeft = dx <= -6 && -dx > Math.abs(dy) * 0.35;
        const scrolling = Math.abs(dy) >= Math.abs(dx) * 1.05;
        if (scrolling && !closingLeft) {
          s.axis = 'v';
          return;
        }
        if (closingLeft) s.axis = 'h-close';
        else s.axis = 'v';
      }
      if (s.axis !== 'h-close') return;
      if (!s.captured && sidebarShellRef.current) {
        try {
          sidebarShellRef.current.setPointerCapture(e.pointerId);
          s.captured = true;
        } catch {
          /* ignore */
        }
      }
      const w = sidebarShellRef.current?.getBoundingClientRect().width ?? 280;
      const rawLeft = Math.max(0, s.x0 - e.clientX);
      setSidebarPanning(true);
      setSidebarTx(dampedSidebarTranslateX(rawLeft, w));
    },
    [isBoss, navCollapsed],
  );

  const onSidebarPointerUpCapture = useCallback(
    (e: React.PointerEvent) => {
      const s = sidebarPanRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const axis = s.axis;
      const x0 = s.x0;
      const captured = s.captured;
      sidebarPanRef.current = null;
      if (captured && sidebarShellRef.current) {
        try {
          sidebarShellRef.current.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (isBoss || navCollapsed) return;
      const w = sidebarShellRef.current?.getBoundingClientRect().width ?? 280;
      const rawLeft = Math.max(0, x0 - e.clientX);
      if (axis === 'h-close' && rawLeft >= SIDEBAR_PAN_CLOSE_RAW_PX) {
        setSidebarPanning(false);
        setSidebarTx(-w);
        setSidebarClosingAnim(true);
      } else {
        setSidebarPanning(false);
        setSidebarTx(0);
      }
    },
    [isBoss, navCollapsed],
  );

  const onSidebarTransitionEnd = useCallback(
    (ev: React.TransitionEvent<HTMLDivElement>) => {
      if (ev.propertyName !== 'transform' || !sidebarClosingAnim) return;
      finishSidebarCollapseAfterAnim();
    },
    [sidebarClosingAnim, finishSidebarCollapseAfterAnim],
  );

  const onEdgeOpenPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!navCollapsed) return;
      if (isBoss && !viewportBelowXl) return;
      if (e.pointerType === 'mouse') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.clientX > 12) return;
      edgeOpenPanRef.current = {
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        axis: null,
      };
    },
    [navCollapsed, isBoss, viewportBelowXl],
  );

  const onEdgeOpenPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = edgeOpenPanRef.current;
      if (!s || s.pointerId !== e.pointerId || !navCollapsed) return;
      if (isBoss && !viewportBelowXl) return;
      const dx = e.clientX - s.x0;
      const dy = e.clientY - s.y0;
      if (s.axis === null) {
        if (Math.hypot(dx, dy) < 10) return;
        if (dx >= 12 && dx > Math.abs(dy) * 0.85) s.axis = 'h-open';
        else if (Math.abs(dy) > Math.abs(dx) * 1.05) s.axis = 'v';
        else s.axis = 'v';
      }
      if (s.axis === 'h-open' && dx >= SIDEBAR_EDGE_OPEN_RAW_PX) {
        edgeOpenPanRef.current = null;
        persistNavCollapsed(false);
      }
    },
    [navCollapsed, isBoss, viewportBelowXl, persistNavCollapsed],
  );

  const onEdgeOpenPointerUp = useCallback((e: React.PointerEvent) => {
    const s = edgeOpenPanRef.current;
    if (s && s.pointerId === e.pointerId) edgeOpenPanRef.current = null;
  }, []);

  /** 必须放在任意 early return 之前，否则会触发 React #310（Hooks 数量变化）。 */
  const collapseSidebarImmediate = useCallback(() => {
    setSidebarClosingAnim(false);
    setSidebarPanning(false);
    setSidebarTx(0);
    sidebarPanRef.current = null;
    persistNavCollapsed(true);
  }, [persistNavCollapsed]);

  const expandSidebarFromUi = useCallback(() => {
    persistNavCollapsed(false);
  }, [persistNavCollapsed]);

  const currentVersion = APP_VERSION;
  const updateManifestExplicit = (process.env.NEXT_PUBLIC_UPDATE_MANIFEST_URL || '').trim();
  const updateManifestUrl =
    updateManifestExplicit === 'off' || updateManifestExplicit === 'false'
      ? ''
      : updateManifestExplicit || getDefaultUpdateManifestUrl();

  const compareSemver = useMemo(
    () => (a: string, b: string) => {
      const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
      const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i += 1) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
      }
      return 0;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    const runningInElectron = typeof window !== 'undefined' && window.location.protocol === 'app:';
    if (!runningInElectron || !updateManifestUrl) return;
    setCheckingUpdate(true);
    (async () => {
      try {
        const resp = await fetch(updateManifestUrl, { cache: 'no-store' });
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          latestVersion?: string;
          notes?: string;
          downloadUrl?: string;
          force?: boolean;
        };
        const latestVersion = (data.latestVersion || '').trim();
        if (!latestVersion) return;
        if (compareSemver(latestVersion, currentVersion) > 0 && mounted) {
          setUpdateInfo({
            latestVersion,
            notes: data.notes,
            downloadUrl: data.downloadUrl,
            force: Boolean(data.force),
          });
        }
      } catch {
        // ignore update check errors
      } finally {
        if (mounted) setCheckingUpdate(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [updateManifestUrl, compareSemver, currentVersion]);

  useEffect(() => {
    if (!session?.user?.id) {
      setDeviceCount(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const resp = await fetch('/api/local-auth/sessions', { method: 'GET', cache: 'no-store' });
        const data = (await resp.json()) as { ok?: boolean; sessions?: Array<unknown> };
        if (!cancelled && data.ok && Array.isArray(data.sessions)) {
          setDeviceCount(data.sessions.length);
        }
      } catch {
        if (!cancelled) setDeviceCount(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const optiBotUserTag = useMemo(() => {
    const name = profile?.full_name?.trim();
    if (name) return name;
    if (session?.user?.email) return session.user.email;
    return 'staff-user';
  }, [profile?.full_name, session?.user?.email]);

  const forceLogoutOtherDevices = async () => {
    if (deviceLoading) return;
    setDeviceLoading(true);
    try {
      await fetch('/api/local-auth/sessions?mode=others', {
        method: 'DELETE',
      });
      window.alert('已强制下线其他设备');
      setDeviceCount(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert('下线其他设备失败：' + toChineseErrorMessage(msg));
    } finally {
      setDeviceLoading(false);
    }
  };

  if (loading || !checked) {
    return (
      <div
        id="opti-auth-loading-shell"
        className="h-screen flex flex-col items-center justify-center gap-2 px-4 text-gray-600"
      >
        <span>加载中...</span>
        <span className="text-xs text-gray-400 text-center max-w-sm">
          若超过约 20 秒仍不变，页面会出现「重新加载」等按钮
        </span>
        <button
          type="button"
          className="mt-1 text-xs text-teal-700 underline decoration-teal-600/50 hover:text-teal-900"
          onClick={() => {
            void (async () => {
              await unregisterServiceWorkersAndCaches();
              window.location.reload();
            })();
          }}
        >
          清除站点缓存并重试
        </button>
        <p className="text-[11px] text-gray-400 text-center max-w-xs leading-snug">
          仅无痕能打开时，多半是旧 Service Worker 或脚本缓存；点此会清 Cache Storage 并注销本站 SW 后刷新（一般不删除本机 localStorage 里的草稿等）。
        </p>
      </div>
    );
  }
  if (!session) return <LoginScreen />;
  if (!profile) {
    return (
      <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900 space-y-4">
          <div>
            当前账号未绑定员工权限。请管理员在 <code className="text-xs">user_profiles</code> 表中配置{' '}
            <code className="text-xs">role</code> 与 <code className="text-xs">store_id</code> 后重新登录。绑定前无法使用收银台、库存等模块。
          </div>
          <div className="text-xs text-amber-800/90 break-all">当前账号：{session.user.email}</div>
          <button
            type="button"
            onClick={() => {
              void fetch('/api/local-auth/logout', { method: 'POST' }).finally(() => {
                window.location.reload();
              });
            }}
            className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          >
            退出登录并切换账号
          </button>
        </div>
      </div>
    );
  }

  const nonBossLayout = isStaff ? 'staff' : 'admin';
  /** 店员/管理：视口 &lt;1280px 二列窄轨 + 主区；右侧栏收进账户抽屉 */
  const staffCompactShell = viewportBelowXl && !isBoss;
  /** 老板：视口 &lt;1280px 与店员同一套平板壳层（左轨 + 主区 + 账户抽屉） */
  const bossCompactShell = viewportBelowXl && isBoss;
  /** 仅传统老板底栏模式需要为主区预留底部安全区内边距 */
  const bossBottomDockMainPadding = isBoss && !navCollapsed && !bossCompactShell;
  const shellGridCols = staffCompactShell
    ? `${navCollapsed ? 'max-xl:grid-cols-[minmax(0,1fr)]' : 'max-xl:grid-cols-[clamp(2.75rem,4.8vw,3.5rem)_minmax(0,1fr)]'} ${
        navCollapsed
          ? 'xl:grid-cols-[0_minmax(0,1fr)_minmax(16rem,19rem)]'
          : 'xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(16rem,19rem)]'
      }`
    : navCollapsed
      ? 'xl:grid-cols-[0_minmax(0,1fr)_minmax(16rem,19rem)]'
      : 'xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(16rem,19rem)]';
  const compactViewportStyle =
    (staffCompactShell || bossCompactShell) && visualViewportHeight
      ? { height: `${visualViewportHeight}px`, maxHeight: `${visualViewportHeight}px` }
      : undefined;

  const mainPanelContent = (
    <>
      {updateInfo && (
        <div
          className={`${isBoss ? 'mx-4' : 'mx-8'} mt-4 rounded-xl border p-3 ${
            updateInfo.force ? 'border-red-200 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className={`${isBoss ? 'text-base' : 'text-sm'}`}>
              发现新版本 <strong>{updateInfo.latestVersion}</strong>（当前 {currentVersion}）
              {updateInfo.notes ? `：${updateInfo.notes}` : ''}
            </div>
            <div className="flex items-center gap-2">
              {!updateInfo.force && (
                <button
                  type="button"
                  onClick={() => setUpdateInfo(null)}
                  className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-white touch-manipulation"
                >
                  稍后再说
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const target = updateInfo.downloadUrl || '';
                  if (!target) {
                    window.alert('未配置下载链接，请联系管理员。');
                    return;
                  }
                  if (window.electronApp?.openExternal) {
                    void window.electronApp.openExternal(target);
                  } else {
                    window.open(target, '_blank');
                  }
                }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 touch-manipulation"
              >
                立即更新
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className={`${
          isBoss ? 'px-4 py-3 max-xl:px-3 max-xl:py-2.5' : 'px-8 py-4 max-xl:px-4 max-xl:py-3'
        } border-b border-gray-200 bg-white flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4`}
      >
        {!isBoss && !navCollapsed ? (
          <button
            type="button"
            onClick={collapseSidebarImmediate}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 shrink-0 touch-manipulation"
            title="隐藏左侧菜单，腾出主内容区"
          >
            <PanelLeftClose className="w-4 h-4 shrink-0" aria-hidden />
            隐藏侧栏
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-2 sm:items-center sm:justify-end sm:gap-3">
          <div
            className={`text-gray-600 ${isBoss ? 'text-base leading-snug flex flex-wrap gap-x-2 gap-y-1' : 'text-sm'}`}
          >
            <span className={`font-medium text-gray-800 ${isBoss ? 'text-lg' : ''}`}>
              {profile.full_name || session.user.email}
            </span>
            {!isBoss && <span className="mx-2 text-gray-300">|</span>}
            {isBoss && <span className="text-gray-300">·</span>}
            <span>{roleNameMap[profile.role]}</span>
            {!isBoss && (
              <>
                <span className="mx-2 text-gray-300">|</span>
                <span>{profile.store_id ? `门店ID:${profile.store_id}` : '未绑定门店'}</span>
                <span className="mx-2 text-gray-300">|</span>
                <span>{checkingUpdate ? '检查更新中…' : `版本 ${currentVersion}`}</span>
              </>
            )}
            {isBoss && (
              <span className="w-full text-sm text-gray-500">
                {checkingUpdate ? '检查更新中…' : `版本 ${currentVersion}`}
                {profile.store_id ? ` · 门店 ${profile.store_id}` : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void forceLogoutOtherDevices()}
            disabled={deviceLoading}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-orange-200 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-60 sm:flex-none touch-manipulation"
          >
            {deviceLoading ? '处理中...' : '下线其他设备'}
            {deviceCount != null ? `（当前 ${deviceCount} 台）` : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              void fetch('/api/local-auth/logout', { method: 'POST' }).finally(() => {
                window.location.reload();
              });
            }}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none touch-manipulation"
          >
            退出登录
          </button>
        </div>
      </div>
      <div
        className={
          pathnameNorm === '/brand'
            ? 'p-0 min-h-full'
            : `${isBoss ? 'p-4 max-w-lg mx-auto w-full max-xl:p-3' : 'p-8 max-xl:p-[clamp(0.85rem,1.9vw,1.45rem)]'} ${pathnameNorm === '/dashboard' ? 'bg-[#f4f7fb] min-h-full' : ''}`
        }
      >
        <div className="min-h-0 max-w-full">
          <Suspense fallback={<RouteModuleFallback />}>{children}</Suspense>
        </div>
      </div>
    </>
  );

  if (isBoss) {
    const bossGrid = bossCompactShell;
    return (
      <div
        className={
          bossGrid
            ? `grid h-[100dvh] max-h-[100dvh] min-h-0 min-w-0 overflow-x-hidden bg-gray-50 text-gray-900 ${
                navCollapsed ? 'grid-cols-1' : 'grid-cols-[clamp(2.75rem,4.8vw,3.5rem)_minmax(0,1fr)]'
              }`
            : 'flex h-full min-h-0 min-w-0 overflow-x-hidden bg-gray-50 text-gray-900'
        }
        style={compactViewportStyle}
      >
        {bossGrid && navCollapsed ? (
          <div
            className="pointer-events-auto fixed bottom-0 left-0 top-0 z-[41] w-3 max-w-[12px] touch-none"
            style={{ touchAction: 'none' }}
            aria-hidden
            title="从屏幕左缘向右滑可打开侧栏"
            onPointerDown={onEdgeOpenPointerDown}
            onPointerMove={onEdgeOpenPointerMove}
            onPointerUp={onEdgeOpenPointerUp}
            onPointerCancel={onEdgeOpenPointerUp}
          />
        ) : null}
        {!navCollapsed ? (
          <aside
            className={
              bossGrid
                ? 'h-full min-h-0 w-full max-w-[clamp(2.75rem,4.8vw,3.5rem)] shrink-0 overflow-y-auto overflow-x-hidden'
                : 'contents'
            }
          >
            <Sidebar
              onRequestNavCollapse={() => persistNavCollapsed(true)}
              bossTabletRail={bossGrid}
            />
          </aside>
        ) : null}
        {navCollapsed && bossGrid ? (
          <NavRevealButton variant="sidebar" onExpand={expandSidebarFromUi} />
        ) : null}
        {navCollapsed && !bossGrid ? <NavRevealButton variant="bossDock" onExpand={expandSidebarFromUi} /> : null}
        <main
          className={`relative z-0 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 touch-pan-y overscroll-y-contain [-webkit-overflow-scrolling:touch] print:h-auto print:max-h-none print:min-h-0 print:overflow-visible print:overscroll-auto ${
            bossBottomDockMainPadding ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : ''
          } ${bossGrid ? 'h-full max-h-full min-h-0 max-xl:overscroll-behavior-y-contain' : 'h-screen'}`}
          data-layout="boss"
        >
          {mainPanelContent}
        </main>
        {bossGrid ? (
          <>
            <DeferredOptiBot
              userTag={optiBotUserTag}
              className="fixed z-[56] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(10.75rem,calc(6.5rem+env(safe-area-inset-bottom)))]"
            />
            <TabletAuxDrawer
              navMode="staff-sidebar"
              open={tabletAuxOpen}
              onOpenChange={setTabletAuxOpen}
              profileTitle={profile.full_name || session.user.email}
              profileSub={`${roleNameMap[profile.role]}${profile.store_id ? ` · 门店 ${profile.store_id}` : ''}`}
              versionLine={checkingUpdate ? '检查更新中…' : `版本 ${currentVersion}`}
              onCollapseNav={() => {
                setTabletAuxOpen(false);
                persistNavCollapsed(true);
              }}
              onForceLogoutOthers={forceLogoutOtherDevices}
              onLogout={() => {
                void fetch('/api/local-auth/logout', { method: 'POST' }).finally(() => {
                  window.location.reload();
                });
              }}
              deviceLoading={deviceLoading}
              deviceCount={deviceCount}
            />
          </>
        ) : null}
      </div>
    );
  }

  return (
      <div className="relative h-full min-h-0 min-w-0 overflow-x-hidden bg-gray-50 text-gray-900" style={compactViewportStyle}>
      {navCollapsed ? (
        <div
          className="pointer-events-auto fixed bottom-0 left-0 top-0 z-[41] w-3 max-w-[12px] touch-none"
          style={{ touchAction: 'none' }}
          aria-hidden
          title="从屏幕左缘向右滑可打开侧栏"
          onPointerDown={onEdgeOpenPointerDown}
          onPointerMove={onEdgeOpenPointerMove}
          onPointerUp={onEdgeOpenPointerUp}
          onPointerCancel={onEdgeOpenPointerUp}
        />
      ) : null}
      {navCollapsed ? (
        <NavRevealButton variant="sidebar" onExpand={expandSidebarFromUi} />
      ) : null}
      <StandardLayout
        className={`h-full min-h-0 min-w-0 ${shellGridCols} print:h-auto print:max-h-none print:min-h-0 print:overflow-visible ${
          staffCompactShell ? 'max-xl:h-[100dvh] max-xl:max-h-[100dvh] max-xl:min-h-0' : ''
        }`}
      >
        <StandardLayout.LeftSlot
          className={`h-full overflow-y-auto overflow-x-hidden pr-0 ${staffCompactShell ? 'max-xl:w-[clamp(2.75rem,4.8vw,3.5rem)] max-xl:min-w-0 max-xl:max-w-[clamp(2.75rem,4.8vw,3.5rem)] max-xl:shrink-0' : ''}`}
        >
          {!navCollapsed ? (
            <div
              ref={sidebarShellRef}
              className="relative z-20 h-full shrink-0 will-change-transform"
              style={{
                transform: `translateX(${sidebarTx}px)`,
                transition: sidebarPanning ? 'none' : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
              }}
              onPointerDownCapture={onSidebarPointerDownCapture}
              onPointerMoveCapture={onSidebarPointerMoveCapture}
              onPointerUpCapture={onSidebarPointerUpCapture}
              onPointerCancelCapture={onSidebarPointerUpCapture}
              onTransitionEnd={onSidebarTransitionEnd}
            >
              <Sidebar
                onRequestNavCollapse={collapseSidebarImmediate}
                tabletStaffRail={staffCompactShell}
              />
            </div>
          ) : null}
        </StandardLayout.LeftSlot>
        <StandardLayout.MiddleSlot
          className={`h-full overflow-y-auto overflow-x-hidden px-0 print:h-auto print:max-h-none print:min-h-0 print:overflow-visible ${staffCompactShell ? 'max-xl:min-w-0 max-xl:flex-1 max-xl:min-h-0' : ''}`}
        >
          <main
            className={`relative z-0 min-h-0 min-w-0 h-full overflow-y-auto overflow-x-hidden bg-gray-50 touch-pan-y overscroll-y-contain [-webkit-overflow-scrolling:touch] print:h-auto print:max-h-none print:min-h-0 print:overflow-visible print:overscroll-auto ${
              staffCompactShell ? 'max-xl:overscroll-behavior-y-contain' : ''
            }`}
            data-layout={nonBossLayout}
          >
            {mainPanelContent}
          </main>
        </StandardLayout.MiddleSlot>
        <StandardLayout.RightSlot className={`h-full ${staffCompactShell ? 'hidden xl:block' : ''}`}>
          <div className="relative grid h-full min-h-0 grid-rows-[auto_1fr_auto] border-l border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-4 max-xl:px-3 max-xl:py-3 space-y-2">
              <div className="text-xs text-gray-500">当前账号</div>
              <div className="text-sm font-semibold text-gray-800 truncate">{profile.full_name || session.user.email}</div>
              <div className="text-xs text-gray-600">
                {roleNameMap[profile.role]}
                {profile.store_id ? ` · 门店 ${profile.store_id}` : ''}
              </div>
              <div className="text-[11px] text-gray-500">{checkingUpdate ? '检查更新中…' : `版本 ${currentVersion}`}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 space-y-3 [-webkit-overflow-scrolling:touch] touch-pan-y">
              <button
                type="button"
                onClick={collapseSidebarImmediate}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                隐藏左侧菜单
              </button>
              <button
                type="button"
                onClick={() => void forceLogoutOtherDevices()}
                disabled={deviceLoading}
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-60"
              >
                {deviceLoading ? '处理中...' : '下线其他设备'}
                {deviceCount != null ? `（当前 ${deviceCount} 台）` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  void fetch('/api/local-auth/logout', { method: 'POST' }).finally(() => {
                    window.location.reload();
                  });
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                退出登录
              </button>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                三段式布局已启用：左侧导航 / 中间工作区（独立滚动） / 右侧工具栏。
              </div>
            </div>
            <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-[11px] leading-relaxed text-slate-600 max-xl:px-3">
              操作区为独立滚动，平板端避免功能被截断。
            </div>
            {!staffCompactShell ? (
              <DeferredOptiBot
                userTag={optiBotUserTag}
                className="fixed z-[53] right-[max(0.75rem,env(safe-area-inset-right))] top-[max(5.75rem,env(safe-area-inset-top))]"
              />
            ) : null}
          </div>
        </StandardLayout.RightSlot>
      </StandardLayout>
      {staffCompactShell ? (
        <>
          <DeferredOptiBot
            userTag={optiBotUserTag}
            className="fixed z-[56] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(10.75rem,calc(6.5rem+env(safe-area-inset-bottom)))]"
          />
          <TabletAuxDrawer
            navMode="staff-sidebar"
            open={tabletAuxOpen}
            onOpenChange={setTabletAuxOpen}
            profileTitle={profile.full_name || session.user.email}
            profileSub={`${roleNameMap[profile.role]}${profile.store_id ? ` · 门店 ${profile.store_id}` : ''}`}
            versionLine={checkingUpdate ? '检查更新中…' : `版本 ${currentVersion}`}
            onCollapseNav={() => {
              setTabletAuxOpen(false);
              collapseSidebarImmediate();
            }}
            onForceLogoutOthers={forceLogoutOtherDevices}
            onLogout={() => {
              void fetch('/api/local-auth/logout', { method: 'POST' }).finally(() => {
                window.location.reload();
              });
            }}
            deviceLoading={deviceLoading}
            deviceCount={deviceCount}
          />
        </>
      ) : null}
    </div>
  );
}

