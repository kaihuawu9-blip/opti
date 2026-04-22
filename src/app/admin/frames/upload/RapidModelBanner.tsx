'use client';

/** 图片已就绪后展示的「极速建模」提示条（不确定进度，仅表达预期）。 */
export function RapidModelBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 shadow-sm">
      <p className="text-sm font-medium text-blue-950">AI 正在极速建模（预计 15 秒）...</p>
      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-100/90">
        <div className="admin-rapid-model-bar absolute inset-y-0 w-[42%] rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400 motion-reduce:animate-none" />
      </div>
      <span className="sr-only">建模进度动画</span>
    </div>
  );
}
