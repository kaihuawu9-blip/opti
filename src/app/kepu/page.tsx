'use client';

import { useState } from 'react';
import { Baby, User, HeartPulse, Cog } from 'lucide-react';
import { useAppNavigate } from '@/lib/useAppNavigate';

type KepuTab = 'child' | 'adult' | 'elder' | 'lab';

const TABS: { id: KepuTab; label: string; icon: typeof Baby }[] = [
  { id: 'child', label: '少儿类', icon: Baby },
  { id: 'adult', label: '成年类', icon: User },
  { id: 'elder', label: '老年类', icon: HeartPulse },
  { id: 'lab', label: '加工类', icon: Cog },
];

const AXIAL_LENGTH_REF = [
  { age: '0～1 岁', range: '约 16.0～21.0' },
  { age: '1～3 岁', range: '约 20.0～22.0' },
  { age: '3～6 岁', range: '约 21.0～22.8' },
  { age: '6～9 岁', range: '约 22.0～23.2' },
  { age: '9～12 岁', range: '约 22.5～23.5' },
  { age: '12～15 岁', range: '约 22.8～23.8' },
  { age: '15～18 岁', range: '约 23.0～24.2' },
] as const;

const CORNEA_CHILD = [
  { item: 'K1 / K2（主子午线屈光度）', ref: '约 40.0～46.5 D（多数在 41～46 D）' },
  { item: '角膜散光（K2 − K1）', ref: '生理范围多数小于 1.50 D；偏大需结合验光' },
  { item: '双眼对称性', ref: '双眼 K 值不宜相差过大，明显差异建议专科评估' },
  { item: '与眼轴、屈光的关系', ref: '须结合球镜、柱镜、眼轴综合判断，不单看 K 值' },
] as const;

const ADULT_AXIAL = [
  { item: '眼轴（发育稳定后）', ref: '约 23.0～24.5 mm；近视者常偏长，远视者可偏短' },
  { item: '测量差异', ref: '不同设备、不同定义（角膜顶点等）读数可有 0.1～0.3 mm 级差异' },
] as const;

const ADULT_CORNEA = [
  { item: 'K1 / K2', ref: '约 40.5～46.5 D；配隐形、OK 镜需更精确角膜地形' },
  { item: '角膜散光', ref: '与验光柱镜相关但不等同；大散光需区分角膜性 / 眼内性' },
] as const;

const ADULT_RX_HINT = [
  { sym: 'S / DS', mean: '球镜（近视「−」、远视「+」）' },
  { sym: 'C / DC', mean: '柱镜（散光度数）' },
  { sym: 'Axis / A', mean: '散光轴位（度）' },
  { sym: 'ADD', mean: '下加光（老花附加，渐进 / 双光用）' },
] as const;

const PRESBYOPIA_AGE_REF = [
  { age: '约 40～45 岁', ref: '部分人开始需轻度下加（阅读距离变远）' },
  { age: '约 45～50 岁', ref: '老花逐渐明显，常需 +1.00～+1.75 D 区间（个体差异大）' },
  { age: '约 50～55 岁', ref: '多需 +1.75～+2.25 D 区间' },
  { age: '约 55～60 岁', ref: '多需 +2.25～+2.75 D 区间' },
  { age: '60 岁以上', ref: '以实际近用验光为准，且需排除白内障等眼病影响' },
] as const;

const LAB_CHECKLIST = [
  { step: '1', text: '核对：球镜 / 柱镜 / 轴位、左右眼勿反' },
  { step: '2', text: '核对：远用瞳距（PD）或单眼瞳距；渐进需瞳高（PH）' },
  { step: '3', text: '核对：镜圈尺寸、鼻梁宽、镜片最小直径是否够移心' },
  { step: '4', text: '核对：镜片品种（折射率、功能膜、染色、美薄等）与订单一致' },
  { step: '5', text: '加工后：焦度计抽检度数、轴位；渐进核对隐形标记位置' },
] as const;

