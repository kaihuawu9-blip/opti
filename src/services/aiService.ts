import { getOpenAiCompatibleApiKey } from '@/lib/aiApiCredentials';

type OpenAIMessageRole = 'system' | 'user' | 'assistant';

type OpenAIMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenAIMessage = {
  role: OpenAIMessageRole;
  content: string | OpenAIMessageContentPart[];
};

export type StandardEye = {
  ds: string;
  dc: string;
  axis: number | null;
  va: string;
  pd: number | null;
  add: string;
};

export type StandardRxOcrResult = {
  right: StandardEye;
  left: StandardEye;
  customerName: string;
  date: string;
  technician: string;
  notes: string;
  pd: number | null;
};

export type StandardVoiceOrderResult = {
  customerName: string;
  customerPhone: string;
  price: number | null;
  right: StandardEye;
  left: StandardEye;
};

type AiProviderConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  speechModel: string;
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_DOUBAO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

function parseMaybeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.+-]/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractJsonObject(content: string): string {
  const plain = content.trim();
  const fenced = plain.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : plain;
  const s = source.indexOf('{');
  const e = source.lastIndexOf('}');
  if (s >= 0 && e > s) return source.slice(s, e + 1);
  return source;
}

/** 表头常见「轴线」「轴向」与 axis 同义；部分模型用 A 表示轴位 */
function pickAxisFromEyePayload(x: Record<string, unknown>): unknown {
  return x.axis ?? x['轴线'] ?? x['轴向'] ?? x['轴位'] ?? x.A;
}

