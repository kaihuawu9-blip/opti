import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma, ModelTaskStatus, type ModelTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { Ai3dHunyuanClient } from '@/lib/tencent/ai3dHunyuanClient';
import { withHunyuan3dCreateSlot } from '@/lib/modelTask/createConcurrency';
import { computeTieredPollDelayMs, getMaxPollAttempts } from '@/lib/modelTask/pollConfig';
import { resolveImageUrlForHunyuan3dFetch } from '@/lib/oss/hunyuan3dOssImageUrl';
import {
  getAi3dModelVersion,
  getCreate3DAction,
  getDescribe3DAction,
  getTencentCredentials,
  getTencentRegion,
} from '@/lib/tencent/hunyuan3dEnv';

const FALLBACK_CREATE_ACTION = 'SubmitHunyuanTo3DProJob';
const FALLBACK_QUERY_ACTION = 'QueryHunyuanTo3DProJob';

const MAX_FETCH_BYTES = 20 * 1024 * 1024;

function logEnvMissing() {
  console.error('环境变量未配置');
}

function getClient(): Ai3dHunyuanClient | null {
  const cred = getTencentCredentials();
  if (!cred) {
    logEnvMissing();
    return null;
  }
  try {
    return new Ai3dHunyuanClient({
      credential: { secretId: cred.secretId, secretKey: cred.secretKey },
      region: getTencentRegion(),
    });
  } catch {
    console.error('环境变量未配置');
    return null;
  }
}

function extractRemoteTaskId(res: Record<string, unknown>): string {
  const v = res.TaskId ?? res.JobId;
  if (typeof v === 'string' && v.trim()) return v.trim();
  throw new Error('腾讯云响应缺少 TaskId/JobId');
}

type File3D = { Type?: string; Url?: string };

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

function shouldSetModelVersionOnCreate(action: string): boolean {
  return (
    action === 'CreateHunyuan3DTask' ||
    action === 'SubmitHunyuanTo3DProJob' ||
    action.includes('CreateHunyuan3D') ||
    action.includes('SubmitHunyuanTo3D')
  );
}

async function requestCreate(client: Ai3dHunyuanClient, imageUrl: string, action: string): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    ImageUrl: imageUrl,
    ResultFormat: 'GLB',
  };
  if (shouldSetModelVersionOnCreate(action)) {
    body.ModelVersion = getAi3dModelVersion();
  }
  return (await client.request(action, body)) as Record<string, unknown>;
}