const LAB_DECENTER = [
  { item: '水平移心量（单眼）', ref: '约等于（镜圈几何中心距一半 − 单眼瞳距）。实际以镜架基准与模板为准' },
  { item: '垂直移心', ref: '有瞳高时：以瞳高与镜圈垂直中心关系计算，避免子片过低或过高' },
  { item: '散光轴位', ref: '磨边装片时轴位与验光单一致；注意左右眼标记' },
] as const;

/** 门店培训向：少儿视光与产品常识（非提醒话术） */
const CHILD_TRAINING = [
  {
    title: '近视的光学概念',
    body:
      '平行光经眼屈光系统后焦点落在视网膜前为近视。常见关联因素包括眼轴偏长、角膜/晶体屈光偏强。向顾客说明时应区分「检查结果」与「是否必须戴镜」，具体方案以处方与视光师意见为准。',
  },
  {
    title: '远视储备（生理性远视）',
    body:
      '低龄儿童存在一定远视度属常见生理现象，随发育眼轴增长、远视度逐渐「消耗」。培训重点：会看报告上的球镜符号与年龄对照，能解释「储备偏少」需结合眼轴、曲率综合评估，不做恐吓式表述。',
  },
  {
    title: '离焦与周边光学设计镜片',
    body:
      '部分青控镜片通过改变视网膜周边离焦分布来参与近视管理策略。门店需掌握：产品属于光学设计差异，适应期与视场感受因人、因设计而异；不得承诺疗效，统一以说明书与厂家培训为准。',
  },
  {
    title: '儿童镜架与光学中心',
    body:
      '镜片光学中心应尽量对准视轴（与瞳距、瞳高相关）。镜眼距过大、镜面角过平或过陡会改变有效屈光与散光表现。培训会调鼻托、耳位，使镜架稳定不下滑，并会核对模板中心与瞳位。',
  },
  {
    title: '镜片材质与安全等级',
    body:
      '树脂片为门店主流；PC、聚氨酯类材料抗冲击更好，常用于运动镜、部分儿童方案。培训能说明「抗冲击≠不会碎」，护理上避免有机溶剂、高温暴晒，按厂家保养要求执行。',
  },
] as const;

const ADULT_TRAINING = [
  {
    title: '球镜、柱镜与联合光度',
    body:
      '球镜矫正整个子午线屈光；柱镜只矫正某一轴向屈光差，需配合轴位。顾客验光单上 S、C、A 三者一起才完整。培训会核对左右眼是否抄反、符号（近视/远视）是否一致。',
  },
  {
    title: '调节与视近',
    body:
      '视近时睫状肌收缩、晶体变凸，屈光力增加，称为调节。长时间近距离工作调节负荷大，可与视疲劳主诉相关。门店沟通侧重用眼距离与休息节律，不做疾病诊断。',
  },
  {
    title: '折射率与阿贝数',
    body:
      '折射率越高，同度数镜片通常可更薄，但阿贝数往往下降，色散（部分顾客感知的「彩虹边」）可能更明显。培训能按度数、框型、顾客敏感度做产品档位的理性介绍，避免单一「越薄越好」。',
  },
  {
    title: '膜层与功能镜片类别',
    body:
      '常见硬膜、减反射（增透）、易洁、防蓝光（滤过部分短波蓝光）等。变色片多为光致变色材料在紫外线下的可逆反应；偏光片通过偏振膜削减特定方向眩光，适合强反射环境。各功能有适用场景与局限，以厂家标称为准。',
  },
  {
    title: '瞳距：远用与近用',
    body:
      '远用瞳距用于看远主片；看近时双眼集合，近用瞳距通常略小于远用。双光、渐进需明确测量远用 PD、近用需求及渐进瞳高。培训会区分「验光单 PD」与「订单填写 PD」是否含近用单眼数据。',
  },
] as const;

