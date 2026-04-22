import { NextResponse } from 'next/server';
import { getModelTaskByContentMd5, pollTaskStatus } from '@/lib/modelTask/hunyuan3dTasks';
import { serializeModelTaskForApi } from '@/lib/modelTask/modelTaskSerialize';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 按全局主键 `content_md5`（路径参数 `id`）查询；`?poll=1` 时先同步一次腾讯云状态再返回。
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const shouldPoll = url.searchParams.get('poll') === '1' || url.searchParams.get('poll') === 'true';

    const row = await getModelTaskByContentMd5(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 });
    }

    let latest = row;
    if (shouldPoll) {
      const updated = await pollTaskStatus(row.taskId).catch(() => null);
      if (updated) latest = updated;
    }

    return NextResponse.json({ ok: true, data: serializeModelTaskForApi(latest) });
  } catch (e) {
    const message = e instanceof Error ? e.message : '查询失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
