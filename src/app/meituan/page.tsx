'use client';

import { Store, ExternalLink } from 'lucide-react';

const MEITUAN_URL =
  'https://e.dianping.com/app/merchant-platform/fe6031ae4f544c4?iUrl=Ly9lLmRpYW5waW5nLmNvbS9hcHAvbWVyY2hhbnQtd29ya2JlbmNoL2luZGV4Lmh0bWwjLw';

export default function MeituanPage() {
  const openInAppWindow = async () => {
    if (window.electronApp?.openPlatformWindow) {
      const r = await window.electronApp.openPlatformWindow({
        key: 'meituan',
        title: '美团开店宝',
        url: MEITUAN_URL,
      });
      if (!r.ok) window.alert('打开失败：' + (r.error || '未知错误'));
      return;
    }
    window.open(MEITUAN_URL, '_blank', 'noopener,noreferrer');
  };

  const openExternal = async () => {
    if (window.electronApp?.openExternal) {
      const r = await window.electronApp.openExternal(MEITUAN_URL);
      if (!r.ok) window.alert('打开失败：' + (r.error || '未知错误'));
      return;
    }
    window.open(MEITUAN_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4 h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">美团开店宝</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openInAppWindow()}
            className="inline-flex items-center px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            在应用内独立窗口打开（推荐）
          </button>
          <button
            type="button"
            onClick={() => void openExternal()}
            className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="w-4 h-4 mr-1" />
            外部浏览器打开
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700 space-y-3">
        <div>由于美团登录页在 iframe 中可能出现重定向闪烁，已改为独立窗口方式。</div>
        <div>请点击上方“在应用内独立窗口打开（推荐）”进行登录和使用，稳定性更高。</div>
        <div>如独立窗口仍异常，可用“外部浏览器打开”。</div>
      </div>
    </div>
  );
}
