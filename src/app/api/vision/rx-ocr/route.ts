import { NextRequest, NextResponse } from 'next/server';
import { createAIService } from '@/services/aiService';
import { parseRxOcrImageFile } from './parseImageFile';

export async function POST(req: NextRequest) {
  try {
    const file = await parseRxOcrImageFile(req);
    const aiService = createAIService();
    const result = await aiService.recognizePrescriptionFromImage(file);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    const status = /未上传|缺少|仅支持|解码为空/.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
