'use client';

import { useCallback, useEffect, useState } from 'react';
import { cloudRest } from '@/lib/cloudRest';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { useAuth } from '@/components/AuthProvider';
import {
  defaultRolePermissions,
  permissionLabels,
  roleNameMap,
  type PermissionKey,
  type UserRole,
} from '@/lib/permissions';
import { Shield, Pencil, Plus, X, Trash2 } from 'lucide-react';

type Store = {
  id: string;
  name: string;
};

type UserProfile = {
  user_id: string;
  full_name: string | null;
  role: UserRole;
  store_id: string | null;
  stores?: { name?: string | null } | null;
};

type ProfileForm = {
  user_id: string;
  full_name: string;
  role: UserRole;
  store_id: string;
};
type AiChatLog = {
  id: string;
  user_tag?: string | null;
  source: string;
  prompt?: string | null;
  answer?: string | null;
  ip?: string | null;
  created_at: string;
};

const roleOptions: UserRole[] = ['owner', 'manager', 'cashier', 'inventory'];

export default function AdminPage() {
  const { hasPermission } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, Record<PermissionKey, boolean>>>(
    defaultRolePermissions,
  );
  const [savingPerms, setSavingPerms] = useState(false);
  const [logs, setLogs] = useState<AiChatLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logKeyword, setLogKeyword] = useState('');

  async function fetchData() {
    setLoading(true);
    const [{ data: storesData }, { data: profileData }, { data: permsData }] = await Promise.all([
      cloudRest.from('stores').select('id,name').order('name'),
      cloudRest
        .from('user_profiles')
        .select(
          `
          user_id,
          full_name,
          role,
          store_id,
          stores (name)
        `,
        )
        .order('created_at', { ascending: false }),
      cloudRest.from('role_permissions').select('role, permissions'),
    ]);
    setStores((storesData as Store[]) ?? []);
    setProfiles((profileData as UserProfile[]) ?? []);
    const next = { ...defaultRolePermissions };
    for (const row of permsData ?? []) {
      const role = row.role as UserRole;
      next[role] = { ...next[role], ...(row.permissions || {}) };
    }
    setRolePermissions(next);
    setLoading(false);
  }

  const fetchLogs = useCallback(async (keyword?: string) => {
    setLogsLoading(true);
    let query = cloudRest
      .from('ai_chat_logs')
      .select('id,user_tag,source,prompt,answer,ip,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    const k = (keyword ?? logKeyword).trim();
    if (k) {
      query = query.or(`user_tag.ilike.%${k}%,prompt.ilike.%${k}%,answer.ilike.%${k}%`);
    }
    const { data } = await query;
    setLogs((data as AiChatLog[]) ?? []);
    setLogsLoading(false);
  }, [logKeyword]);

  useEffect(() => {
    if (hasPermission('admin.view')) fetchData();
  }, [hasPermission]);

  useEffect(() => {
    if (hasPermission('admin.view')) fetchLogs(logKeyword);
  }, [hasPermission, logKeyword, fetchLogs]);

  const openCreate = () => {
    setForm({
      user_id: '',
      full_name: '',
      role: 'cashier',
      store_id: '',
    });
  };

  const openEdit = (row: UserProfile) => {
    setForm({
      user_id: row.user_id,
      full_name: row.full_name ?? '',
      role: row.role,
      store_id: row.store_id ?? '',
    });
  };

  const save = async () => {
    if (!form) return;
    if (!form.user_id) {
      window.alert('请输入用户ID（auth.users.id）');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        // 不做格式/长度前端限制，按用户输入原样提交
        user_id: form.user_id,
        full_name: form.full_name || null,
        role: form.role,
        store_id: form.role === 'owner' ? null : form.store_id || null,
      };
      const { error } = await cloudRest.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
      if (error) {
        window.alert('保存失败：' + toChineseErrorMessage(error.message));
        return;
      }
      setForm(null);
      fetchData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      window.alert('保存失败：' + toChineseErrorMessage(msg));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('确认删除该员工账号吗？将同时删除登录账号，且不可恢复。')) return;
    setDeletingUserId(userId);
    try {
      // 先删权限资料
      const { error: profileErr } = await cloudRest.from('user_profiles').delete().eq('user_id', userId);
      if (profileErr) {
        window.alert('删除失败：' + toChineseErrorMessage(profileErr.message));
        return;
      }
      // 再删 auth 账号（依赖数据库函数）
      const { error: rpcErr } = await cloudRest.rpc('admin_delete_auth_user', { target_user_id: userId });
      if (rpcErr) {
        window.alert('已删除员工资料，但删除登录账号失败：' + toChineseErrorMessage(rpcErr.message));
      }
      await fetchData();
    } finally {
      setDeletingUserId(null);
    }
  };

  const togglePerm = (role: UserRole, key: PermissionKey, value: boolean) => {
    setRolePermissions((prev) => ({ ...prev, [role]: { ...prev[role], [key]: value } }));
  };

  const savePermissions = async () => {
    try {
      setSavingPerms(true);
      const payload = (Object.keys(rolePermissions) as UserRole[]).map((role) => ({
        role,
        permissions: rolePermissions[role],
      }));
      const { error } = await cloudRest.from('role_permissions').upsert(payload, { onConflict: 'role' });
      if (error) {
        window.alert('保存权限失败：' + toChineseErrorMessage(error.message));
        return;
      }
      window.alert('权限已保存，重新登录后所有账号生效。');
    } finally {
      setSavingPerms(false);
    }
  };

  if (!hasPermission('admin.view')) {
    return <div className="text-gray-600">当前账号无权访问系统管理。</div>;
  }

  if (loading) return <div className="flex items-center justify-center h-64">加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">权限管理</h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-1" />
          新增/绑定员工
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        请先在「本地账号 / 用户表」中创建可登录账号，再把对应用户 ID 填到这里绑定角色和门店（与 /api/local-auth 体系一致）。
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800">职位权限勾选</h2>
          <button
            type="button"
            onClick={savePermissions}
            disabled={savingPerms}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {savingPerms ? '保存中...' : '保存权限'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">权限项</th>
                <th className="px-3 py-2">{roleNameMap.owner}</th>
                <th className="px-3 py-2">店长</th>
                <th className="px-3 py-2">收银</th>
                <th className="px-3 py-2">库存</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(Object.keys(permissionLabels) as PermissionKey[]).map((key) => (
                <tr key={key}>
                  <td className="px-3 py-2 text-gray-700">{permissionLabels[key]}</td>
                  {(['owner', 'manager', 'cashier', 'inventory'] as UserRole[]).map((role) => (
                    <td key={role} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!rolePermissions[role][key]}
                        onChange={(e) => togglePerm(role, key, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold text-gray-800">AI 对话日志</h2>
          <div className="flex items-center gap-2">
            <input
              value={logKeyword}
              onChange={(e) => setLogKeyword(e.target.value)}
              className="w-72 px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="按用户标识/问题/回答关键词筛选"
            />
            <button
              type="button"
              onClick={() => fetchLogs(logKeyword)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              刷新
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-700">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">用户标识</th>
                <th className="px-3 py-2 text-left">来源</th>
                <th className="px-3 py-2 text-left">问题</th>
                <th className="px-3 py-2 text-left">回答</th>
                <th className="px-3 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.user_tag || '—'}</td>
                  <td className="px-3 py-2 text-xs">{l.source}</td>
                  <td className="px-3 py-2 text-xs max-w-sm truncate" title={l.prompt || ''}>
                    {l.prompt || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-sm truncate" title={l.answer || ''}>
                    {l.answer || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.ip || '—'}</td>
                </tr>
              ))}
              {!logsLoading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                    暂无日志
                  </td>
                </tr>
              )}
              {logsLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                    加载中...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-sm text-gray-700">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-6 py-4">用户ID</th>
              <th className="px-6 py-4">姓名</th>
              <th className="px-6 py-4">角色</th>
              <th className="px-6 py-4">门店</th>
              <th className="px-6 py-4 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {profiles.map((row) => (
              <tr key={row.user_id}>
                <td className="px-6 py-4 font-mono text-xs">{row.user_id}</td>
                <td className="px-6 py-4">{row.full_name || '—'}</td>
                <td className="px-6 py-4">{roleNameMap[row.role]}</td>
                <td className="px-6 py-4">{row.stores?.name || '—'}</td>
                <td className="px-6 py-4 text-center">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(row.user_id)}
                      disabled={deletingUserId === row.user_id}
                      className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      {deletingUserId === row.user_id ? '删除中...' : '删除'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  暂无员工资料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-xl rounded-2xl border border-gray-200 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">员工权限设置</h3>
              <button type="button" onClick={() => setForm(null)} className="p-2 rounded-full hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                placeholder="用户ID（auth.users.id）"
              />
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="员工姓名"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleNameMap[r]}
                  </option>
                ))}
              </select>
              <select
                value={form.store_id}
                onChange={(e) => setForm({ ...form, store_id: e.target.value })}
                disabled={form.role === 'owner'}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-100"
              >
                <option value="">未绑定门店</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

