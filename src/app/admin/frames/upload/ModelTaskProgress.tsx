'use client';

export type ModelTaskUiPhase = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAIL';

const STEPS: { key: ModelTaskUiPhase; title: string; subtitle: string }[] = [
  { key: 'PENDING', title: 'PENDING', subtitle: '已提交任务' },
  { key: 'PROCESSING', title: 'PROCESSING', subtitle: '云端生成中' },
  { key: 'SUCCESS', title: 'SUCCESS', subtitle: '已就绪' },
  { key: 'FAIL', title: 'FAIL', subtitle: '未成功' },
];

function stepIndex(phase: ModelTaskUiPhase): number {
  const i = STEPS.findIndex((s) => s.key === phase);
  return i < 0 ? 0 : i;
}

export function ModelTaskProgress({ phase }: { phase: ModelTaskUiPhase | null }) {
  if (!phase) return null;

  const activeIdx = stepIndex(phase);
  const pct = Math.min(100, Math.round(((activeIdx + 1) / STEPS.length) * 100));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">生成进度</span>
        <span className="font-mono text-xs text-gray-500">{phase}</span>
      </div>

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            phase === 'FAIL' ? 'bg-red-500' : phase === 'SUCCESS' ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const past = i < activeIdx;
          const current = i === activeIdx;
          const future = i > activeIdx;

          let box =
            'border-gray-100 bg-gray-50 text-gray-400';
          if (current) {
            if (phase === 'FAIL') box = 'border-red-300 bg-red-50 text-red-900';
            else if (phase === 'SUCCESS') box = 'border-emerald-400 bg-emerald-50 text-emerald-900';
            else box = 'border-blue-300 bg-blue-50 text-blue-900';
          } else if (past) {
            box =
              phase === 'FAIL'
                ? 'border-slate-200 bg-slate-50 text-slate-700'
                : 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
          } else if (future) {
            box = 'border-gray-100 bg-gray-50 text-gray-400';
          }

          return (
            <div key={s.key} className={`rounded-lg border px-2 py-2 text-center text-xs ${box}`}>
              <div className="font-mono font-semibold">{s.title}</div>
              <div className="mt-0.5 text-[11px] leading-tight opacity-90">{s.subtitle}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