/** 合并多种英文/缩写到同一字符串字段（球镜/柱镜常见别名） */
function stringOrNumberField(...candidates: unknown[]): string {
  for (const v of candidates) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

/**
 * 从 OCR/手写蒸馏出的球镜、柱镜做常见位错修正（与 Prompt 中规则配合）。
 * 例如 500/5.0/5.00 按近视角理解为 -5.00；其它数字若已为 ±x.xx 则统一两位小数。
 */
function sweepDiopterOcrMistake(raw: string): string {
  const t = asString(raw).replace(/\s/g, '');
  if (!t) return '';
  if (t === '500') return '-5.00';
  if (t === '5.0' || t === '5.00' || t === '+5.0' || t === '+5.00') return '-5.00';
  if (t.includes('.') && !/[eE]/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n.toFixed(2);
  }
  return t;
}

/**
 * 模型可能输出 rightEye/OD 或把 JSON 包在 data/result 里；与 normalizeEye 衔接前做归一。
 */
function pickEyePayloadFromTextOcrRoot(parsed: unknown, side: 'right' | 'left'): unknown {
  const x = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  let root: Record<string, unknown> = x;
  if (!x.right && !x.left && !x.rightEye && !x.leftEye && !x.OD && !x.OS) {
    const d = x.data;
    const r0 = x.result;
    if (d && typeof d === 'object' && !Array.isArray(d)) root = d as Record<string, unknown>;
    else if (r0 && typeof r0 === 'object' && !Array.isArray(r0)) root = r0 as Record<string, unknown>;
  }
  if (side === 'right') {
    return (
      root.right ??
      root.Right ??
      root.rightEye ??
      root.OD ??
      root.od ??
      root['右眼'] ??
      root['右']
    );
  }
  return (
    root.left ??
    root.Left ??
    root.leftEye ??
    root.OS ??
    root.os ??
    root['左眼'] ??
    root['左']
  );
}

/** 纯文本 OCR 蒸馏与 /api/vision/rx-from-text 共用，面向手写单与杂乱版面 */
const RX_OCR_TEXT_DISTILL_RULES = `【容错规则】
1) 度数：手写/扫描常出现「500」「5.0」等，请理解为屈光度 D 并统一为两位小数（如 -5.00）。语境为近视/负球镜、柱镜为负柱时若缺负号应补上。柱镜同理。
2) 左右眼：R、右、OD、右眼 → 键 "right"；L、左、OS、左眼 → 键 "left"（禁止用 rightEye/leftEye）。
3) 噪点：忽略日期、店名、电话、地址、单号、验光师签名等非光学信息，不填入 JSON。
4) 只根据与球镜/柱镜/轴位/瞳距/ADD/VA 相关的内容填写；读不到用空字符串或 null。轴位为纯数字或 null，不要带 °。`;

function normalizeEye(value: unknown): StandardEye {
  const x = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const dsRaw = stringOrNumberField(x.ds, x.sphere, x.S, x.sph, x['SPH'], x['球镜']);
  const dcRaw = stringOrNumberField(x.dc, x.cylinder, x.C, x.cyl, x['CYL'], x['柱镜']);
  return {
    ds: sweepDiopterOcrMistake(dsRaw),
    dc: sweepDiopterOcrMistake(dcRaw),
    axis: parseMaybeNumber(pickAxisFromEyePayload(x)),
    va: asString(x.va),
    pd: parseMaybeNumber(x.pd),
    add: asString(x.add),
  };
}

/** 至少一眼有可写入表单的数或视标 */
function isStandardRxPairMeaningful(r: StandardEye, l: StandardEye): boolean {
  const one = (e: StandardEye) =>
    e.ds.trim() !== '' ||
    e.dc.trim() !== '' ||
    e.va.trim() !== '' ||
    e.add.trim() !== '' ||
    (e.pd != null && Number.isFinite(e.pd)) ||
    (e.axis != null && Number.isFinite(e.axis));
  return one(r) || one(l);
}

/** 双眼总瞳距（如 65.5）均分到左右眼各一半，单位 mm，保留两位小数 */
function halveBinocularPdMm(n: number): number {
  return Number((n / 2).toFixed(2));
}

/** 双眼总瞳距常见范围（mm）：仅在此区间内对「单格总距」做自动均分 */
const PD_BINOCULAR_SPLIT_MIN_MM = 45;
const PD_BINOCULAR_SPLIT_MAX_MM = 85;

/**
 * 手写单常见：仅一行总瞳距。若顶层 pd 在常见区间内且左右单眼 pd 皆空 → 各填一半；
 * 若顶层无值但仅一眼格内有区间内疑似总瞳距、另一眼空 → 按总瞳距均分。
 * 超出区间的不在此自动拆分，交由前端确认后再填。
 */
function applyBinocularPdSplit(result: StandardRxOcrResult): StandardRxOcrResult {
  const top = result.pd;
  const r = result.right.pd;
  const l = result.left.pd;
  const rEmpty = r == null;
  const lEmpty = l == null;

  if (
    typeof top === 'number' &&
    Number.isFinite(top) &&
    top >= PD_BINOCULAR_SPLIT_MIN_MM &&
    top <= PD_BINOCULAR_SPLIT_MAX_MM &&
    rEmpty &&
    lEmpty
  ) {
    const half = halveBinocularPdMm(top);
    return {
      ...result,
      right: { ...result.right, pd: half },
      left: { ...result.left, pd: half },
    };
  }

  if (top == null && rEmpty !== lEmpty) {
    const single = rEmpty ? l : r;
    if (
      typeof single === 'number' &&
      Number.isFinite(single) &&
      single >= PD_BINOCULAR_SPLIT_MIN_MM &&
      single <= PD_BINOCULAR_SPLIT_MAX_MM
    ) {
      const half = halveBinocularPdMm(single);
      return {
        ...result,
        right: { ...result.right, pd: half },
        left: { ...result.left, pd: half },
      };
    }
  }

  return result;
}

function normalizeRxOcrResult(value: unknown): StandardRxOcrResult {
  const x = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const right = normalizeEye(x.right);
  const left = normalizeEye(x.left);
  const base: StandardRxOcrResult = {
    right,
    left,
    customerName: asString(x.customerName),
    date: asString(x.date),
    technician: asString(x.technician),
    notes: asString(x.notes),
    pd: parseMaybeNumber(x.pd) ?? right.pd ?? left.pd,
  };
  return applyBinocularPdSplit(base);
}

function normalizeVoiceOrderResult(value: unknown): StandardVoiceOrderResult {
  const x = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    customerName: asString(x.customerName),
    customerPhone: asString(x.customerPhone),
    price: parseMaybeNumber(x.price),
    right: normalizeEye(x.right),
    left: normalizeEye(x.left),
  };
}

