import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { CreateConcurrencyBusyError } from '@/lib/modelTask/createConcurrency';
import { pollUntilComplete, resolveOrCreate3DModelTask } from '@/lib/modelTask/hunyuan3dTasks';
import { serializeModelTaskForApi } from '@/lib/modelTask/modelTaskSerialize';
import { linkStoreToFrameModel } from '@/lib/modelTask/storeFrameLink';

export const runtime = 'nodejs';

/**
 * 创建/解析混元 3D 任务（仅服务端）。`id` 为全局 content_md5。
 * 可选 `storeId`：在成功解析到模型后写入 store_frames 关联。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrl?: unknown;
      imageContentMd5?: unknown;
      storeId?: unknown;
    };
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const imageContentMd5 = typeof body.imageContentMd5 === 'string' ? body.imageContentMd5 : null;
    const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';

    const { row, kind } = await resolveOrCreate3DModelTask(imageUrl, { imageContentMd5 });

    if (storeId) {
      try {
        await linkStoreToFrameModel(storeId, row.contentMd5);
      } catch (linkErr) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        return NextResponse.json({ ok: false, error: `门店关联失败：${msg}` }, { status: 400 });
      }
    }

    if (kind !== 'CACHE_SUCCESS') {
      after(() => {
        void pollUntilComplete(row.taskId);
      });
    }

    return NextResponse.json({
      ok: true,
      data: serializeModelTaskForApi(row),
      meta: {
        source: kind,
        modelReady: kind === 'CACHE_SUCCESS',
        joinPending: kind === 'JOIN_PENDING',
      },
    });
  } catch (e) {
    if (e instanceof CreateConcurrencyBusyError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 429 });
    }
    const message = e instanceof Error ? e.message : '创建任务失败';
    const status =
      message.includes('不能为空') || message.includes('无法确定图片') || message.includes('MD5')
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
