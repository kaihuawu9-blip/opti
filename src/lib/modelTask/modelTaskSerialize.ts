import type { ModelTask } from '@prisma/client';

/** API 与前端兼容字段：`id` 等同于全局主键 `contentMd5`。 */
export function serializeModelTaskForApi(row: ModelTask) {
  return {
    id: row.contentMd5,
    contentMd5: row.contentMd5,
    taskId: row.taskId,
    status: row.status,
    imageUrl: row.imageUrl,
    modelUrl: row.modelUrl,
    createdAt: row.createdAt.toISOString(),
  };
}