const ELDER_TRAINING = [
  {
    title: '老花的生理与光学',
    body:
      '随年龄增长，晶体弹性下降、调节幅度减小，近点逐渐变远，需正附加（ADD）才能在看近工作距离上成像清晰。下加光度与年龄仅有统计相关性，处方必须以近用验光与实际用眼距离为准。',
  },
  {
    title: '渐进镜片结构（培训用）',
    body:
      '自上而下大致为远用区、过渡走廊（通道）、近用区；两侧存在像散与泳动敏感区。通道越短，近用区位置相对靠下，对镜框垂直高度、瞳高测量要求更严。门店需会看隐形刻印与核对远/近参考点。',
  },
  {
    title: '双光、三光与渐进的场景区分',
    body:
      '双光有明确分界线，近用区大、价格与适应路径与渐进不同；三光增加中距离区。培训掌握：柜台介绍时对应职业（文书、电脑、户外）与镜框高度限制，不替顾客做医疗选择。',
  },
  {
    title: '镜框尺寸与渐进验配',
    body:
      '镜圈垂直高度（B）、鼻梁宽（DBL）、几何中心距影响可裁直径与瞳高落点。渐进一般对最小框高有厂家建议值。培训会量顾客旧镜或选框时预留足够「鼻侧颞侧」与「上下」余量。',
  },
  {
    title: '白内障、糖尿病与屈光波动',
    body:
      '晶体密度与屈光指数变化可改变等效球镜与散光；血糖波动也可引起暂时性屈光变化。门店培训侧重：复测光度、建议专科随访等业务流程知识，由医师判断是否需要治疗。',
  },
] as const;

const LAB_TRAINING = [
  {
    title: '镜片毛坯直径与镜圈',
    body:
      '订单需核对镜片最小未裁直径是否覆盖移心后有效光学区。镜圈越大、单眼移心越大，对直径要求越高。培训会查供应商目录中的直径档与厚度承诺。',
  },
  {
    title: '基弧与面弯',
    body:
      '镜片前表面曲率与镜圈弯度需匹配，过平或过弯影响外观、应力与光学。定制片或美薄订单常涉及基弧选项，按厂家工艺单选择。',
  },
  {
    title: '棱镜处方与移心',
    body:
      '棱镜使像位移，处方会标明棱镜度与基底朝向（底内、底外、底上、底下）。部分棱镜可通过移心产生，需与处方总效果一致。培训能读懂棱镜栏并与加工单对照。',
  },
  {
    title: '焦度计抽检要点',
    body:
      '球镜、柱镜、轴位需在允差内；渐进多区需按规程测远用参考点。培训会识别焦度计十字标线对准与散光轴微调，异常时复核订单与镜片标识。',
  },
  {
    title: '磨边后外观与应力',
    body:
      '安全角、抛光减少割手与应力集中；装片过紧或镜圈变形可产生应力纹，偏光下有时可见。培训收货时抽检外观与应力迹象，重大问题退回返工。',
  },
] as const;

function MedicalDisclaimer() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 leading-relaxed">
      以下内容仅供门店<strong>内部学习与顾客沟通参考</strong>，数据来自常见教材与行业习惯表述，存在个体差异。
      <strong>不能替代医学检查、诊断或处方</strong>。不适或指标异常请到正规医院眼科 / 视光中心就诊。
    </div>
  );
}

