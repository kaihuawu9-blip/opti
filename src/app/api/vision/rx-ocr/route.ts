import { NextRequest, NextResponse } from 'next/server';
import { createAIService } from '@/services/aiService';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '未上传图片' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: '仅支持图片文件' }, { status: 400 });
    }

    const aiService = createAIService();
    const result = await aiService.recognizePrescriptionFromImage(file);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