async function requestDescribeOnce(
  client: Ai3dHunyuanClient,
  remoteId: string,
  action: string,
): Promise<Record<string, unknown>> {
  const keys = ['JobId', 'TaskId'] as const;
  let lastErr: unknown;
  for (const key of keys) {
    try {
      const payload: Record<string, unknown> = { [key]: remoteId };
      return (await client.request(action, payload)) as Record<string, unknown>;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function requestDescribe(client: Ai3dHunyuanClient, remoteId: string, action: string): Promise<Record<string, unknown>> {
  try {
    return await requestDescribeOnce(client, remoteId, action);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (action !== FALLBACK_QUERY_ACTION && /InvalidAction|UnsupportedOperation|不存在|UnknownParameter/i.test(msg)) {
      return requestDescribeOnce(client, remoteId, FALLBACK_QUERY_ACTION);
    }
    throw e;
  }
}

/** 归一化客户端/上传接口传入的内容 MD5（32 位 hex）；非法则视为未提供。 */
export function normalizeImageContentMd5(raw: string | null | undefined): string | null {
  const s = (raw || '').trim().toLowerCase().replace(/^"|"$/g, '');
  if (!s || !/^[a-f0-9]{32}$/.test(s)) return null;
  return s;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 对公网图片 URL 拉取正文并计算 MD5（用于仅有 URL 时的主键落库）。 */
export async function tryComputeMd5FromImageUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FETCH_BYTES) return null;
    return createHash('md5').update(buf).digest('hex');
  } catch {
    return null;
  }
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

export type ModelTaskLookupHit = 'SUCCESS' | 'PENDING' | 'NONE';

/** 仅查询：用于上传后预检是否已有 GLB 或进行中的同源任务（不调用腾讯云）。 */
export async function lookupModelTaskByImageKey(input: {
  imageUrl?: string | null;
  imageContentMd5?: string | null;
}): Promise<{ hit: ModelTaskLookupHit; row: ModelTask | null }> {
  const trimmed = (input.imageUrl || '').trim() || null;
  const md5 = normalizeImageContentMd5(input.imageContentMd5);
  if (!trimmed && !md5) {
    throw new Error('需要 imageUrl 或 imageContentMd5');
  }
  const success = await findCachedSuccessModelTask(trimmed, md5);
  if (success) return { hit: 'SUCCESS', row: success };
  const pending = await findPendingJoinModelTask(trimmed, md5);
  if (pending) return { hit: 'PENDING', row: pending };
  return { hit: 'NONE', row: null };
}

export type ResolveModelTaskKind = 'CACHE_SUCCESS' | 'JOIN_PENDING' | 'NEW';

/**
 * 解析或创建 3D 任务：先按 MD5 / imageUrl 命中 SUCCESS 或合并 PENDING，否则调用腾讯云并落库。
 * 全局模型行以 content_md5 为主键；新建前若未带 MD5 会尝试拉取 imageUrl 计算。
 */
export async function resolveOrCreate3DModelTask(
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

    const client = getClient();
    if (!client) {
      throw new Error('腾讯云客户端不可用（请检查服务端环境变量）');
    }

    const fetchUrlForTencent = await resolveImageUrlForHunyuan3dFetch(trimmed);
    const preferred = getCreate3DAction();
    let res: Record<string, unknown>;
    try {
      res = await requestCreate(client, fetchUrlForTencent, preferred);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (preferred !== FALLBACK_CREATE_ACTION && /InvalidAction|UnsupportedOperation|UnknownParameter|不存在/i.test(msg)) {
        res = await requestCreate(client, fetchUrlForTencent, FALLBACK_CREATE_ACTION);
      } else {
        throw e;
      }
    }

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

/**
 * 查询远端任务并同步 Prisma：终态 SUCCESS 且拿到 GLB 地址后才写入 modelUrl。
 */
export async function pollTaskStatus(remoteTaskId: string): Promise<ModelTask | null> {
  const client = getClient();
  if (!client) return null;

  const existing = await prisma.modelTask.findUnique({ where: { taskId: remoteTaskId } });
  if (!existing) return null;

  const preferred = getDescribe3DAction();
  let res: Record<string, unknown>;
  try {
    res = await requestDescribe(client, remoteTaskId, preferred);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (preferred !== FALLBACK_QUERY_ACTION && /InvalidAction|UnsupportedOperation|UnknownParameter|不存在/i.test(msg)) {
      res = await requestDescribe(client, remoteTaskId, FALLBACK_QUERY_ACTION);
    } else {
      throw e;
    }
  }

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

/** 按主键 content_md5（接口里常作为 `id` 返回）查询。 */
export async function getModelTaskByContentMd5(contentMd5: string): Promise<ModelTask | null> {
  const key = normalizeImageContentMd5(contentMd5);
  if (!key) return null;
  return prisma.modelTask.findUnique({ where: { contentMd5: key } });
}

export async function getModelTaskByRemoteId(remoteTaskId: string): Promise<ModelTask | null> {
  return prisma.modelTask.findUnique({ where: { taskId: remoteTaskId } });
}

/**
 * 后台轮询直到终态或超时（仅服务端调用）。
 */
export async function pollUntilComplete(remoteTaskId: string, options?: { maxRounds?: number }) {
  const maxRounds = options?.maxRounds ?? getMaxPollAttempts();
  const pollStart = Date.now();
  for (let i = 0; i < maxRounds; i += 1) {
    const row = await pollTaskStatus(remoteTaskId).catch(() => null);
    if (!row) return;
    if (row.status === ModelTaskStatus.SUCCESS || row.status === ModelTaskStatus.FAIL) {
      return;
    }
    const elapsed = Date.now() - pollStart;
    const delayMs = computeTieredPollDelayMs(elapsed);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  await prisma.modelTask.updateMany({
    where: { taskId: remoteTaskId, status: ModelTaskStatus.PENDING },
    data: { status: ModelTaskStatus.FAIL },
  });
}
