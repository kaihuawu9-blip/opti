import { NextResponse } from 'next/server';
import { createAIService, type StandardEye } from '@/services/aiService';

export const runtime = 'nodejs';

function eyeToPayload(e: StandardEye): Record<string, unknown> {
  return {
    ds: e.ds,
    dc: e.dc,
    axis: e.axis,
    va: e.va,
    pd: e.pd,
    add: e.add,
  };
}

/**
 * 浏览器已直连 Paddle 拿到 rawText 后：仅走服务端豆包/OpenAI 兼容接口做结构化（密钥不出浏览器）。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { rawText?: string };
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
    if (!rawText) {
      return NextResponse.json({ ok: false, error: 'rawText 不能为空' }, { status: 400 });
    }

    const eyes = await createAIService().extractRxJsonFromOcrTextLite(rawText);
    return NextResponse.json({
      ok: true,
      result: {
        right: eyeToPayload(eyes.right),
        left: eyeToPayload(eyes.left),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    const hint =
      msg.includes('OCR 文本为空')
        ? '没有可供解析的文本。请先完成 OCR 或贴入原单文字。'
        : '模型暂未能从文本中拆出双眼度数。可缩短原文、分眼分行后再试。';
    return NextResponse.json({ ok: false, error: msg, hint }, { status: 500 });
  }
}
