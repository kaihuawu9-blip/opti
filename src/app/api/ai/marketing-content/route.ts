import { NextRequest, NextResponse } from 'next/server';
import { getOpenAiCompatibleApiKey, getOpenAiCompatibleBaseUrl } from '@/lib/aiApiCredentials';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type ProductRow = {
  id: string;
  name: string | null;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
};

type ImageCandidate = { index: number; url: string; label: string };

const WEB_POSTER_FALLBACKS: string[] = [
  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Glasses_800_edit.png/440px-Glasses_800_edit.png',
];

function joinAttrs(product: ProductRow): string {
  const attrs = [
    product.description,
    product.category,
    product.brand,
    product.model,
    product.frame_type,
    product.lens_type,
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return attrs.length ? attrs.join('、') : '未补充详细属性';
}

function extractJsonObject(content: string): string {
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  if (s >= 0 && e > s) return content.slice(s, e + 1);
  return content.trim();
}

function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseEnvImageUrls(): string[] {
  const raw = (process.env.MARKETING_STOCK_IMAGE_URLS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(isHttpsUrl);
}

async function buildImageCandidates(): Promise<ImageCandidate[]> {
  const out: ImageCandidate[] = [];

  // 当前数据库 products 表不包含 image_url，库存图仅从环境变量与开源示意图来源获取。

  for (const url of parseEnvImageUrls()) {
    out.push({
      index: out.length,
      url,
      label: '[配置图库]',
    });
  }

  const start = out.length;
  for (let i = 0; i < WEB_POSTER_FALLBACKS.length; i++) {
    const url = WEB_POSTER_FALLBACKS[i];
    if (!isHttpsUrl(url)) continue;
    out.push({
      index: start + i,
      url,
      label: `[开放版权示意图${i + 1}]`,
    });
  }

  if (out.length === 0 && WEB_POSTER_FALLBACKS[0]) {
    out.push({ index: 0, url: WEB_POSTER_FALLBACKS[0], label: '[默认示意图]' });
  }

  out.forEach((c, i) => {
    c.index = i;
  });
  return out;
}

function candidateListForPrompt(candidates: ImageCandidate[]): string {
  return candidates.map((c) => `${c.index}. ${c.label}\n   URL: ${c.url}`).join('\n');
}

/** OpenAI 兼容 /v1/images/generations，返回 data:image/png;base64,... */
async function generateSceneImageDataUrl(
  apiKey: string,
  baseUrl: string,
  imageModel: string,
  prompt: string,
): Promise<string | null> {
  const trimmed = prompt.trim().slice(0, 3800);
  if (!trimmed) return null;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/images/generations`;
  const body: Record<string, unknown> = {
    model: imageModel,
    prompt: trimmed,
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await resp.text();
  if (!resp.ok) {
    console.warn('[marketing-content] images/generations failed:', raw.slice(0, 400));
    return null;
  }
  try {
    const j = JSON.parse(raw) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return null;
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

/** 无专用文生图模型时的插画场景（可关：MARKETING_DISABLE_POLLINATIONS=1） */
function pollinationsSceneUrl(sceneImagePrompt: string): string | null {
  if ((process.env.MARKETING_DISABLE_POLLINATIONS || '').trim() === '1') return null;
  const base =
    'flat vector editorial illustration, candid slice-of-life moment, asymmetric composition, each person clearly different pose and gesture, no copy-paste symmetry, stylized cartoon adults, no celebrity faces, no readable brand logos, warm natural lighting, ';
  const q = `${base}${sceneImagePrompt}`.trim().slice(0, 900);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}?width=768&height=432&nologo=true`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      productId?: string;
      productName?: string;
      productFeatures?: string;
      platform?: 'weibo' | 'toutiao' | 'xiaohongshu' | '';
      autoSelectPlatform?: boolean;
      hotTopic?: string;
      note?: string;
    };
    const productId = (body.productId || '').trim();
    const productNameInput = (body.productName || '').trim();
    const productFeaturesInput = (body.productFeatures || '').trim();
    const note = (body.note || '').trim();
    const platformFixed = (body.platform || '').trim() as '' | 'weibo' | 'toutiao' | 'xiaohongshu';
    const autoSelect =
      body.autoSelectPlatform === true || (!platformFixed && body.autoSelectPlatform !== false);
    const hotTopic = (body.hotTopic || '').trim();
    if (!autoSelect && !platformFixed) {
      return NextResponse.json(
        { ok: false, error: '未指定 platform 时请将 autoSelectPlatform 设为 true' },
        { status: 400 },
      );
    }
    if (!productId && !productNameInput && !productFeaturesInput && !note) {
      return NextResponse.json(
        { ok: false, error: '请填写补充说明，或提供 productId / 商品名 / 特性之一' },
        { status: 400 },
      );
    }

    const apiKey = getOpenAiCompatibleApiKey();
    const baseUrl = getOpenAiCompatibleBaseUrl();
    const model = (process.env.DOUBAO_MODEL_ID || process.env.OPENAI_MODEL || '').trim();
    const imageModel = (process.env.POSTER_SCENE_IMAGE_MODEL || '').trim();

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: '服务端未配置 OPENAI_API_KEY 或 AI_API_KEY' },
        { status: 500 },
      );
    }
    if (!model) {
      return NextResponse.json(
        { ok: false, error: '服务端未配置 DOUBAO_MODEL_ID 或 OPENAI_MODEL' },
        { status: 500 },
      );
    }

    const candidates = await buildImageCandidates();

    let product: ProductRow | null = null;
    if (productId) {
      product = (await prisma.products.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
        },
      })) as ProductRow | null;
      if (!product) {
        return NextResponse.json({ ok: false, error: '商品不存在' }, { status: 404 });
      }
    }

    const productName = product?.name || productNameInput || '当季主推镜框';
    const productFeaturesBase = product
      ? joinAttrs(product)
      : productFeaturesInput || '轻量、防蓝光、通勤百搭';
    const noteHasOrg =
      Boolean(note && /(集团|公司|企业|有限|控股|实业)/.test(note));
    const orgSceneHint = noteHasOrg
      ? '\n【插画硬性要求】场景背景（牌匾/背板/大屏/横幅等）须出现与店主输入**完全一致**的企业或集团中文名称，与聚会/喝酒/团建氛围一体，勿用模糊不可读字样替代。'
      : '';
    const userPrompt = `商品名：${productName}\n特性：${productFeaturesBase}${note ? `\n店主给出的场景/主题（正文与插画必须回扣这里）：${note}${orgSceneHint}` : ''}`;

    const topicHint =
      hotTopic ||
      '热点取材优先级：① **护眼/眼镜/近视/干眼/屏幕蓝光/儿童视力** 等眼健康相关新闻或科普梗；② 若无合适眼类话题，再用**近期热播剧、综艺、社会热议新闻**里可借题发挥的一条（需像真实 2025–2026 年大众讨论语境，勿编造具体未播出剧情细节）。将热点关键词写进 posterText。';

    const copyInstruction = `海报文案要求（重要，海报上以**极小水印区**展示，必须极短）：
1) title：**最多 14 个汉字**，吸睛、可幽默，无标点堆砌。
2) posterText：**整段最多 46 个汉字（含标点）**，必须一笔点到：（a）店主场景或默认门店场景；（b）上一条热点里的**一个具体梗**（剧名/新闻关键词即可，勿长篇复述）；（c）一句眼镜卖点 + 「镜售AI」。语气紧凑，像朋友圈配图一句文案。
3) hotspot：仍填热点摘要 8～20 字，供标签用。
4) imageConcept 必须写完整：scene 用 40~120 字描述构图、景别、主体与文字水印位置；elements 返回 4~8 个具体元素（人物动作/道具/背景标识/镜框细节）；style 用 20~60 字描述视觉风格与笔触；colorTone 用 12~40 字描述主辅色与明暗关系。
5) 不要输出任何投放平台分析。`;

    const sceneInstruction = `5) sceneImagePrompt：用**英文**写一段插画场景描述（100～260 词），必须与店主输入场景一致（团建、喝酒、办公室等）。**品牌/公司名与背景（重要）**：若店主输入里出现**公司、集团、品牌名**（例如「66集团」「XX科技」），插画**背景环境中必须出现与之一致的文字**，让读者一眼能联想到该主体——可选：宴会厅入口牌匾、舞台背板、投影幕/大屏上的字样、玻璃门腰线贴字、前台立体字、横幅条幅等；用**插画化字体**绘制，**中文名称须与店主原文一致**（如用户写「66集团」则画面里就要有清晰可读的「66集团」四字），与喝酒/聚会/办公氛围统一。**禁止**画与用户无关的其它真实商业 LOGO。若店主**未**提供任何公司名，则背景不要凭空编造企业招牌。**人物动作（极其重要）**：多人时每人姿态、手势、视线须不同，禁止复制粘贴同一举杯角度；略不对称构图。**风格**：现代扁平/矢量插画。**禁止**：真实名人脸、血腥暴力、过度裸露。
6) 主图候选列表用于「插画失败或关闭在线插画」时的备用眼镜商品图。请根据热点与商品选出 selectedImageIndex。`;

    const jsonShape = `{"sceneImagePrompt":"","title":"","posterText":"","hotspot":"","copywriting":"","sellingPoints":[],"hashtags":[],"selectedImageIndex":0,"imageConcept":{"scene":"","elements":[],"style":"","colorTone":""}}`;

    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是眼镜店营销与视觉创意总监。${copyInstruction}
