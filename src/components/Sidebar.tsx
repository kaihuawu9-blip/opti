'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { usePathname } from 'next/navigation';
import {
  ShoppingCart,
  Package,
  BarChart3,
  LayoutDashboard,
  Search,
  Wrench,
  Store,
  Settings,
  Landmark,
  ChevronDown,
  Layers,
  Info,
  Sparkles,
  Menu,
  X,
  PanelLeftClose,
  Wallet,
  Library,
  Microscope,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useDeviceLayout } from '@/contexts/DeviceLayoutContext';
import { useAppNavigate } from '@/lib/useAppNavigate';
import { APP_NAME } from '@/lib/constants';
import { APP_VERSION } from '@/lib/appVersion';
import { CASHIER_OPEN_CHECKOUT_DRAWER_EVENT } from '@/lib/cashierCheckoutEvents';
import { compressImageFileToDataUrl } from '@/lib/compressImageClient';

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  visible: boolean;
};

const MENU_PREFS_KEY = 'sidebar-menu-prefs-v3';
const MENU_PREFS_LEGACY_V2 = 'sidebar-menu-prefs-v2';
const MENU_PREFS_LEGACY_V1 = 'sidebar-menu-prefs-v1';

const FINANCE_HREFS = ['/reports', '/reconciliation'] as const;

/** 老板版底部 Dock：极简看板 + 收银 + 库存 */
const BOSS_DOCK_HREFS = ['/dashboard', '/cashier', '/inventory'] as const;

