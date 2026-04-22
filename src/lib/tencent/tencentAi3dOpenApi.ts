/** 混元生 3D OpenAI 兼容网关（API Key），与云 API 3.0 签名（SecretId/Key）二选一。 */

const DEFAULT_AI3D_OPENAPI_BASE = 'https://api.ai3d.cloud.tencent.com';

/** 网关根地址，默认 `https://api.ai3d.cloud.tencent.com`；覆盖：`TENCENT_AI3D_OPENAPI_BASE`。 */
export function getTencentAi3dOpenApiBase(): string {
  const b = (process.env.TENCENT_AI3D_OPENAPI_BASE || DEFAULT_AI3D_OPENAPI_BASE).trim();
  return (b.replace(/\/$/, '') || DEFAULT_AI3D_OPENAPI_BASE).replace(/\/$/, '');
}

/**
 * 提交任务完整 URL，默认 `{base}/v1/ai3d/submit`；
 * 覆盖：`TENCENT_AI3D_OPENAPI_SUBMIT_URL`（例如 `https://api.ai3d.cloud.tencent.com/v1/ai3d/submit`）。
 */
export function getTencentAi3dOpenApiSubmitUrl(): string {
  const u = (process.env.TENCENT_AI3D_OPENAPI_SUBMIT_URL || '').trim();
  if (u) return u;
  return `${getTencentAi3dOpenApiBase()}/v1/ai3d/submit`;
}

/**
 * 查询任务完整 URL，默认 `{base}/v1/ai3d/query`；
 * 覆盖：`TENCENT_AI3D_OPENAPI_QUERY_URL`。
 */
export function getTencentAi3dOpenApiQueryUrl(): string {
  const u = (process.env.TENCENT_AI3D_OPENAPI_QUERY_URL || '').trim();
  if (u) return u;
  return `${getTencentAi3dOpenApiBase()}/v1/ai3d/query`;
}

/**
 * OpenAPI `/v1/ai3d/submit` 的 Model 仅支持文档列出的 **`3.0` | `3.1`**（云端会拒绝 `Hunyuan3D-Lite` 等字符串）。
 * 默认 `3.0`；可通过 `TENCENT_AI3D_OPENAPI_MODEL=3.1` 切换。
 */
export type TencentAi3dOpenApiModel = '3.0' | '3.1';

export function getAi3dOpenApiModel(): TencentAi3dOpenApiModel {
  const v = (process.env.TENCENT_AI3D_OPENAPI_MODEL || '3.0').trim();
  return v === '3.1' ? '3.1' : '3.0';
}

export class TencentAi3dOpenApiError extends Error {
  readonly httpStatus: number;
  readonly remoteCode?: string;

  constructor(message: string, httpStatus: number, remoteCode?: string) {
    super(message);
    this.name = 'TencentAi3dOpenApiError';
    this.httpStatus = httpStatus;
    this.remoteCode = remoteCode;
  }

  isAuthError(): boolean {
    if (this.httpStatus === 401) return true;
    const c = (this.remoteCode || '').toLowerCase();
    return c.includes('authfailure') || c === 'unauthorized';
  }
}

export function getTencentApiKey(): string | null {
  const k = (process.env.TENCENT_API_KEY || '').trim();
  return k || null;
}

function unwrapResponse<T extends Record<string, unknown>>(json: T): Record<string, unknown> {
  const inner = json.Response;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return json;
}