function resolveProviderConfig(): AiProviderConfig {
  const provider = (process.env.AI_PROVIDER || 'doubao').trim().toLowerCase();
  const defaultBaseUrl = provider === 'doubao' ? DEFAULT_DOUBAO_BASE_URL : DEFAULT_OPENAI_BASE_URL;
  const fromEnv = (process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || '').trim().replace(/\/$/, '');
  const baseUrl = fromEnv || defaultBaseUrl;
  const apiKey = getOpenAiCompatibleApiKey();
  const chatModel = (process.env.AI_CHAT_MODEL || process.env.OPENAI_MODEL || process.env.DOUBAO_MODEL || 'gpt-4o-mini').trim();
  const visionModel = (process.env.AI_VISION_MODEL || process.env.OPENAI_MODEL_VISION || chatModel).trim();
  const speechModel = (process.env.AI_SPEECH_MODEL || process.env.OPENAI_WHISPER_MODEL || 'whisper-1').trim();

  if (!apiKey) {
    throw new Error('服务端未配置 OPENAI_API_KEY 或 AI_API_KEY');
  }

  return { provider, apiKey, baseUrl, chatModel, visionModel, speechModel };
}

type ChatJsonOptions = { temperature?: number };

async function openAIChatCompletionJson(
  config: AiProviderConfig,
  messages: OpenAIMessage[],
  model: string,
  options?: ChatJsonOptions,
): Promise<unknown> {
  const temp = options?.temperature ?? 0;
  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: temp,
      messages,
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`${config.provider} 调用失败: ${raw.slice(0, 400)}`);
  }

  let content = '';
  try {
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    content = data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    throw new Error('模型返回格式异常');
  }
  if (!content) {
    throw new Error('模型返回空内容');
  }

  const jsonText = extractJsonObject(content);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error(`模型 JSON 不可解析: ${content.slice(0, 200)}`);
  }
}

async function openAITranscribe(config: AiProviderConfig, audio: File): Promise<string> {
  const form = new FormData();
  form.append('file', audio, audio.name || 'recording.webm');
  form.append('model', config.speechModel);
  form.append('language', 'zh');

  const resp = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`语音转写失败: ${raw.slice(0, 400)}`);
  }

  try {
    const data = JSON.parse(raw) as { text?: string };
    const text = (data.text || '').trim();
    if (!text) {
      throw new Error('未识别到有效语音内容，请重试');
    }
    return text;
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('语音转写返回格式异常');
  }
}

export class AIService {
  private readonly config: AiProviderConfig;

  constructor(config?: Partial<AiProviderConfig>) {
    const resolved = resolveProviderConfig();
    this.config = {
      ...resolved,
      ...config,
    };
  }

  async transcribeAudio(audio: File): Promise<string> {
    return openAITranscribe(this.config, audio);
  }

  async recognizePrescriptionFromImage(image: File): Promise<StandardRxOcrResult> {
    const buf = Buffer.from(await image.arrayBuffer());
    const dataUrl = `data:${image.type};base64,${buf.toString('base64')}`;

    const systemPrompt = '你是眼镜门店验光单 OCR 助手。只输出 JSON，不要输出其他文字。';
    const userPrompt = `请识别图片中的验光单，输出 JSON，严格使用以下结构：
{
  "right": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" },
  "left": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" },
  "customerName": "",
  "date": "",
  "technician": "",
  "notes": "",
  "pd": null
}
规则：
1) 读不到就填空字符串或 null。
2) 不要推测不存在的值。
3) 散光轴向：表头可能是「轴线」「轴位」「轴向」或英文 AXIS，含义相同，一律填入对应眼的 JSON 字段 "axis"（纯数字，不带 °）。
4) 瞳距 pd：数字可含小数点，不要带 mm。若表格只有一行「双眼共用总瞳距」（常见约 45–85 mm，如 65.5），将该数填入顶层 "pd"，且 "right"."pd" 与 "left"."pd" 均填 null；若已分列填写左右单眼瞳距，则分别写入 right.pd、left.pd，顶层 "pd" 可填 null。
5) 矫正视力等按格抄写，读不到留空。`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      this.config.visionModel,
    );

