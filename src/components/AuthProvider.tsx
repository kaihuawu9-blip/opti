'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { disableAuthInCurrentEnv } from '@/core/auth';
import { fetchApiJson } from '@/lib/apiFetch';
import { defaultRolePermissions, type PermissionKey, type UserRole } from '@/lib/permissions';

type UserProfile = {
  user_id: string;
  full_name: string | null;
  role: UserRole;
  store_id: string | null;
};

type LocalSession = {
  user: {
    id: string;
    email: string;
  };
};

const BYPASS_USER_ID = 'local-dev-user';

const bypassFakeSession = {
  user: { id: BYPASS_USER_ID, email: 'local-dev' },
} as LocalSession;

const bypassFakeProfile: UserProfile = {
  user_id: BYPASS_USER_ID,
  full_name: '测试免登录',
  role: 'owner',
  store_id: null,
};

type AuthContextValue = {
  loading: boolean;
  checked: boolean;
  session: LocalSession | null;
  profile: UserProfile | null;
  permissions: Record<PermissionKey, boolean>;
  hasPermission: (key: PermissionKey) => boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  checked: false,
  session: null,
  profile: null,
  permissions: { ...defaultRolePermissions.cashier },
  hasPermission: () => false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  /**
   * 仅开发环境且显式设置 `NEXT_PUBLIC_ENABLE_AUTH` 为 false/0/off/no 时免登录；
   * 生产构建始终要求鉴权。见 `core/auth`。
   */
  const disableAuthByEnv = disableAuthInCurrentEnv;

  /**
   * 需要鉴权时先处于「加载中」，避免已带 Cookie 的用户先看到一帧登录页再跳进主界面
   * （平板上 /api/local-auth/me 较慢时尤其明显，易被误认为两套 UI 或「登录状态异常」）。
   * 会话探测结束后（成功、失败或超时）在 effect 的 finally 里置为 false。
   */
  const [loading, setLoading] = useState(() => !disableAuthByEnv);
  const [checked, setChecked] = useState(() => disableAuthByEnv);
  const [session, setSession] = useState<LocalSession | null>(() =>
    disableAuthByEnv ? bypassFakeSession : null,
  );
  const [profile, setProfile] = useState<UserProfile | null>(() =>
    disableAuthByEnv ? bypassFakeProfile : null,
  );
  useLayoutEffect(() => {
    if (!disableAuthByEnv) return;
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[AuthProvider] 开发环境已显式关闭鉴权 (NEXT_PUBLIC_ENABLE_AUTH=false/0/off/no)。生产环境不会进入此模式。',
      );
    }
  }, [disableAuthByEnv]);

  useEffect(() => {
    if (disableAuthByEnv) return;
    let cancelled = false;
    const run = async () => {
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), 20_000);
      try {
        const { res: resp, data } = await fetchApiJson<{
          ok?: boolean;
          session?: LocalSession;
          profile?: UserProfile;
        }>('/api/local-auth/me', {
          method: 'GET',
          cache: 'no-store',
          signal: ac.signal,
        });
        if (cancelled) return;
        if (resp.ok && data.ok && data.session?.user?.id && data.profile?.user_id) {
          setSession(data.session);
          setProfile(data.profile);
        } else {
          setSession(null);
          setProfile(null);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        window.clearTimeout(timer);
        if (!cancelled) {
          setLoading(false);
          setChecked(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [disableAuthByEnv]);

  /** 极端情况（脚本异常、鉴权 Promise 未落地等）避免整页永久停在「加载中」。 */
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => {
      setLoading(false);
    }, 15000);
    return () => window.clearTimeout(t);
  }, [loading]);

  const resolvedPermissions = useMemo(
    () => (profile ? { ...defaultRolePermissions[profile.role] } : { ...defaultRolePermissions.cashier }),
    [profile],
  );

  const value = useMemo(
    () => ({
      loading,
      checked,
      session,
      profile,
      permissions: resolvedPermissions,
      hasPermission: (key: PermissionKey) => !!resolvedPermissions[key],
      signOut: async () => {
        if (disableAuthByEnv) {
          setSession(bypassFakeSession);
          setProfile(bypassFakeProfile);
          return;
        }
        await fetch('/api/local-auth/logout', { method: 'POST' }).catch(() => undefined);
        setSession(null);
        setProfile(null);
      },
    }),
    [loading, checked, session, profile, resolvedPermissions, disableAuthByEnv],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
