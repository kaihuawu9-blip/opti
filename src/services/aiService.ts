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

/** 表头常见「轴线」「轴向」与 axis 同义 */
function pickAxisFromEyePayload(x: Record<string, unknown>): unknown {
  return x.axis ?? x['轴线'] ?? x['轴向'] ?? x['轴位'];
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
  return {
    ds: sweepDiopterOcrMistake(asString(x.ds)),
    dc: sweepDiopterOcrMistake(asString(x.dc)),
    axis: parseMaybeNumber(pickAxisFromEyePayload(x)),
    va: asString(x.va),
    pd: parseMaybeNumber(x.pd),
    add: asString(x.add),
  };
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

async function openAIChatCompletionJson(
  config: AiProviderConfig,
  messages: OpenAIMessage[],
  model: string,
): Promise<unknown> {
  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
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
   */
  async extractRxSphCylAxisFromOcrText(rawText: string): Promise<{ right: StandardEye; left: StandardEye }> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('OCR 文本为空');
    }
    const safe = trimmed.replace(/"""/g, '"');
    const systemPrompt = '你是配镜验光单结构化助手。只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = `从下方 OCR 文本中提取双眼验光数据（含真实手写单、杂乱排版）。必须只输出 JSON。

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
    );

    return {
      right: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'right')),
      left: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'left')),
    };
  }

  /**
   * 极简 Prompt：纯文本 OCR → 验光 JSON（供浏览器直连 Paddle 后的「秒回」蒸馏）。
   */
  async extractRxJsonFromOcrTextLite(rawText: string): Promise<{ right: StandardEye; left: StandardEye }> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('OCR 文本为空');
    }
    const safe = trimmed.replace(/"""/g, '"');
    const systemPrompt = '只输出一个 JSON 对象，不要 Markdown、不要解释。';
    const userPrompt = `从下方纯文本（通常来自手写验光单 OCR）提取验光数据。必须只输出 JSON。

${RX_OCR_TEXT_DISTILL_RULES}

严格使用下列键名与结构（右眼 right、左眼 left）：
{"right":{"ds":"","dc":"","axis":null,"va":"","pd":null,"add":""},"left":{"ds":"","dc":"","axis":null,"va":"","pd":null,"add":""}}

文字：
"""${safe}"""`;

    const parsed = await openAIChatCompletionJson(
      this.config,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      this.config.chatModel,
    );

    return {
      right: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'right')),
      left: normalizeEye(pickEyePayloadFromTextOcrRoot(parsed, 'left')),
    };
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
