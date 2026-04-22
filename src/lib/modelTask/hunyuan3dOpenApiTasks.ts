import 'server-only';

import { ModelTaskStatus, type ModelTask, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withHunyuan3dCreateSlot } from '@/lib/modelTask/createConcurrency';
import {
  normalizeImageContentMd5,
  tryComputeMd5FromImageUrl,
} from '@/lib/modelTask/hunyuan3dTasks';
import { getMaxPollAttempts } from '@/lib/modelTask/pollConfig';
import { resolveImageUrlForHunyuan3dFetch } from '@/lib/oss/hunyuan3dOssImageUrl';
import { openApiQuery3DJob, openApiSubmitImageTo3D } from '@/lib/tencent/tencentAi3dOpenApi';

/** OpenAPI 轮询间隔（秒级）；`/api/generate-3d` 已改走 ai3d.tencentcloudapi.com TC3 接口。 */
export const GENERATE_3D_POLL_INTERVAL_MS = 1500;

type File3D = { Type?: string; Url?: string };

function extractRemoteTaskId(res: Record<string, unknown>): string {
  const v = res.TaskId ?? res.JobId;
  if (typeof v === 'string' && v.trim()) return v.trim();
  throw new Error('OpenAPI 响应缺少 TaskId/JobId');
}

function extractGlbUrl(res: Record<string, unknown>): string | null {
  const files = res.ResultFile3Ds;
  if (!Array.isArray(files) || files.length === 0) return null;
  const typed = files as File3D[];
  const glb =
    typed.find((f) => (f.Type || '').toUpperCase() === 'GLB' && f.Url) ||
    typed.find((f) => typeof f.Url === 'string' && /\.glb(\?|$)/i.test(f.Url));
  if (glb?.Url) return glb.Url;
  const first = typed.find((f) => f.Url);
  return typeof first?.Url === 'string' ? first.Url : null;
}

