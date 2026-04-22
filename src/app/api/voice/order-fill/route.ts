import { NextRequest, NextResponse } from 'next/server';
import { createAIService } from '@/services/aiService';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const aiService = createAIService();

    const ctype = req.headers.get('content-type') || '';
    let transcript = '';
    let usedAudio = false;

    if (ctype.includes('application/json')) {
      const body = (await req.json()) as { text?: string };
      transcript = (body.text || '').trim();
      if (!transcript) {
        return NextResponse.json({ ok: false, error: 'text 不能为空' }, { status: 400 });
      }
    } else {
      const form = await req.formData();
      const audio = form.get('audio');
      const textField = form.get('text');
      if (typeof textField === 'string' && textField.trim()) {
        transcript = textField.trim();
      } else if (audio instanceof File && audio.size > 0) {
        usedAudio = true;
        transcript = await aiService.transcribeAudio(audio);
      } else {
        return NextResponse.json({ ok: false, error: '请上传 audio 文件或提供 text' }, { status: 400 });
      }
    }

    const result = await aiService.extractVoiceOrderFromText(transcript);
    return NextResponse.json({
      ok: true,
      transcript,
      usedAudio,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