/** 读 v3；从 v2/v1 迁移，并保证财务报表、财务对账默认显示在「财务管理」分组内 */
function loadSidebarMenuPrefs(): Record<string, boolean> {
  try {
    if (typeof window === 'undefined') return {};
    const v3 = window.localStorage.getItem(MENU_PREFS_KEY);
    if (v3) return JSON.parse(v3) as Record<string, boolean>;
    const v2 = window.localStorage.getItem(MENU_PREFS_LEGACY_V2);
    const v1 = window.localStorage.getItem(MENU_PREFS_LEGACY_V1);
    const raw = v2 || v1;
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      for (const h of FINANCE_HREFS) delete parsed[h];
      window.localStorage.setItem(MENU_PREFS_KEY, JSON.stringify(parsed));
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

type SidebarProps = {
  onRequestNavCollapse?: () => void;
  /**
   * 店员 / 管理：视口 &lt;1280px 平板壳层，左侧窄图标轨（约 56px）。
   */
  tabletStaffRail?: boolean;
  /** 老板：视口 &lt;1280px 时用左侧轨替代底部 Dock */
  bossTabletRail?: boolean;
};

const Sidebar = ({ onRequestNavCollapse, tabletStaffRail = false, bossTabletRail = false }: SidebarProps) => {
  const pathname = usePathname();
  const navigate = useAppNavigate();
  const { hasPermission, signOut } = useAuth();
  const { isBoss, isStaff, isAdmin } = useDeviceLayout();
  const [bossMoreOpen, setBossMoreOpen] = useState(false);
  const [showMenuSettings, setShowMenuSettings] = useState(false);
  const [showBrandSettings, setShowBrandSettings] = useState(false);
  const [appTitle, setAppTitle] = useState(() => {
    try {
      if (typeof window === 'undefined') return APP_NAME;
      return window.localStorage.getItem('app-brand-title-v1') || APP_NAME;
    } catch {
      return APP_NAME;
    }
  });
  const [appLogoDataUrl, setAppLogoDataUrl] = useState(() => {
    try {
      if (typeof window === 'undefined') return '';
      return window.localStorage.getItem('app-brand-logo-v1') || '';
    } catch {
      return '';
    }
  });
  const [menuPrefs, setMenuPrefs] = useState<Record<string, boolean>>(loadSidebarMenuPrefs);
  const [financeExpanded, setFinanceExpanded] = useState(() => {
    const p = pathname.replace(/\/+$/, '') || '/';
    return p.startsWith('/reports') || p.startsWith('/reconciliation');
  });
  /** 收银平板：侧栏图标轨内的「更多 / 财务」抽屉 */
  const [cashierRailSheet, setCashierRailSheet] = useState<'off' | 'finance' | 'more'>('off');

  const normalizedPath = (pathname.replace(/\/+$/, '') || '/') as string;
  const isCashierPage = normalizedPath === '/cashier';
  const openCashierCheckoutDrawer = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(CASHIER_OPEN_CHECKOUT_DRAWER_EVENT));
  };

  useEffect(() => {
    const p = pathname.replace(/\/+$/, '') || '/';
    if (p.startsWith('/reports') || p.startsWith('/reconciliation')) {
      setFinanceExpanded(true);
    }
  }, [pathname]);

  const mainNavItems = useMemo(
    (): NavItem[] => [
      { name: '工作台', href: '/dashboard', icon: LayoutDashboard, visible: true },
      { name: '收银台', href: '/cashier', icon: ShoppingCart, visible: hasPermission('cashier.view') },
      { name: '库存管理', href: '/inventory', icon: Package, visible: hasPermission('inventory.view') },
      { name: '套餐管理', href: '/packages', icon: Layers, visible: hasPermission('inventory.view') },
      { name: '客户查询', href: '/customers', icon: Search, visible: hasPermission('customers.view') },
      { name: '价格手册', href: '/catalog', icon: Library, visible: hasPermission('cashier.view') },
      { name: '光学实验室', href: '/lens-physics', icon: Microscope, visible: hasPermission('cashier.view') },
    ],
    [hasPermission],
  );

  const financeNavItems = useMemo(
    (): NavItem[] => [
      { name: '财务报表', href: '/reports', icon: BarChart3, visible: hasPermission('reports.view') },
      { name: '财务对账', href: '/reconciliation', icon: Landmark, visible: hasPermission('reports.view') },
    ],
    [hasPermission],
  );

  const otherNavItems = useMemo(
    (): NavItem[] => [
      { name: 'AI试戴', href: '/test/try-on', icon: Sparkles, visible: true },
      { name: '线上运营', href: '/online', icon: Store, visible: true },
      { name: '工具', href: '/tools', icon: Wrench, visible: true },
      { name: '关于', href: '/about', icon: Info, visible: true },
    ],
    [],
  );

  const navItems = useMemo(
    () => [...mainNavItems, ...financeNavItems, ...otherNavItems],
    [mainNavItems, financeNavItems, otherNavItems],
  );

  const visibleMainNav = useMemo(
    () =>
      mainNavItems.filter((x) => {
        if (!x.visible) return false;
        // 收银台：有权限则始终显示，避免在「菜单设置」里被误关后找不到入口
        if (x.href === '/cashier' && hasPermission('cashier.view')) return true;
        // 库存/套餐：窄屏老板版只有底部 Dock，若被菜单设置关掉会像「平板进不了库存」
        if ((x.href === '/inventory' || x.href === '/packages') && hasPermission('inventory.view')) return true;
        return menuPrefs[x.href] !== false;
      }),
    [mainNavItems, menuPrefs, hasPermission],
  );

  const visibleFinanceNav = useMemo(
    () => financeNavItems.filter((x) => x.visible && menuPrefs[x.href] !== false),
    [financeNavItems, menuPrefs],
  );

  const showFinanceSection = visibleFinanceNav.length > 0;

  const visibleOtherNav = useMemo(
    () => otherNavItems.filter((x) => x.visible && menuPrefs[x.href] !== false),
    [otherNavItems, menuPrefs],
  );

  /** 店员版平板：显示所有其他项 */
  const visibleOtherNavForSidebar = useMemo(() => {
    return visibleOtherNav;
  }, [visibleOtherNav]);

  const bossDockItems = useMemo(() => {
    if (!isBoss) return [];
    const dock = new Set<string>(BOSS_DOCK_HREFS);
    return visibleMainNav.filter((x) => dock.has(x.href));
  }, [isBoss, visibleMainNav]);

  /** 老板版「更多」里：非 Dock 的主菜单 + 其它入口（财务报表/对账在上方「财务管理」分组，不在此重复） */
  const bossMoreNavItems = useMemo(() => {
    if (!isBoss) return [];
    const dock = new Set<string>(BOSS_DOCK_HREFS);
    const out: NavItem[] = [];
    for (const x of visibleMainNav) {
      if (!dock.has(x.href)) out.push(x);
    }
    for (const x of visibleOtherNav) {
      out.push(x);
    }
    return out;
  }, [isBoss, visibleMainNav, visibleOtherNav]);

  /** 收银台不在此列表出现，避免被误关后「找不到收银」 */
  const configurableItems = useMemo(
    () => navItems.filter((x) => x.visible && x.href !== '/cashier'),
    [navItems],
  );

  const financeHrefSet = useMemo(() => new Set<string>(FINANCE_HREFS), []);

  const menuSettingsGroups = useMemo(() => {
    const storeCluster = [
      '/dashboard',
      '/inventory',
      '/packages',
      '/customers',
      '/catalog',
      '/lens-physics',
    ] as const;
    const store = configurableItems.filter((i) => storeCluster.includes(i.href as (typeof storeCluster)[number]));
    const finance = configurableItems.filter((i) => financeHrefSet.has(i.href));
    const rest = configurableItems.filter(
      (i) => !([...storeCluster, ...FINANCE_HREFS] as string[]).includes(i.href),
    );
    return [
      { title: '门店', items: store },
      { title: '财务管理', items: finance },
      { title: '其他', items: rest },
    ].filter((g) => g.items.length > 0);
  }, [configurableItems, financeHrefSet]);

  const toggleMenuItem = (href: string, checked: boolean) => {
    setMenuPrefs((prev) => {
      const next = { ...prev, [href]: checked };
      try {
        window.localStorage.setItem(MENU_PREFS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleNavigate = (href: string) => {
    navigate(href);
  };

  const saveBrandSettings = (title: string, logo: string) => {
    const nextTitle = title.trim() || APP_NAME;
    setAppTitle(nextTitle);
    setAppLogoDataUrl(logo);
    try {
      window.localStorage.setItem('app-brand-title-v1', nextTitle);
      if (logo) window.localStorage.setItem('app-brand-logo-v1', logo);
      else window.localStorage.removeItem('app-brand-logo-v1');
    } catch {
      // ignore
    }
    setShowBrandSettings(false);
  };

  if (isBoss) {
    return (
      <>
        <BossMobileShell
          layout={bossTabletRail ? 'leftRail' : 'bottomDock'}
          dockItems={bossDockItems}
          moreItems={bossMoreNavItems}
          pathname={pathname}
          onNavigate={handleNavigate}
          moreOpen={bossMoreOpen}
          onOpenMore={() => setBossMoreOpen(true)}
          onCloseMore={() => setBossMoreOpen(false)}
          appTitle={appTitle}
          appLogoDataUrl={appLogoDataUrl}
          onOpenBrand={() => setShowBrandSettings(true)}
          onOpenMenuSettings={() => setShowMenuSettings(true)}
          onRequestNavCollapse={onRequestNavCollapse}
          signOut={signOut}
        />
        {showMenuSettings && (
          <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-center justify-center">
            <div className="w-full max-w-md rounded-t-2xl xl:rounded-2xl border border-gray-200 bg-white p-4 xl:p-5 space-y-4 text-gray-800 max-h-[min(88dvh,760px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">菜单栏显示设置</h3>
                <button
                  type="button"
                  onClick={() => setShowMenuSettings(false)}
                  className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
              <div className="space-y-4 max-h-72 overflow-y-auto">
                {menuSettingsGroups.map((group) => (
                  <div key={group.title} className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 px-0.5">{group.title}</p>
                    <div className="space-y-2">
                      {group.items.map((item) => (
                        <label
                          key={item.href}
                          className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                        >
                          <span className="text-sm">{item.name}</span>
                          <input
                            type="checkbox"
                            checked={menuPrefs[item.href] !== false}
                            onChange={(e) => toggleMenuItem(item.href, e.target.checked)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {showBrandSettings && (
          <BrandSettingsModal
            initialTitle={appTitle}
            initialLogo={appLogoDataUrl}
            onCancel={() => setShowBrandSettings(false)}
            onSave={saveBrandSettings}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={`relative z-20 grid h-screen min-h-0 grid-rows-[auto_1fr_auto] overflow-y-auto overflow-x-hidden shrink-0 bg-gray-900 text-white border-r border-gray-800 ${
        tabletStaffRail ? 'w-[clamp(2.75rem,4.8vw,3.5rem)] min-w-[clamp(2.75rem,4.8vw,3.5rem)]' : isAdmin ? 'w-72' : 'w-64'
      }`}
    >
      <button
        type="button"
        onClick={() => setShowBrandSettings(true)}
        className={`flex shrink-0 items-center border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${
          tabletStaffRail ? 'h-14 justify-center px-0' : 'justify-center h-16'
        }`}
        title="点击修改图标和名称"
      >
        {appLogoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={appLogoDataUrl}
            alt="logo"
            className={`rounded object-cover border border-gray-700 ${tabletStaffRail ? 'h-9 w-9' : 'w-8 h-8 mr-2'}`}
          />
        ) : (
          <LayoutDashboard className={`text-blue-500 ${tabletStaffRail ? 'h-9 w-9' : 'w-8 h-8 mr-2'}`} />
        )}
        {tabletStaffRail ? <span className="sr-only">{appTitle}</span> : <span className="text-xl font-bold tracking-wider truncate max-w-[180px]">{appTitle}</span>}
      </button>
      <nav
        className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-manipulation [-webkit-overflow-scrolling:touch] ${
          tabletStaffRail ? 'px-1 py-2 space-y-1' : 'px-4 py-6 space-y-2'
        }`}
      >
        {visibleMainNav.map((item) => (
          <NavLinkButton
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={(href) => {
              setCashierRailSheet('off');
              handleNavigate(href);
            }}
            railMode={tabletStaffRail}
          />
        ))}

        {tabletStaffRail ? (
          <>
            {showFinanceSection ? (
              <button
                type="button"
                onClick={() => setCashierRailSheet((s) => (s === 'finance' ? 'off' : 'finance'))}
                className={`flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 transition-colors ${
                  cashierRailSheet === 'finance'
                    ? 'bg-amber-600/90 text-white'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-white'
                }`}
                title="财务管理"
              >
                <Landmark className="h-5 w-5 shrink-0" aria-hidden />
                <span className="sr-only">财务管理</span>
              </button>
            ) : null}
            {visibleOtherNavForSidebar.length > 0 ? (
              <button
                type="button"
                onClick={() => setCashierRailSheet((s) => (s === 'more' ? 'off' : 'more'))}
                className={`flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 transition-colors ${
                  cashierRailSheet === 'more'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-white'
                }`}
                title="更多功能"
              >
                <Menu className="h-5 w-5 shrink-0" aria-hidden />
                <span className="sr-only">更多功能</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            {showFinanceSection && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => setFinanceExpanded((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-gray-400 transition-colors hover:bg-gray-800/70 hover:text-gray-200"
                  aria-expanded={financeExpanded}
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                    <Landmark className="h-3.5 w-3.5 shrink-0 text-amber-500/90" aria-hidden />
                    财务管理
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${financeExpanded ? '' : '-rotate-90'}`}
                    aria-hidden
                  />
                </button>
                {financeExpanded ? (
                  <div className="mt-1 space-y-1 border-l border-amber-600/35 ml-3 pl-2">
                    {visibleFinanceNav.map((item) => (
                      <NavLinkButton
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        onNavigate={handleNavigate}
                        nested
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {visibleOtherNavForSidebar.length > 0 && (
              <div className={showFinanceSection || visibleMainNav.length > 0 ? 'pt-2' : ''}>
                {visibleOtherNavForSidebar.map((item) => (
                  <NavLinkButton key={item.href} item={item} pathname={pathname} onNavigate={handleNavigate} />
                ))}
              </div>
            )}
          </>
        )}
      </nav>
      <div className={`shrink-0 border-t border-gray-800 bg-gray-900 touch-manipulation ${tabletStaffRail ? 'p-1.5 space-y-1' : 'p-4 space-y-3'}`}>
        {tabletStaffRail ? (
          <>
            {isCashierPage ? (
              <button
                type="button"
                onClick={() => {
                  setCashierRailSheet('off');
                  openCashierCheckoutDrawer();
                }}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-600 py-2 text-white shadow-md shadow-emerald-900/30 transition hover:bg-emerald-500 active:scale-[0.98]"
                title="打开结算"
              >
                <Wallet className="h-5 w-5 shrink-0" aria-hidden />
                <span className="sr-only">打开结算</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setCashierRailSheet('off');
                setShowMenuSettings(true);
              }}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-200 hover:bg-gray-800"
              title="菜单设置"
            >
              <Settings className="h-5 w-5 shrink-0" aria-hidden />
              <span className="sr-only">菜单设置</span>
            </button>
            {onRequestNavCollapse ? (
              <button
                type="button"
                onClick={onRequestNavCollapse}
                className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-200 hover:bg-gray-800"
                title="隐藏侧栏"
              >
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only">隐藏侧栏</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-300 hover:bg-gray-800"
              title="退出登录"
            >
              <X className="h-4 w-4 shrink-0" aria-hidden />
              <span className="sr-only">退出登录</span>
            </button>
          </>
        ) : (
          <>
            {isCashierPage ? (
              <button
                type="button"
                onClick={openCashierCheckoutDrawer}
                className="inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-900/35 transition hover:bg-emerald-500 active:scale-[0.99]"
              >
                <Wallet className="h-5 w-5 shrink-0" aria-hidden />
                打开结算
              </button>
            ) : null}
            {onRequestNavCollapse ? (
              <button
                type="button"
                onClick={onRequestNavCollapse}
                className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800"
                title="隐藏侧栏，主区域全屏显示"
              >
                <PanelLeftClose className="w-4 h-4 shrink-0" aria-hidden />
                隐藏侧栏
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowMenuSettings(true)}
              className="w-full inline-flex min-h-[44px] items-center justify-center px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
            >
              <Settings className="w-4 h-4 mr-1.5" />
              菜单设置
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="w-full min-h-[44px] px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800"
            >
              退出登录（切换账号）
            </button>
          </>
        )}
        {!tabletStaffRail ? <div className="text-xs text-gray-500 text-center">v{APP_VERSION} © 2026</div> : null}
      </div>

      {tabletStaffRail && cashierRailSheet !== 'off' ? (
        <div
          className="fixed inset-0 z-[75] bg-black/50 flex items-end justify-center p-2 sm:p-6"
          role="presentation"
          onClick={() => setCashierRailSheet('off')}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-t-2xl border border-gray-700 bg-gray-900 p-4 shadow-2xl sm:rounded-2xl max-h-[min(86dvh,640px)] overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-bold text-white">
                {cashierRailSheet === 'finance' ? '财务管理' : '更多功能'}
              </p>
              <button
                type="button"
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-800"
                aria-label="关闭"
                onClick={() => setCashierRailSheet('off')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1">
              {cashierRailSheet === 'finance'
                ? visibleFinanceNav.map((item) => (
                    <NavLinkButton
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      onNavigate={(href) => {
                        setCashierRailSheet('off');
                        handleNavigate(href);
                      }}
                      nested
                    />
                  ))
                : visibleOtherNavForSidebar.map((item) => (
                    <NavLinkButton
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      onNavigate={(href) => {
                        setCashierRailSheet('off');
                        handleNavigate(href);
                      }}
                    />
                  ))}
            </div>
          </div>
        </div>
      ) : null}

      {showMenuSettings && (
        <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-t-2xl xl:rounded-2xl border border-gray-200 bg-white p-4 xl:p-5 space-y-4 text-gray-800 max-h-[min(88dvh,760px)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">菜单栏显示设置</h3>
              <button
                type="button"
                onClick={() => setShowMenuSettings(false)}
                className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {menuSettingsGroups.map((group) => (
                <div key={group.title} className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 px-0.5">{group.title}</p>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <label
                        key={item.href}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                      >
                        <span className="text-sm">{item.name}</span>
                        <input
                          type="checkbox"
                          checked={menuPrefs[item.href] !== false}
                          onChange={(e) => toggleMenuItem(item.href, e.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showBrandSettings && (
        <BrandSettingsModal
          initialTitle={appTitle}
          initialLogo={appLogoDataUrl}
          onCancel={() => setShowBrandSettings(false)}
          onSave={saveBrandSettings}
        />
      )}
    </div>
  );
};

function BrandSettingsModal({
  initialTitle,
  initialLogo,
  onCancel,
  onSave,
}: {
  initialTitle: string;
  initialLogo: string;
  onCancel: () => void;
  onSave: (title: string, logo: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [logo, setLogo] = useState(initialLogo);

  const handlePickLogo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.alert('请选择图片文件');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      window.alert('原图过大（>25MB），请选择较小的图片');
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxBytes: 480 * 1024,
        maxEdge: 512,
        minEdge: 128,
      });
      setLogo(dataUrl);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '图标处理失败');
    }
  };

  return (
    <div className="fixed inset-0 z-[92] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-t-2xl xl:rounded-2xl border border-gray-200 bg-white p-4 xl:p-5 space-y-4 text-gray-800 max-h-[min(88dvh,760px)] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">品牌显示设置</h3>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">软件名称</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg"
              placeholder="输入显示名称"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">软件图标</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handlePickLogo(e.target.files?.[0])}
              className="w-full text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              建议正方形图；上传前会自动压缩到约 500KB 以内。仅影响本机界面显示。
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 flex items-center">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="preview" className="w-10 h-10 rounded object-cover border border-gray-200 mr-2" />
            ) : (
              <LayoutDashboard className="w-10 h-10 text-blue-500 mr-2" />
            )}
            <div className="text-sm font-semibold text-gray-700 truncate">{title.trim() || APP_NAME}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setLogo('')}
            className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50"
          >
            清空图标
          </button>
          <button
            type="button"
            onClick={() => onSave(title, logo)}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function NavLinkButton({
  item,
  pathname,
  onNavigate,
  nested,
  variant = 'default',
  railMode = false,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: (href: string) => void;
  nested?: boolean;
  variant?: 'default' | 'bossDock';
  /** 收银平板窄轨：仅图标，避免侧栏占满横向空间 */
  railMode?: boolean;
}) {
  const pathNorm = pathname.replace(/\/+$/, '') || '/';
  const hrefNorm = item.href.replace(/\/+$/, '') || '/';
  /** 根路径 `/` 渲染的是工作台（dashboard），勿误高亮收银台 */
  const isActive =
    pathNorm === hrefNorm || (pathNorm === '/' && hrefNorm === '/dashboard');
  const Icon = item.icon;

  if (variant === 'bossDock') {
    return (
      <button
        type="button"
        onClick={() => onNavigate(item.href)}
        className={`flex flex-1 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl min-h-[3.5rem] px-1 py-2 text-xs font-semibold transition-colors ${
          isActive ? 'bg-blue-600 text-white shadow-md' : 'text-gray-200 bg-gray-800/60 active:bg-gray-700'
        }`}
      >
        <Icon className={`w-7 h-7 shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
        <span className="truncate max-w-[4.25rem] text-center leading-tight">{item.name}</span>
      </button>
    );
  }

  if (railMode) {
    return (
      <button
        type="button"
        title={item.name}
        onClick={() => onNavigate(item.href)}
        className={`flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-lg py-2 transition-all group cursor-pointer ${
          isActive
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Icon
          className={`h-5 w-5 shrink-0 transition-colors ${
            isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'
          }`}
        />
        <span className="sr-only">{item.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.href)}
      className={`flex w-full min-h-[44px] touch-manipulation items-center py-2 text-sm font-medium transition-all rounded-lg group cursor-pointer ${
        nested ? 'pl-3 pr-3' : 'px-4 py-3'
      } ${
        isActive
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      <Icon
        className={`w-5 h-5 shrink-0 mr-3 transition-colors ${
          isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'
        }`}
      />
      <span className="truncate text-left">{item.name}</span>
    </button>
  );
}

function BossMobileShell({
  layout = 'bottomDock',
  dockItems,
  moreItems,
  pathname,
  onNavigate,
  moreOpen,
  onOpenMore,
  onCloseMore,
  appTitle,
  appLogoDataUrl,
  onOpenBrand,
  onOpenMenuSettings,
  onRequestNavCollapse,
  signOut,
}: {
  layout?: 'bottomDock' | 'leftRail';
  dockItems: NavItem[];
  moreItems: NavItem[];
  pathname: string;
  onNavigate: (href: string) => void;
  moreOpen: boolean;
  onOpenMore: () => void;
  onCloseMore: () => void;
  appTitle: string;
  appLogoDataUrl: string;
  onOpenBrand: () => void;
  onOpenMenuSettings: () => void;
  onRequestNavCollapse?: () => void;
  signOut: () => void | Promise<void>;
}) {
  const moreSheet = moreOpen ? (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="更多功能"
      onClick={onCloseMore}
    >
      <div
        className="bg-white rounded-t-2xl max-h-[88dvh] overflow-y-auto overflow-x-hidden flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-2 px-4 py-3 border-b border-gray-100">
          <button
            type="button"
            onClick={() => {
              onOpenBrand();
              onCloseMore();
            }}
            className="flex items-center gap-2 min-w-0 text-left text-gray-900"
          >
            {appLogoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={appLogoDataUrl}
                alt=""
                className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0"
              />
            ) : (
              <LayoutDashboard className="w-10 h-10 text-blue-600 shrink-0" />
            )}
            <span className="font-bold text-lg truncate">{appTitle}</span>
          </button>
          <button
            type="button"
            onClick={onCloseMore}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 shrink-0"
            aria-label="关闭"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-y-contain p-4 space-y-2 flex-1 touch-pan-y [-webkit-overflow-scrolling:touch]">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  onNavigate(item.href);
                  onCloseMore();
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-left text-sm font-semibold text-gray-900 active:bg-gray-100 touch-manipulation"
              >
                <Icon className="h-5 w-5 shrink-0 text-gray-600" />
                {item.name}
              </button>
            );
          })}
        </div>
        <div className="border-t border-gray-100 p-3 space-y-2 bg-gray-50">
          <button
            type="button"
            onClick={() => {
              onOpenMenuSettings();
              onCloseMore();
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 touch-manipulation"
          >
            <Settings className="h-4 w-4 shrink-0" />
            菜单设置
          </button>
          {onRequestNavCollapse ? (
            <button
              type="button"
              onClick={() => {
                onRequestNavCollapse();
                onCloseMore();
              }}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 touch-manipulation"
            >
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
              隐藏底部导航
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100 touch-manipulation"
          >
            退出登录（切换账号）
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (layout === 'leftRail') {
    return (
      <>
        <div className="grid h-full min-h-0 w-full grid-rows-[auto_1fr_auto] overflow-y-auto overflow-x-hidden bg-gray-900 text-white border-r border-gray-800">
          <button
            type="button"
            onClick={() => onOpenBrand()}
            className="flex h-14 shrink-0 items-center justify-center border-b border-gray-800 hover:bg-gray-800/60 transition-colors"
            title={appTitle}
          >
            {appLogoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={appLogoDataUrl}
                alt=""
                className="h-9 w-9 rounded object-cover border border-gray-700"
              />
            ) : (
              <LayoutDashboard className="h-9 w-9 text-blue-500" />
            )}
            <span className="sr-only">{appTitle}</span>
          </button>
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1 py-2 space-y-1 touch-manipulation [-webkit-overflow-scrolling:touch]">
            {dockItems.map((item) => (
              <NavLinkButton
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigate={onNavigate}
                railMode
              />
            ))}
            <button
              type="button"
              onClick={onOpenMore}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-400 transition-colors hover:bg-gray-800/70 hover:text-white touch-manipulation"
              title="更多"
            >
              <Menu className="h-5 w-5 shrink-0" aria-hidden />
              <span className="sr-only">更多</span>
            </button>
          </nav>
          <div className="shrink-0 border-t border-gray-800 p-1.5 space-y-1">
            <button
              type="button"
              onClick={() => onOpenMenuSettings()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-200 hover:bg-gray-800 touch-manipulation"
              title="菜单设置"
            >
              <Settings className="h-5 w-5 shrink-0" aria-hidden />
              <span className="sr-only">菜单设置</span>
            </button>
            {onRequestNavCollapse ? (
              <button
                type="button"
                onClick={onRequestNavCollapse}
                className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-200 hover:bg-gray-800 touch-manipulation"
                title="隐藏底部导航"
              >
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only">隐藏底部导航</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-gray-300 hover:bg-gray-800 touch-manipulation"
              title="退出登录"
            >
              <X className="h-4 w-4 shrink-0" aria-hidden />
              <span className="sr-only">退出登录</span>
            </button>
          </div>
        </div>
        {moreSheet}
      </>
    );
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-gray-950/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.35)] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-stretch justify-between gap-1.5 px-2 pt-2">
          {dockItems.map((item) => (
            <NavLinkButton
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
              variant="bossDock"
            />
          ))}
          <button
            type="button"
            onClick={onOpenMore}
            className="flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl min-h-[3.5rem] px-1 py-2 text-xs font-semibold text-gray-200 bg-gray-800/60 active:bg-gray-700 touch-manipulation"
          >
            <Menu className="w-7 h-7 text-gray-400" aria-hidden />
            <span className="leading-tight">更多</span>
          </button>
        </div>
      </div>
      {moreSheet}
    </>
  );
}

export default Sidebar;