function readRemoteErrorCode(body: Record<string, unknown>): string | undefined {
  const err = body.Error ?? body.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const code = (err as { Code?: unknown; code?: unknown }).Code ?? (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  if (typeof body.code === 'string' && body.code.trim()) return body.code.trim();
  return undefined;
}

function readRemoteMessage(body: Record<string, unknown>): string | undefined {
  const err = body.Error ?? body.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const msg = (err as { Message?: unknown; message?: unknown }).Message ?? (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return undefined;
}

export function isAuthFailureResponse(httpStatus: number, parsed: unknown): boolean {
  if (httpStatus === 401) return true;
  if (!parsed || typeof parsed !== 'object') return false;
  const body = unwrapResponse(parsed as Record<string, unknown>);
  const code = (readRemoteErrorCode(body) || '').toLowerCase();
  const msg = (readRemoteMessage(body) || '').toLowerCase();
  if (code.includes('authfailure')) return true;
  if (msg.includes('authfailure')) return true;
  if (code === 'unauthorized') return true;
  return false;
}

export function formatApiKeyConfigError(): string {
  return 'API KEY 配置错误：请检查环境变量 TENCENT_API_KEY（控制台混元 API Key）是否有效、未过期且未多余空格。';
}

function authHeaderValue(apiKey: string): string {
  const t = apiKey.trim();
  if (/^(Bearer|bearer)\s+/i.test(t)) return t;
  return t.startsWith('sk-') ? t : `Bearer ${t}`;
}

async function postJson(url: string, apiKey: string, payload: Record<string, unknown>): Promise<{
  httpStatus: number;
  json: Record<string, unknown>;
  text: string;
}> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeaderValue(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { _parseError: true, _raw: text.slice(0, 500) };
  }
  return { httpStatus: res.status, json, text };
}

function hasResponseError(body: Record<string, unknown>): boolean {
  const err = body.Error ?? body.error;
  return Boolean(err && typeof err === 'object');
}

/** 解析 HTTP 200 但包体带 `Response.Error` 的业务失败（测试脚本等可复用）。 */
export function readTencentOpenApiBusinessError(parsed: unknown): { code: string; message: string } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const body = unwrapResponse(parsed as Record<string, unknown>);
  if (!hasResponseError(body)) return null;
  return {
    code: readRemoteErrorCode(body) || 'Unknown',
    message: readRemoteMessage(body) || '',
  };
}

function throwIfAuthOrError(httpStatus: number, json: Record<string, unknown>, text: string, label: string): void {
  if (isAuthFailureResponse(httpStatus, json)) {
    throw new TencentAi3dOpenApiError(formatApiKeyConfigError(), httpStatus, readRemoteErrorCode(unwrapResponse(json)));
  }
  const body = unwrapResponse(json);
  if (hasResponseError(body)) {
    const code = readRemoteErrorCode(body);
    const msg = readRemoteMessage(body) || text.slice(0, 400);
    if (isAuthFailureResponse(httpStatus, json)) {
      throw new TencentAi3dOpenApiError(formatApiKeyConfigError(), httpStatus || 401, code);
    }
    throw new TencentAi3dOpenApiError(`${label} 失败${code ? ` [${code}]` : ''}: ${msg}`, httpStatus || 502, code);
  }
  if (!httpStatus || httpStatus >= 400) {
    const code = readRemoteErrorCode(body);
    const msg = readRemoteMessage(body) || text.slice(0, 400);
    throw new TencentAi3dOpenApiError(`${label} 失败 HTTP ${httpStatus}${code ? ` [${code}]` : ''}: ${msg}`, httpStatus, code);
  }
}

export async function openApiSubmitImageTo3D(imageUrl: string): Promise<Record<string, unknown>> {
  const apiKey = getTencentApiKey();
  if (!apiKey) {
    throw new TencentAi3dOpenApiError(formatApiKeyConfigError(), 401, 'MissingKey');
  }
  const payload: Record<string, unknown> = {
    ImageUrl: imageUrl.trim(),
    ResultFormat: 'GLB',
    Model: getAi3dOpenApiModel(),
  };
  const { httpStatus, json, text } = await postJson(getTencentAi3dOpenApiSubmitUrl(), apiKey, payload);
  throwIfAuthOrError(httpStatus, json, text, '提交混元3D任务');
  const data = unwrapResponse(json);
  const jobId = data.JobId ?? data.TaskId;
  if (typeof jobId !== 'string' || !jobId.trim()) {
    throw new TencentAi3dOpenApiError('提交成功但未返回 JobId/TaskId', httpStatus);
  }
  return data;
}

export async function openApiQuery3DJob(jobId: string): Promise<Record<string, unknown>> {
  const apiKey = getTencentApiKey();
  if (!apiKey) {
    throw new TencentAi3dOpenApiError(formatApiKeyConfigError(), 401, 'MissingKey');
  }
  const { httpStatus, json, text } = await postJson(getTencentAi3dOpenApiQueryUrl(), apiKey, { JobId: jobId.trim() });
  throwIfAuthOrError(httpStatus, json, text, '查询混元3D任务');
  return unwrapResponse(json);
}
