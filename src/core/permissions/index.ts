export type UserRole = 'owner' | 'manager' | 'cashier' | 'inventory';
export type PermissionKey =
  | 'cashier.view'
  | 'inventory.view'
  | 'customers.view'
  | 'reports.view'
  | 'sales.edit'
  | 'sales.delete'
  | 'admin.view';

export const roleNameMap: Record<UserRole, string> = {
  owner: '所有权',
  manager: '店长',
  cashier: '收银',
  inventory: '库存',
};

export const permissionLabels: Record<PermissionKey, string> = {
  'cashier.view': '收银台',
  'inventory.view': '库存管理',
  'customers.view': '客户查询',
  'reports.view': '财务报表',
  'sales.edit': '销售数据修改',
  'sales.delete': '销售数据删除',
  'admin.view': '权限管理',
};

export const defaultRolePermissions: Record<UserRole, Record<PermissionKey, boolean>> = {
  owner: {
    'cashier.view': true,
    'inventory.view': true,
    'customers.view': true,
    'reports.view': true,
    'sales.edit': true,
    'sales.delete': true,
    'admin.view': true,
  },
  manager: {
    'cashier.view': true,
    'inventory.view': true,
    'customers.view': true,
    'reports.view': true,
    'sales.edit': true,
    'sales.delete': true,
    'admin.view': false,
  },
  cashier: {
    'cashier.view': true,
    'inventory.view': false,
    'customers.view': true,
    'reports.view': true,
    'sales.edit': false,
    'sales.delete': false,
    'admin.view': false,
  },
  inventory: {
    'cashier.view': true,
    'inventory.view': true,
    'customers.view': false,
    'reports.view': true,
    'sales.edit': false,
    'sales.delete': false,
    'admin.view': false,
  },
};

export function hasPermission(userRole: UserRole, permission: PermissionKey): boolean {
  return defaultRolePermissions[userRole][permission] || false;
}