    return normalizeRxOcrResult(parsed);
  }

  /**
   * 从 Paddle 等产出的纯 OCR 文本中，用对话模型抽取双眼球镜 / 柱镜 / 轴位（供 /api/ocr 等链路）。
   * 若首轮全空，自动用略高温度与更强调式 prompt 再试一次，降低「有字无表」。
   */
  async extractRxSphCylAxisFromOcrText(rawText: string): Promise<{ right: StandardEye; left: StandardEye }> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('OCR 文本为空');
    }
    const safe = trimmed.replace(/"""/g, '"');
    const first = await this.extractRxFromOcrTextPass(safe, false);
    if (isStandardRxPairMeaningful(first.right, first.left)) return first;
    return this.extractRxFromOcrTextPass(safe, true);
  }

  private async extractRxFromOcrTextPass(
    safe: string,
    isRetry: boolean,
  ): Promise<{ right: StandardEye; left: StandardEye }> {
    const systemPrompt = isRetry
      ? '你是配镜验光单结构化助手。只输出一个 JSON 对象。上一步可能漏填：若原文出现带小数的屈光度（如 -3.00、+1.25）或轴位整数，必须写入对应眼的 ds、dc 或 axis。'
      : '你是配镜验光单结构化助手。只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = isRetry
      ? `二次提取。请按「右/OD/左/OS」与表格列，将原文中可见的球镜、柱镜、轴向数字写入 JSON。原文里明显有验光数时不得全空。${RX_OCR_TEXT_DISTILL_RULES}

严格使用下列键名与结构（读不到用空字符串或 null；axis 为纯数字或 null；pd 为数字或 null）：
{
  "right": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" },
  "left": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" }
}

OCR 文本：
"""${safe}"""`
      : `从下方 OCR 文本中提取双眼验光数据（含真实手写单、杂乱排版）。必须只输出 JSON。

${RX_OCR_TEXT_DISTILL_RULES}

严格使用下列键名与结构（读不到用空字符串或 null；axis 为纯数字或 null；pd 为数字或 null）：
{
  "right": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" },
  "left": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" }
}

OCR 文本：
"""${safe}"""`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      this.config.chatModel,
      isRetry ? { temperature: 0.12 } : undefined,
    );

    return {
      right: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'right')),
      left: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'left')),
    };
  }

  /**
   * 与 extractRxSphCylAxisFromOcrText 同链路（含首轮空时二次蒸馏），/api/vision/rx-from-text 与收银一致。
   */
  async extractRxJsonFromOcrTextLite(rawText: string): Promise<{ right: StandardEye; left: StandardEye }> {
    return this.extractRxSphCylAxisFromOcrText(rawText);
  }

  /**
   * 镜腿 / 吊牌 OCR 全文 → 品牌、型号、镜架尺寸、色号（收银「拍照识镜框」专项）。
   */
  async extractFrameTempleFromOcrText(rawText: string): Promise<{
    brand: string;
    model: string;
    size: string;
    color: string;
    productName: string;
  }> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('OCR 文本为空');
    }
    const safe = trimmed.replace(/"""/g, '"');
    const systemPrompt =
      '你是眼镜店资深店员。用户输入来自镜腿或吊牌拍照的 OCR 文本。只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = `请从 OCR 文本中提取以下字段（键名必须完全一致；读不到请用空字符串 ""）：
1. brand：品牌（如 Ray-Ban、雷朋）
2. model：型号（通常为一串字母+数字，如 RB2140）
3. size：镜架尺寸（形如 52□18-140、52-18-140 等，保留原文中的符号与数字）
4. color：颜色代码（如有 C12、色号等）

只输出 JSON，结构固定为：
{"brand":"","model":"","size":"","color":""}

