'use server';

import {
  getModelTaskByContentMd5,
  pollTaskStatus,
  pollUntilComplete,
  resolveOrCreate3DModelTask,
} from '@/lib/modelTask/hunyuan3dTasks';
import { linkStoreToFrameModel } from '@/lib/modelTask/storeFrameLink';

/** 服务端发起 3D 任务并后台轮询（勿在含密钥的模块中 `import` 客户端组件）。 */
export async function createModelTaskFromImage(
  imageUrl: string,
  imageContentMd5?: string | null,
  storeId?: string | null,
) {
  const { row, kind } = await resolveOrCreate3DModelTask(imageUrl, { imageContentMd5 });
  const sid = typeof storeId === 'string' ? storeId.trim() : '';
  if (sid) {
    await linkStoreToFrameModel(sid, row.contentMd5);
  }
  if (kind !== 'CACHE_SUCCESS') {
    void pollUntilComplete(row.taskId);
  }
  return {
    id: row.contentMd5,
    contentMd5: row.contentMd5,
    taskId: row.taskId,
    status: row.status,
    imageUrl: row.imageUrl,
    modelUrl: row.modelUrl,
    createdAt: row.createdAt.toISOString(),
    source: kind,
    modelReady: kind === 'CACHE_SUCCESS',
    joinPending: kind === 'JOIN_PENDING',
  };
}

export async function getModelTaskSnapshot(contentMd5: string, options?: { poll?: boolean }) {
  const row = await getModelTaskByContentMd5(contentMd5);
  if (!row) return null;
  let latest = row;
  if (options?.poll) {
    const updated = await pollTaskStatus(row.taskId).catch(() => null);
    if (updated) latest = updated;
  }
  return {
    id: latest.contentMd5,
    contentMd5: latest.contentMd5,
    taskId: latest.taskId,
    status: latest.status,
    imageUrl: latest.imageUrl,
    modelUrl: latest.modelUrl,
    createdAt: latest.createdAt.toISOString(),
  };
}