${sceneInstruction}
其他：copywriting 可与 posterText 接近；文案口语化；只返回 JSON，键必须齐全。格式严格为：${jsonShape}`,
          },
          {
            role: 'user',
            content: `热点方向提示：${topicHint}\n\n${userPrompt}\n\n--- 备用眼镜商品图（selectedImageIndex） ---\n${candidateListForPrompt(candidates)}`,
          },
        ],
      }),
    });

    const raw = await resp.text();
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `上游模型接口失败: ${raw}` }, { status: 502 });
    }

    let content = '';
    try {
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
      content = data?.choices?.[0]?.message?.content?.trim() || '';
    } catch {
      return NextResponse.json({ ok: false, error: '模型返回格式异常' }, { status: 502 });
    }
    if (!content) {
      return NextResponse.json({ ok: false, error: '模型未返回内容' }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch {
      return NextResponse.json({ ok: false, error: '模型返回 JSON 不可解析' }, { status: 502 });
    }

    const data = parsed as Record<string, unknown>;
    const scenePrompt = String(data.sceneImagePrompt || '').trim();

    const idxRaw = data.selectedImageIndex;
    const idx = typeof idxRaw === 'number' ? idxRaw : Number.parseInt(String(idxRaw), 10);
    const safeIdx =
      Number.isFinite(idx) && idx >= 0 && idx < candidates.length ? Math.floor(idx) : 0;
    const fallbackPosterImageUrl = candidates[safeIdx]?.url || candidates[0]?.url || '';

    let posterImageDataUrl: string | null = null;
    let posterImageUrl = '';

    if (imageModel && scenePrompt) {
      posterImageDataUrl = await generateSceneImageDataUrl(apiKey, baseUrl, imageModel, scenePrompt);
    }
    if (posterImageDataUrl) {
      posterImageUrl = '';
    } else {
      const pollUrl = scenePrompt ? pollinationsSceneUrl(scenePrompt) : null;
      if (pollUrl) {
        posterImageUrl = pollUrl;
      } else {
        posterImageUrl = fallbackPosterImageUrl;
      }
    }

    return NextResponse.json({
      ok: true,
      productId: productId || null,
      posterImageUrl: posterImageUrl || undefined,
      posterImageDataUrl: posterImageDataUrl || undefined,
      /** 插画 URL 加载失败时前端可回退到眼镜商品图 */
      posterImageFallbackUrl: fallbackPosterImageUrl || undefined,
      imagePickIndex: safeIdx,
      imageCandidatesCount: candidates.length,
      sceneImageProvider: posterImageDataUrl
        ? 'api'
        : posterImageUrl.includes('pollinations.ai')
          ? 'pollinations'
          : 'fallback_product',
      data: parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
