import 'server-only';

import { prisma } from '@/lib/prisma';

/** 记录门店与全局镜框模型（content_md5）的关联；幂等 upsert。 */
export async function linkStoreToFrameModel(storeId: string, modelContentMd5: string): Promise<void> {
  const sid = storeId.trim();
  const mid = modelContentMd5.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    throw new Error('storeId 不是有效的 UUID');
  }
  if (!/^[a-f0-9]{32}$/.test(mid)) {
    throw new Error('modelId 应为 32 位 hex 的 content_md5');
  }
  const store = await prisma.stores.findUnique({ where: { id: sid } });
  if (!store) {
    throw new Error('门店不存在');
  }
  await prisma.storeFrame.upsert({
    where: { storeId_modelId: { storeId: sid, modelId: mid } },
    create: { storeId: sid, modelId: mid },
    update: {},
  });
}
