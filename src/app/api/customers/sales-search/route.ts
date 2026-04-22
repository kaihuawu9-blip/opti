import { NextRequest, NextResponse } from 'next/server';
import { cloudRest, isCloudRestConfigured } from '@/core/auth/cloudRest';
import { disableAuthMode } from '@/core/auth';
import { resolveSessionFromRequest } from '@/lib/localAuth';
import { hasPermission, type UserRole } from '@/core/permissions';

export const runtime = 'nodejs';

const QUERY_ROW_LIMIT = 10_000;

/** 服务端固定列集，避免浏览器把超长 select 拼进 PostgREST URL。 */
const SALES_CUSTOMER_LIST_SELECT =
  'id,created_at,quantity,total_price,customer_name,customer_phone,products(name),stores(name)';

function normalizeRole(raw: string | null | undefined): UserRole {
  const role = String(raw || '').trim().toLowerCase();
  if (role === 'owner' || role === 'manager' || role === 'cashier' || role === 'inventory') return role;
  return 'cashier';
}

/** 降低 PostgREST `or=(...)` 注入风险：去掉逗号与通配符转义。 */
function escapeIlikeToken(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/,/g, ' ')
    .replace(/[()]/g, '');
}

export async function GET(req: NextRequest) {
  try {
    if (!disableAuthMode) {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
      }
      const role = normalizeRole(resolved.user.role);
      if (!hasPermission(role, 'customers.view')) {
        return NextResponse.json({ ok: false, error: '无权访问客户查询' }, { status: 403 });
      }
    }

    if (!isCloudRestConfigured) {
      return NextResponse.json(
        { ok: false, error: '云端 REST 未配置（ALIYUN_REST_URL / ALIYUN_REST_ANON_KEY）' },
        { status: 503 },
      );
    }

    const qRaw = (req.nextUrl.searchParams.get('q') || '').trim();
    if (!qRaw) {
      return NextResponse.json({ ok: true, rows: [] satisfies unknown[] });
    }

    const token = escapeIlikeToken(qRaw).trim();
    if (!token) {
      return NextResponse.json({ ok: true, rows: [] satisfies unknown[] });
    }
    const pattern = `%${token}%`;
    const orFilter = `customer_name.ilike.${pattern},customer_phone.ilike.${pattern}`;

    const { data, error } = await cloudRest
      .from('sales')
      .select(SALES_CUSTOMER_LIST_SELECT)
      .or(orFilter)
      .order('created_at', { ascending: false })
      .limit(QUERY_ROW_LIMIT);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message || '查询失败' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
