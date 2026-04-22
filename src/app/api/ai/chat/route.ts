import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOpenAiCompatibleApiKey, getOpenAiCompatibleBaseUrl } from '@/lib/aiApiCredentials';
import { getCloudRestServiceKey, getCloudRestUrl } from '@/lib/cloudRest';

export const runtime = 'nodejs';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function maskText(v: string): string {
  return v
    .replace(/\b1\d{10}\b/g, '1**********')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '***@***');
}

function checkRateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const item = rateBucket.get(key);
  if (!item || now > item.resetAt) {
    rateBucket.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remain: limit - 1 };
  }
  if (item.count >= limit) return { ok: false, remain: 0 };
  item.count += 1;
  return { ok: true, remain: limit - item.count };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      history?: ChatMessage[];
      userTag?: string;
      mode?: 'free' | 'business';
    };
    const message = (body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const userTag = (body.userTag || '').trim();
    const mode = body.mode === 'business' ? 'business' : 'free';
    const tokenFromHeader = req.headers.get('x-client-token') || '';
    const expectedToken = process.env.MINIPROGRAM_CHAT_TOKEN || '';
    if (!expectedToken) {
      return NextResponse.json({ error: '服务端未配置 MINIPROGRAM_CHAT_TOKEN' }, { status: 500 });
    }
    if (tokenFromHeader !== expectedToken) {
      return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
    }

    if (!message) {
      return NextResponse.json({ error: 'message 不能为空' }, { status: 400 });
    }
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const limitKey = `${userTag || 'anonymous'}:${clientIp}`;
    const limited = checkRateLimit(limitKey, Number(process.env.AI_CHAT_RATE_LIMIT || 20), 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
    }

    const apiKey = getOpenAiCompatibleApiKey();
    const baseUrl = getOpenAiCompatibleBaseUrl();
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!apiKey) {
      return NextResponse.json(
        { error: '服务端未配置 OPENAI_API_KEY 或 AI_API_KEY' },
        { status: 500 },
      );
    }

    const systemPrompt =
      mode === 'business'
        ? '你是「镜售」小程序 AI 助手（门店模式）。只回答与门店经营相关问题：下单、验光、库存、门店、售后、报表。非相关问题请礼貌拒答并引导回业务话题。'
        : '你是一个通用 AI 助手（自由模式）。直接回答用户问题，不主动引导到眼镜门店业务，不额外加入行业话术。';

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt + (userTag ? ` 当前用户标识: ${userTag}` : '') },
      ...history.slice(-10),
      { role: 'user', content: message },
    ];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json({ error: `上游模型接口失败: ${errText}` }, { status: 502 });
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content?.trim() || '抱歉，我暂时无法回答，请稍后再试。';

    const logEnabled = (process.env.AI_CHAT_LOG_ENABLED || 'true') === 'true';
    if (logEnabled) {
      const url = getCloudRestUrl();
      const service = getCloudRestServiceKey();
      if (url && service) {
        const sb = createClient(url, service, { auth: { persistSession: false } });
        await sb.from('ai_chat_logs').insert({
          user_tag: userTag || null,
          source: 'miniprogram',
          prompt: maskText(message),
          answer: maskText(answer),
          ip: clientIp,
        });
      }
    }
    return NextResponse.json({ answer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