function TrainingSection({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: readonly { title: string; body: string }[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        {subtitle ? <p className="text-xs text-gray-500 mt-1">{subtitle}</p> : null}
      </div>
      <div className="p-5 space-y-5">
        {items.map((row) => (
          <div key={row.title} className="text-sm">
            <h4 className="font-semibold text-gray-800 mb-1.5">{row.title}</h4>
            <p className="text-gray-700 leading-relaxed">{row.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function KepuPage() {
  const [tab, setTab] = useState<KepuTab>('child');
  const navigate = useAppNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">科普</h1>
          <p className="text-sm text-gray-500 mt-0.5">视光与加工常识，按人群分类查阅</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
              tab === id
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'child' && (
        <section className="space-y-4">
          <MedicalDisclaimer />
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">0～18 岁 眼轴长度参考</h3>
              <p className="text-xs text-gray-500 mt-1">单位：mm（毫米），约值</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold">年龄段</th>
                    <th className="px-5 py-3 font-semibold">眼轴长度参考区间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {AXIAL_LENGTH_REF.map((row) => (
                    <tr key={row.age} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-medium">{row.age}</td>
                      <td className="px-5 py-3 text-gray-700">{row.range}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">少儿 角膜曲率（K 值）参考说明</h3>
              <p className="text-xs text-gray-500 mt-1">屈光度 D</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold w-[38%]">项目</th>
                    <th className="px-5 py-3 font-semibold">参考说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {CORNEA_CHILD.map((row) => (
                    <tr key={row.item} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-medium align-top">{row.item}</td>
                      <td className="px-5 py-3 text-gray-700">{row.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <TrainingSection
            title="少儿：门店培训要点"
            subtitle="视光概念与镜架镜片常识，便于专业接待与内部考核"
            items={CHILD_TRAINING}
          />
        </section>
      )}

      {tab === 'adult' && (
        <section className="space-y-4">
          <MedicalDisclaimer />
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">成年人 眼轴与角膜（参考）</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold w-[32%]">项目</th>
                    <th className="px-5 py-3 font-semibold">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...ADULT_AXIAL, ...ADULT_CORNEA].map((row) => (
                    <tr key={row.item} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-medium align-top">{row.item}</td>
                      <td className="px-5 py-3 text-gray-700">{row.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">验光单常见符号速查</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold">符号</th>
                    <th className="px-5 py-3 font-semibold">含义</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ADULT_RX_HINT.map((row) => (
                    <tr key={row.sym} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-mono font-medium">{row.sym}</td>
                      <td className="px-5 py-3 text-gray-700">{row.mean}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <TrainingSection
            title="成年：门店培训要点"
            subtitle="屈光、镜片参数与验配用语，减少开单与介绍差错"
            items={ADULT_TRAINING}
          />
        </section>
      )}

      {tab === 'elder' && (
        <section className="space-y-4">
          <MedicalDisclaimer />
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">老花（下加光）与年龄大致关系</h3>
              <p className="text-xs text-gray-500 mt-1">仅供参考，必须以实际近用验光为准</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold">年龄段</th>
                    <th className="px-5 py-3 font-semibold">常见趋势（非处方）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {PRESBYOPIA_AGE_REF.map((row) => (
                    <tr key={row.age} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-medium">{row.age}</td>
                      <td className="px-5 py-3 text-gray-700">{row.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <TrainingSection
            title="老年：门店培训要点"
            subtitle="老花光学、渐进与镜框产品知识，侧重验配逻辑与品类区分"
            items={ELDER_TRAINING}
          />
        </section>
      )}

      {tab === 'lab' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-emerald-950">
              <div className="font-semibold text-emerald-900 flex items-center gap-2">
                加工后镜片边缘厚度（估算）
              </div>
              <p className="text-xs text-emerald-800/90 mt-1 leading-relaxed">
                在左侧菜单「<strong>工具</strong>」页内。若看不到「工具」，点左下角「菜单设置」把工具勾选为显示；桌面版需用最新打包的 EXE。
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/tools')}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-sm"
            >
              打开工具页
            </button>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-xs text-blue-950 leading-relaxed">
            <strong>加工类</strong>用于开单、跟厂、自检时快速对照。具体移心量、最小直径等以镜片供应商工艺规范与焦度计实测为准。
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">镜片加工核对清单</h3>
            </div>
            <ul className="p-5 space-y-2 text-sm text-gray-700">
              {LAB_CHECKLIST.map((row) => (
                <li key={row.step} className="flex gap-2">
                  <span className="font-semibold text-blue-600 shrink-0">{row.step}.</span>
                  <span>{row.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">移心与轴位要点</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="px-5 py-3 font-semibold w-[32%]">项目</th>
                    <th className="px-5 py-3 font-semibold">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {LAB_DECENTER.map((row) => (
                    <tr key={row.item} className="hover:bg-gray-50/80">
                      <td className="px-5 py-3 text-gray-800 font-medium align-top">{row.item}</td>
                      <td className="px-5 py-3 text-gray-700">{row.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <TrainingSection
            title="加工：门店培训要点"
            subtitle="开单、跟厂与自检用语，与清单表格互为补充"
            items={LAB_TRAINING}
          />
        </section>
      )}
    </div>
  );
}
