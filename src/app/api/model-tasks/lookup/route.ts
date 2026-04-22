import { NextResponse } from 'next/server';
import { lookupModelTaskByImageKey } from '@/lib/modelTask/hunyuan3dTasks';
import { serializeModelTaskForApi } from '@/lib/modelTask/modelTaskSerialize';

export const runtime = 'nodejs';

/**
 * 预查询：按 imageUrl / 内容 MD5 查找是否已有 SUCCESS（含 GLB）或进行中的 PENDING。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { imageUrl?: unknown; imageContentMd5?: unknown };
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const imageContentMd5 = typeof body.imageContentMd5 === 'string' ? body.imageContentMd5 : undefined;
    const { hit, row } = await lookupModelTaskByImageKey({ imageUrl, imageContentMd5 });
    return NextResponse.json({
      ok: true,
      hit,
      data: row ? serializeModelTaskForApi(row) : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : '查询失败';
    const status = message.includes('需要 imageUrl') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
