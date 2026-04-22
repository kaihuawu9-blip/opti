import type { VisionImagePayload } from '../types';

/** 方舟 / 通义兼容 OpenAI Chat Completions 的多模态 content 片段 */
export function userContentWithImage(
  text: string,
  payload: VisionImagePayload,
): Array<{ type: string; text?: string; image_url?: { url: string } }> {
  return [
    {
      type: 'image_url',
      image_url: { url: payload.dataUrl },
    },
    { type: 'text', text },
  ];
}

export type ChatCompletionsRequest = {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | ReturnType<typeof userContentWithImage>;
  }>;
  temperature?: number;
  max_tokens?: number;
};

export async function postChatCompletions(
  baseUrl: string,
  apiKey: string,
  body: ChatCompletionsRequest,
): Promise<{ content: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`视觉 API HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('视觉 API 返回非 JSON');
  }

  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('视觉 API 未返回文本内容');
  }
  return { content };
}