OCR 文本：
"""${safe}"""`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      this.config.chatModel,
    );
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const brand = asString(obj.brand);
    const model = asString(obj.model);
    const size = asString(obj.size);
    const color = asString(obj.color);
    const productName = [brand, model].filter(Boolean).join(' ').trim() || model || brand || '';
    return { brand, model, size, color, productName };
  }

  /**
   * 非镜腿刻字类包装/标签 OCR：根据当前库存分类生成商品名称与一行补充说明。
   */
  async extractGenericCustomProductFromOcrText(
    rawText: string,
    category: string,
  ): Promise<{ productName: string; modelLine: string }> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('OCR 文本为空');
    }
    const safe = trimmed.replace(/"""/g, '"');
    const cat = category.trim() || '其他';
    const systemPrompt =
      '你是眼镜门店商品录入助手。根据 OCR 文本与给定库存分类，推断要写入系统的商品名称。只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = `当前库存分类（中文）：「${cat.replace(/"""/g, '"')}」

从下方 OCR 文本推断：
1. productName：适合出现在小票/库存里的商品名称（简短、可读；读不出可用「${cat}」+ 文本前 20 字内关键词）。
2. modelLine：规格、货号、口味、颜色等补充信息的一行（没有则空字符串）。

只输出 JSON：
{"productName":"","modelLine":""}

OCR 文本：
"""${safe}"""`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      this.config.chatModel,
    );
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      productName: asString(obj.productName),
      modelLine: asString(obj.modelLine),
    };
  }

  /**
   * 入库拍照识别：镜框/镜片包装等（含无标签、字极少场景）。
   * 【雙鏈注釋】系統 Prompt 與業務約定見 `src/app/api/inventory/ocr/route.ts` 頂部常量 `INVENTORY_ENTRY_PROMPT`；
   * 維護 JSON 鍵名或欄位語義時請雙端同步。
   *
   * @param inventoryEntrySystemPrompt 須與 `INVENTORY_ENTRY_PROMPT` 一致（由 API route 傳入）
   */
  async extractInventoryEntryFromOcrText(
    rawText: string,
    inventoryEntrySystemPrompt: string,
  ): Promise<{
    brand: string;
    model: string;
    size: string;
    color: string;
    refractiveIndex: string;
    suggestedRetailPrice: number | null;
    referenceCost: number | null;
  }> {
    const empty = {
      brand: '',
      model: '',
      size: '',
      color: '',
      refractiveIndex: '',
      suggestedRetailPrice: null as number | null,
      referenceCost: null as number | null,
    };
    const trimmed = rawText.trim();
    if (!trimmed) return empty;

    const safe = trimmed.replace(/"""/g, '"');
    const parseMoney = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (v == null || !String(v).trim()) return null;
      const n = Number(String(v).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const userPrompt = `只输出 JSON，键名必须完全一致：
{"brand":"","model":"","size":"","color":"","refractive_index":"","msrp":"","cost":""}

OCR 文本：
"""${safe}"""`;

    try {
      const parsed = await openAIChatCompletionJson(
        this.config,
        [
          { role: 'system', content: inventoryEntrySystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        this.config.chatModel,
      );
      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      let suggestedRetailPrice = parseMoney(obj.msrp);
      if (suggestedRetailPrice == null) {
        suggestedRetailPrice = parseMoney(obj.suggested_retail_price);
      }
      const referenceCost = parseMoney(obj.cost);
      return {
        brand: asString(obj.brand),
        model: asString(obj.model),
        size: asString(obj.size),
        color: asString(obj.color),
        refractiveIndex: asString(obj.refractive_index),
        suggestedRetailPrice,
        referenceCost,
      };
    } catch {
      return empty;
    }
  }

  async extractVoiceOrderFromText(text: string): Promise<StandardVoiceOrderResult> {
    const systemPrompt =
      '你是眼镜门店收银助手。根据用户口述抽取结构化字段。只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = `用户口述如下：
"""${text.replace(/"""/g, '"')}"""

请抽取为 JSON，严格使用下列键（读不到填空字符串或 null）：
{
  "customerName": "",
  "customerPhone": "",
  "price": null,
  "right": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" },
  "left": { "ds": "", "dc": "", "axis": null, "va": "", "pd": null, "add": "" }
}
规则：
1) customerName=客人姓名；customerPhone=手机号（如有）。
2) price=本单或镜片成交价（数字，单位元）。
3) right/left 为右眼 OD / 左眼 OS 的验光字段。`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      this.config.chatModel,
    );

    return normalizeVoiceOrderResult(parsed);
  }
}

export function createAIService(): AIService {
  return new AIService();
}
