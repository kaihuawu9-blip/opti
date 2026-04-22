import { NextResponse } from 'next/server';
import { linkStoreToFrameModel } from '@/lib/modelTask/storeFrameLink';

export const runtime = 'nodejs';

/**
 * 将门店与全局镜框模型（content_md5）关联。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { storeId?: unknown; modelId?: unknown };
    const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim().toLowerCase() : '';
    if (!storeId || !modelId) {
      return NextResponse.json({ ok: false, error: 'storeId 与 modelId（content_md5）均不能为空' }, { status: 400 });
    }
    await linkStoreToFrameModel(storeId, modelId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : '关联失败';
    const status = message.includes('不存在') || message.includes('UUID') || message.includes('hex') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