function mapTencentStatus(status: string | undefined): ModelTaskStatus | null {
  const s = (status || '').toUpperCase();
  if (s === 'DONE' || s === 'SUCCESS') return ModelTaskStatus.SUCCESS;
  if (s === 'FAIL' || s === 'FAILED') return ModelTaskStatus.FAIL;
  if (s === 'WAIT' || s === 'RUN' || s === 'RUNNING' || s === 'PENDING' || s === '') return ModelTaskStatus.PENDING;
  return ModelTaskStatus.PENDING;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

async function findCachedSuccessModelTask(
  trimmedUrl: string | null,
  contentMd5: string | null,
): Promise<ModelTask | null> {
  if (contentMd5) {
    const row = await prisma.modelTask.findUnique({ where: { contentMd5 } });
    if (row?.status === ModelTaskStatus.SUCCESS && row.modelUrl) return row;
  }
  if (!trimmedUrl) return null;
  return prisma.modelTask.findFirst({
    where: {
      imageUrl: trimmedUrl,
      status: ModelTaskStatus.SUCCESS,
      modelUrl: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function findPendingJoinModelTask(
  trimmedUrl: string | null,
  contentMd5: string | null,
): Promise<ModelTask | null> {
  if (contentMd5) {
    const row = await prisma.modelTask.findUnique({ where: { contentMd5 } });
    if (row?.status === ModelTaskStatus.PENDING) return row;
  }
  if (!trimmedUrl) return null;
  return prisma.modelTask.findFirst({
    where: { imageUrl: trimmedUrl, status: ModelTaskStatus.PENDING },
    orderBy: { createdAt: 'asc' },
  });
}

export type ResolveModelTaskKind = 'CACHE_SUCCESS' | 'JOIN_PENDING' | 'NEW';

/**
 * 与 `resolveOrCreate3DModelTask` 相同缓存语义，但创建任务走 OpenAPI（TENCENT_API_KEY）且固定 Lite 模型。
 */
export async function resolveOrCreate3DModelTaskOpenApi(
  imageUrl: string,
  options?: { imageContentMd5?: string | null },
): Promise<{ row: ModelTask; kind: ResolveModelTaskKind }> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new Error('imageUrl 不能为空');
  }
  const fetchUrlForMd5 = await resolveImageUrlForHunyuan3dFetch(trimmed);
  let resolvedMd5 = normalizeImageContentMd5(options?.imageContentMd5);
  if (!resolvedMd5) {
    resolvedMd5 = await tryComputeMd5FromImageUrl(fetchUrlForMd5);
  }
  if (!resolvedMd5) {
    throw new Error('无法确定图片内容 MD5：请使用本地上传或提供 imageContentMd5');
  }

  const cachedSuccess = await findCachedSuccessModelTask(trimmed, resolvedMd5);
  if (cachedSuccess) {
    return { row: cachedSuccess, kind: 'CACHE_SUCCESS' };
  }

  const pendingJoin = await findPendingJoinModelTask(trimmed, resolvedMd5);
  if (pendingJoin) {
    return { row: pendingJoin, kind: 'JOIN_PENDING' };
  }

  return await withHunyuan3dCreateSlot(async () => {
    const s2 = await findCachedSuccessModelTask(trimmed, resolvedMd5);
    if (s2) return { row: s2, kind: 'CACHE_SUCCESS' as const };

    const p2 = await findPendingJoinModelTask(trimmed, resolvedMd5);
    if (p2) return { row: p2, kind: 'JOIN_PENDING' as const };

    const fetchUrlForTencent = await resolveImageUrlForHunyuan3dFetch(trimmed);
    const res = await openApiSubmitImageTo3D(fetchUrlForTencent);
    const remoteId = extractRemoteTaskId(res);

    try {
      const row = await prisma.modelTask.create({
        data: {
          contentMd5: resolvedMd5,
          taskId: remoteId,
          imageUrl: trimmed,
          status: ModelTaskStatus.PENDING,
        },
      });
      return { row, kind: 'NEW' as const };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await prisma.modelTask.findUnique({ where: { contentMd5: resolvedMd5 } });
      if (!existing) throw e;
      if (existing.status === ModelTaskStatus.SUCCESS && existing.modelUrl) {
        return { row: existing, kind: 'CACHE_SUCCESS' as const };
      }
      return { row: existing, kind: 'JOIN_PENDING' as const };
    }
  });
}

export async function pollTaskStatusOpenApi(remoteTaskId: string): Promise<ModelTask | null> {
  const existing = await prisma.modelTask.findUnique({ where: { taskId: remoteTaskId } });
  if (!existing) return null;

  const res = await openApiQuery3DJob(remoteTaskId);
  const statusRaw = (res.Status as string | undefined) || (res.TaskStatus as string | undefined);
  let mapped = mapTencentStatus(statusRaw);
  const errCode = typeof res.ErrorCode === 'string' ? res.ErrorCode.trim() : '';

  if (mapped === ModelTaskStatus.PENDING && errCode && statusRaw?.toUpperCase() === 'FAIL') {
    mapped = ModelTaskStatus.FAIL;
  }

  const modelUrl = mapped === ModelTaskStatus.SUCCESS ? extractGlbUrl(res) : null;

  let nextStatus = mapped ?? ModelTaskStatus.PENDING;
  if (mapped === ModelTaskStatus.SUCCESS && !modelUrl) {
    nextStatus = ModelTaskStatus.PENDING;
  }

  return prisma.modelTask.update({
    where: { taskId: remoteTaskId },
    data: {
      status: nextStatus,
      ...(nextStatus === ModelTaskStatus.SUCCESS && modelUrl ? { modelUrl } : {}),
      ...(nextStatus === ModelTaskStatus.FAIL ? { modelUrl: null } : {}),
    },
  });
}

/**
 * 固定间隔轮询直至终态；日志输出建模总耗时（自轮询起点至 SUCCESS/FAIL）。
 */
export async function pollUntilCompleteOpenApi(remoteTaskId: string, options?: { maxRounds?: number }) {
  const maxRounds = options?.maxRounds ?? getMaxPollAttempts();
  const pollStart = Date.now();
  const logPrefix = '[generate-3d][openApi]';

  for (let i = 0; i < maxRounds; i += 1) {
    const row = await pollTaskStatusOpenApi(remoteTaskId).catch(() => null);
    if (!row) {
      console.warn(`${logPrefix} poll 中断：未找到 taskId=${remoteTaskId}`);
      return;
    }
    if (row.status === ModelTaskStatus.SUCCESS || row.status === ModelTaskStatus.FAIL) {
      const totalMs = Date.now() - pollStart;
      console.log(
        `${logPrefix} 建模结束 taskId=${remoteTaskId} status=${row.status} 轮询总耗时_ms=${totalMs} rounds=${i + 1}`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, GENERATE_3D_POLL_INTERVAL_MS));
  }

  const totalMs = Date.now() - pollStart;
  console.warn(`${logPrefix} 轮询超时 taskId=${remoteTaskId} 总耗时_ms=${totalMs} maxRounds=${maxRounds}`);
  await prisma.modelTask.updateMany({
    where: { taskId: remoteTaskId, status: ModelTaskStatus.PENDING },
    data: { status: ModelTaskStatus.FAIL },
  });
}
