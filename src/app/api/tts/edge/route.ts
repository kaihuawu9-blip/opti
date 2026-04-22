import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromRequest } from '@/lib/localAuth';
import { createEdgeTtsMp3ReadableStream } from '@/lib/edgeTtsStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_VOICE = 'zh-CN-YunzeNeural';
const MAX_CHARS = 12_000;

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSessionFromRequest(req);
    const tokenFromHeader = req.headers.get('x-client-token') || '';
    const expectedToken = process.env.MINIPROGRAM_CHAT_TOKEN || '';
    const tokenMatched = Boolean(expectedToken && tokenFromHeader && tokenFromHeader === expectedToken);
    if (!session && !tokenMatched) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      text?: string;
      voice?: string;
    };
    const text = String(body.text ?? '').trim();
    if (!text) {
      return NextResponse.json({ error: 'text 不能为空' }, { status: 400 });
    }
    if (text.length > MAX_CHARS) {
      return NextResponse.json({ error: `文本过长（>${MAX_CHARS}）` }, { status: 400 });
    }

    const voiceRaw = String(body.voice ?? DEFAULT_VOICE).trim();
    const voice = /^[a-zA-Z]{2}-[a-zA-Z]{2}-[A-Za-z0-9._-]+$/.test(voiceRaw) ? voiceRaw : DEFAULT_VOICE;

    const stream = createEdgeTtsMp3ReadableStream(text, { voice });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Opti-Tts-Voice': voice,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'TTS 失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
