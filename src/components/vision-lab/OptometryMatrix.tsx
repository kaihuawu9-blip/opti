'use client';

type MatrixCell = {
  id: string;
  title: string;
  tag: string;
  points: string[];
};

const MATRIX_ROWS: MatrixCell[] = [
  {
    id: 'rx',
    title: '处方与屈光',
    tag: 'Refraction',
    points: [
      '球镜、柱镜与轴位共同决定主子午线屈光力；散光轴位标注须与验光习惯（TABO 等）一致。',
      '工作距离与顶点距离会改变有效屈光力，高屈光力或接触镜换算时需做顶点距离修正。',
      '处方记录应区分远用、近用或双光/渐进近附加，避免加工单与主诉用途不一致。',
    ],
  },
  {
    id: 'centration',
    title: '瞳距与光学中心',
    tag: 'Centration',
    points: [
      '单眼瞳距（MONO PD）比合计瞳距更利于控制水平光学中心与棱镜效应。',
      '镜片光学中心与视轴对齐可减小不必要的棱镜与像差；高度数时移心对厚度与重量影响显著。',
      '镜眼距、面弯与倾斜角会改变实际入射角与有效度数，验配与质检环节需一并考虑。',
    ],
  },
  {
    id: 'binocular',
    title: '双眼视与舒适',
    tag: 'Binocular',
    points: [
      '双眼融像、隐斜视与调节—集合关系影响配戴舒适度；主诉视疲劳时需结合用眼距离与时长评估。',
      '不等像与屈光参差过大时，需评估耐受与镜片方案（接触镜、等像设计等）。',
      '儿童与青少年需关注近视进展管理策略，与光学实验室的厚度/材料选择相互印证。',
    ],
  },
  {
    id: 'progressive',
    title: '渐进与功能镜片',
    tag: 'PAL / SV',
    points: [
      '渐进通道、近用区与镜架几何（瞳高、前倾角）共同决定可用视野与泳动现象。',
      '驾驶、数码、防蓝光等功能镜片需在主诉、法规宣称与个体敏感度之间做专业取舍。',
      '本区为临床与加工衔接的纲要矩阵；细则与厂商设计参数以各品牌技术资料为准。',
    ],
  },
];

/**
 * 光学实验室 — 视光矩阵：临床与加工衔接的专业纲要，便于后续替换为交互工具或题库。
 */
export function OptometryMatrix() {
  return (
    <section
      className="mb-10 rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/90 to-white p-6 shadow-sm"
      aria-labelledby="optometry-matrix-heading"
    >
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="optometry-matrix-heading" className="text-xl font-semibold text-violet-900">
            视光矩阵
          </h2>
          <p className="mt-1 text-sm text-violet-700/90">
            Optometry Matrix · 视光专业纲要（与上方物理仿真并列，便于门店培训与复核）
          </p>
        </div>
        <p className="max-w-md text-xs text-gray-500 sm:text-right">
          下列模块为可扩展占位：后续可接入计算小工具、检查清单或 AI 辅助解读，不影响现有边缘厚度功能。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MATRIX_ROWS.map((cell) => (
          <article
            key={cell.id}
            className="flex flex-col rounded-lg border border-violet-100/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900">{cell.title}</h3>
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800">
                {cell.tag}
              </span>
            </div>
            <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-gray-700 marker:text-violet-400">
              {cell.points.map((line, i) => (
                <li key={i} className="pl-0.5">
                  {line}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
