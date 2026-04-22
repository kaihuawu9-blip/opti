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

function normalizeEye(value: unknown): StandardEye {
  const x = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    ds: asString(x.ds),
    dc: asString(x.dc),
    axis: parseMaybeNumber(x.axis),
    va: asString(x.va),
    pd: parseMaybeNumber(x.pd),
    add: asString(x.add),
  };
}

function normalizeRxOcrResult(value: unknown): StandardRxOcrResult {
  const x = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const right = normalizeEye(x.right);
  const left = normalizeEye(x.left);
  return {
    right,
    left,
    customerName: asString(x.customerName),
    date: asString(x.date),
    technician: asString(x.technician),
    notes: asString(x.notes),
    pd: parseMaybeNumber(x.pd) ?? right.pd ?? left.pd,
  };
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
  const baseUrl = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || defaultBaseUrl).trim().replace(/\/$/, '');
  const apiKey = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const chatModel = (process.env.AI_CHAT_MODEL || process.env.OPENAI_MODEL || process.env.DOUBAO_MODEL || 'gpt-4o-mini').trim();
  const visionModel = (process.env.AI_VISION_MODEL || process.env.OPENAI_MODEL_VISION || chatModel).trim();
  const speechModel = (process.env.AI_SPEECH_MODEL || process.env.OPENAI_WHISPER_MODEL || 'whisper-1').trim();

  if (!apiKey) {
    throw new Error('服务端未配置 AI_API_KEY（或 OPENAI_API_KEY）');
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
3) axis 只保留数字，不带 °。
4) pd 保留数字（可含小数点），不要带 mm。`;

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
