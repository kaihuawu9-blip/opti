'use client';

import { useAuth } from '@/components/AuthProvider';
import { matrixDictionary, matrixRules, validateBilateralRx } from '@/matrix';

/**
 * 视光矩阵：知识以代码资产形式存在于 src/matrix/，本页仅作只读展示与连通性示例。
 */
export default function OptometryMatrixPage() {
  const { hasPermission } = useAuth();

  const sampleCheck = validateBilateralRx({
    right: { sphere: -3, cylinder: -0.75, axis: 180 },
    left: { sphere: -2.75, cylinder: -0.5, axis: 5 },
    pdTotalMm: 62,
  });
  const sampleCheckLine = sampleCheck.ok
    ? '示例处方：通过 validateBilateralRx'
    : JSON.stringify(sampleCheck.issues);

  if (!hasPermission('cashier.view')) {
    return <div className="p-6 text-gray-600">当前账号无权访问视光矩阵。</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">视光矩阵</h1>
      <p className="mt-2 text-sm text-gray-600">{matrixRules.meta.description}</p>

      <dl className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">规则库</dt>
          <dd className="mt-1 font-mono text-gray-900">
            {matrixRules.meta.id} v{matrixRules.meta.version}
          </dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">行业字典</dt>
          <dd className="mt-1 font-mono text-gray-900">
            v{matrixDictionary.meta.version} · {matrixDictionary.entries.length} 条
          </dd>
        </div>
      </dl>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
        <p className="font-medium text-gray-900">校验器示例（本地资产驱动）</p>
        <p className="mt-1 font-mono text-xs text-gray-600">{sampleCheckLine}</p>
      </div>

      <div className="mt-10 min-h-[8rem] rounded-xl border border-dashed border-gray-200 bg-white/60" />
    </div>
  );
}
