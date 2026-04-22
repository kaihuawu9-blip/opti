'use client';

import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { disableAuthMode } from '@/core/auth';
import { isCloudRestConfigured, cloudRestConfigHint } from '@/lib/cloudRest';
import { fetchApiJson, ApiJsonFetchError } from '@/lib/apiFetch';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { Search, MapPin, Package, UserRound, Phone } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

type Sale = {
  id: string;
  created_at: string;
  quantity: number;
  total_price: number | string;
  customer_name?: string | null;
  customer_phone?: string | null;
  products?: { name?: string | null } | null;
  stores?: { name?: string | null } | null;
};

/** 与 estimateSize 一致，保证滚动条高度准确、滑动流畅 */
const ROW_HEIGHT_PX = 56;
/** 单次查询上限（仅影响取数；界面用虚拟列表只渲染可视区 DOM） */
const QUERY_ROW_LIMIT = 10_000;

/** 表头与数据行共用列宽，避免错位 */
const RESULT_GRID_CLASS =
  'grid grid-cols-[5.5rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_2.5rem_5rem] gap-x-3 px-6 items-center';

function formatSaleTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CustomersPage() {
  const { hasPermission } = useAuth();
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  const scrollParentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 18,
  });

  async function searchCustomers() {
    const k = keyword.trim();
    if (!k) {
      setRows([]);
      return;
    }
    if (!isCloudRestConfigured && !disableAuthMode) {
      window.alert(cloudRestConfigHint);
      return;
    }
    if (!isCloudRestConfigured && disableAuthMode) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { res, data } = await fetchApiJson<{
        ok?: boolean;
        rows?: Sale[];
        error?: string;
      }>(`/api/customers/sales-search/?q=${encodeURIComponent(k)}`, { method: 'GET', cache: 'no-store' });
      setLoading(false);
      if (!res.ok || data?.ok === false) {
        window.alert('查询失败：' + toChineseErrorMessage(data?.error || res.statusText));
        return;
      }
      setRows((data?.rows ?? []) as Sale[]);
    } catch (e) {
      setLoading(false);
      if (e instanceof ApiJsonFetchError) return;
      window.alert('查询失败：' + toChineseErrorMessage(e instanceof Error ? e.message : String(e)));
    }
  }

  if (!hasPermission('customers.view')) {
    return <div className="text-gray-600">当前账号无权访问客户查询。</div>;
  }

  const virtualItems = rows.length > 0 ? virtualizer.getVirtualItems() : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Search className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">客户查询</h1>
          <p className="text-sm text-gray-500 mt-0.5">会员/客户消费记录列表，大量结果时仅渲染可视区域，滑动更流畅</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={keyword}
            onChange={(e) => {
              const v = e.target.value;
              setKeyword(v);
              if (!v.trim()) setRows([]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchCustomers();
            }}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500"
            placeholder="输入客户姓名或电话后回车/点击查询"
          />
          <button
            type="button"
            onClick={searchCustomers}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-800">查询结果</h2>
          {rows.length > 0 && (
            <span className="text-xs text-gray-500">
              共 {rows.length.toLocaleString('zh-CN')} 条
              {rows.length >= QUERY_ROW_LIMIT ? `（已达单次上限 ${QUERY_ROW_LIMIT.toLocaleString('zh-CN')} 条）` : ''}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            暂无数据，请输入客户姓名或电话后查询
          </div>
        ) : (
          <>
            <div
              className={`${RESULT_GRID_CLASS} py-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 shrink-0`}
            >
              <div>时间</div>
              <div>客户</div>
              <div>电话</div>
              <div>商品</div>
              <div>门店</div>
              <div className="text-center">数量</div>
              <div className="text-right">总价</div>
            </div>

            <div
              ref={scrollParentRef}
              className="overflow-auto overscroll-contain touch-pan-y"
              style={{ maxHeight: 'min(70vh, 720px)' }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualItems.map((vi) => {
                  const sale = rows[vi.index];
                  return (
                    <div
                      key={vi.key}
                      className={`${RESULT_GRID_CLASS} absolute left-0 top-0 w-full border-b border-gray-100 text-sm text-gray-700 hover:bg-gray-50/90 transition-colors py-2`}
                      style={{
                        height: vi.size,
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      <div className="text-gray-500 tabular-nums">{formatSaleTime(sale.created_at)}</div>
                      <div className="min-w-0 font-medium text-gray-900">
                        <span className="inline-flex items-center min-w-0 max-w-full">
                          <UserRound className="w-4 h-4 mr-1.5 shrink-0 text-gray-400" />
                          <span className="truncate">{sale.customer_name || '—'}</span>
                        </span>
                      </div>
                      <div className="min-w-0 text-gray-700">
                        <span className="inline-flex items-center min-w-0 max-w-full">
                          <Phone className="w-4 h-4 mr-1.5 shrink-0 text-gray-400" />
                          <span className="truncate">{sale.customer_phone || '—'}</span>
                        </span>
                      </div>
                      <div className="min-w-0 text-gray-700">
                        <span className="inline-flex items-center min-w-0 max-w-full">
                          <Package className="w-4 h-4 mr-1.5 shrink-0 text-gray-400" />
                          <span className="truncate">{sale.products?.name || '—'}</span>
                        </span>
                      </div>
                      <div className="min-w-0 text-gray-700">
                        <span className="inline-flex items-center min-w-0 max-w-full">
                          <MapPin className="w-4 h-4 mr-1.5 shrink-0 text-gray-400" />
                          <span className="truncate">{sale.stores?.name || '—'}</span>
                        </span>
                      </div>
                      <div className="text-center tabular-nums">{sale.quantity}</div>
                      <div className="text-right font-bold text-blue-600 tabular-nums">
                        ￥{Number(sale.total_price).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
