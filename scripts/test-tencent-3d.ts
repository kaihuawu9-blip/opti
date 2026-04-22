/**
 * 调用腾讯混元 3D OpenAI 兼容接口（读 TENCENT_API_KEY）。
 * 运行（项目根目录）：
 *   npx tsx scripts/test-tencent-3d.ts
 *   npm run test:tencent-3d
 *
 * 默认（不设 TEST_TENCENT_3D_IMAGE_URL）：用阿里云 OSS SDK 列出 `records/admin-frames/` 下
 * 最新一张 `*_frame.jpg`，生成带 `https://` 的 GET 预签名 URL 后提交混元（与线上 API 逻辑一致）。
 *
 * 手动覆盖：
 *   TEST_TENCENT_3D_IMAGE_URL=https://your-bucket.oss-cn-xxx.aliyuncs.com/...jpg npm run test:tencent-3d
 * （若为当前桶内私有对象，脚本内仍会再经 resolve 生成预签名 URL。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getLatestAdminFramePresignedUrl,
  resolveImageUrlForHunyuan3dFetch,
} from '../src/lib/oss/hunyuan3dOssImageUrl';
import {
  formatApiKeyConfigError,
  getAi3dOpenApiModel,
  getTencentAi3dOpenApiQueryUrl,
  getTencentAi3dOpenApiSubmitUrl,
  isAuthFailureResponse,
  readTencentOpenApiBusinessError,
} from '../src/lib/tencent/tencentAi3dOpenApi';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnvLocal() {
  for (const name of ['.env']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadEnvLocal();

function authHeaderValue(key: string): string {
  const t = key.trim();
  if (/^(Bearer|bearer)\s+/i.test(t)) return t;
  return t.startsWith('sk-') ? t : `Bearer ${t}`;
}

/** 避免把文档里的中文示例原样当 URL 提交。 */
function validatePublicImageUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const u = raw.trim();
  if (!u) {
    return {
      ok: false,
      message:
        'ImageUrl 为空。不设 TEST_TENCENT_3D_IMAGE_URL 时会自动读 OSS 最新镜架图；若需手动请设置：\n  TEST_TENCENT_3D_IMAGE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com/...jpg npm run test:tencent-3d',
    };
  }
  if (
    /你的桶|你的真实桶名|真实桶名|镜架图\.jpg|真实域名|某镜架|示例域名|示例图|\/路径\/|oss-cn-xxxx|placeholder|changeme|your-bucket\.|example\.com\/path/i.test(
      u,
    )
  ) {
    return {
      ok: false,
      message:
        '当前 ImageUrl 仍是文档占位（含「你的真实桶名」「xxxx」等），不是线上 OSS 地址。请到阿里云 OSS 控制台复制对象「URL 复制」里的整段 https 链接再粘贴。',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, message: 'ImageUrl 不是合法 URL。' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'ImageUrl 仅支持 http(s)。' };
  }
  if (/[^\u0000-\u007f]/.test(parsed.hostname)) {
    return {
      ok: false,
      message: '域名中不能含中文等非 ASCII 字符；请使用真实域名（如 xxx.aliyuncs.com）。',
    };
  }
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    return { ok: false, message: '腾讯云无法访问本机地址，请使用公网 URL。' };
  }
  return { ok: true, url: u };
}

async function main() {
  const apiKey = (process.env.TENCENT_API_KEY || '').trim();
  const fromEnv = (process.env.TEST_TENCENT_3D_IMAGE_URL || '').trim();

  let imageUrl = '';
  if (fromEnv) {
    if ((process.env.ENT_3D_IMAGE_URL || '').trim()) {
      console.error(
        '检测到环境变量 ENT_3D_IMAGE_URL，但脚本只读取 TEST_TENCENT_3D_IMAGE_URL（名称不同，之前未生效）。\n' +
          '请改用：\n' +
          '  TEST_TENCENT_3D_IMAGE_URL=' +
          JSON.stringify((process.env.ENT_3D_IMAGE_URL || '').trim()) +
          ' npm run test:tencent-3d',
      );
      process.exit(1);
    }
    const validated = validatePublicImageUrl(fromEnv);
    if (validated.ok === false) {
      console.error(validated.message);
      process.exit(1);
    }
    imageUrl = validated.url;
  } else {
    try {
      const latest = await getLatestAdminFramePresignedUrl();
      imageUrl = latest.url;
      console.log('已选 OSS 对象:', latest.objectKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      console.error('提示：设置 TEST_TENCENT_3D_IMAGE_URL 可改为手动指定公网图片 URL。');
      process.exit(1);
    }
  }

  if (!apiKey) {
    console.error(formatApiKeyConfigError());
    process.exit(1);
  }

  const imageUrlForTencent = await resolveImageUrlForHunyuan3dFetch(imageUrl);
  if (!imageUrlForTencent.startsWith('https://')) {
    console.error('提交用 ImageUrl 必须以 https:// 开头，当前:', imageUrlForTencent.slice(0, 80));
    process.exit(1);
  }

  console.log('OpenAPI submit:', getTencentAi3dOpenApiSubmitUrl());
  console.log('OpenAPI query :', getTencentAi3dOpenApiQueryUrl());
  console.log('ImageUrl（前 120 字符）:', imageUrlForTencent.slice(0, 120) + (imageUrlForTencent.length > 120 ? '…' : ''));

  const submitBody = {
    ImageUrl: imageUrlForTencent,
    ResultFormat: 'GLB',
    Model: getAi3dOpenApiModel(),
  };

  const submitRes = await fetch(getTencentAi3dOpenApiSubmitUrl(), {
    method: 'POST',
    headers: {
      Authorization: authHeaderValue(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitBody),
  });

  const submitText = await submitRes.text();
  let submitJson: Record<string, unknown> = {};
  try {
    submitJson = submitText ? (JSON.parse(submitText) as Record<string, unknown>) : {};
  } catch {
    submitJson = {};
  }

  if (isAuthFailureResponse(submitRes.status, submitJson)) {
    console.error(formatApiKeyConfigError());
    console.error('HTTP', submitRes.status, submitText.slice(0, 500));
    process.exit(1);
  }

  const bizErr = readTencentOpenApiBusinessError(submitJson);
  if (bizErr) {
    if (isAuthFailureResponse(submitRes.status, submitJson)) {
      console.error(formatApiKeyConfigError());
    } else {
      console.error('提交失败', bizErr.code, bizErr.message);
      if (/DownloadError/i.test(bizErr.code) || /下载失败/i.test(bizErr.message)) {
        console.error(
          '说明：混元会从腾讯云机房拉取 ImageUrl。请确认：① 公网可访问 ② HTTPS 证书有效 ③ OSS 未拦截非浏览器 Referer（可试关闭防盗链或放行混元出口 IP）。',
        );
      }
      if (/UrlIllegal|InvalidParameterValue\.UrlIllegal/i.test(bizErr.code) || /URL格式不合法/i.test(bizErr.message)) {
        console.error(
          '说明：URL 需为合法公网地址（域名全英文、区域名如 oss-cn-hangzhou 勿写 xxxx；路径勿含中文占位）。请使用 OSS 控制台「文件详情」里一键复制的链接。',
        );
      }
    }
    process.exit(1);
  }

  if (!submitRes.ok) {
    console.error('提交失败 HTTP', submitRes.status, submitText.slice(0, 800));
    process.exit(1);
  }

  const inner = submitJson.Response as Record<string, unknown> | undefined;
  const jobId =
    (typeof submitJson.JobId === 'string' && submitJson.JobId) ||
    (typeof inner?.JobId === 'string' && inner.JobId) ||
    (typeof submitJson.TaskId === 'string' && submitJson.TaskId) ||
    (typeof inner?.TaskId === 'string' && inner.TaskId);

  if (!jobId) {
    console.error('提交成功但未解析到 JobId，原始响应：', submitText.slice(0, 800));
    process.exit(1);
  }

  console.log('task_id (JobId):', jobId);

  const queryRes = await fetch(getTencentAi3dOpenApiQueryUrl(), {
    method: 'POST',
    headers: {
      Authorization: authHeaderValue(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ JobId: jobId }),
  });
  const queryText = await queryRes.text();
  let queryJson: Record<string, unknown> = {};
  try {
    queryJson = queryText ? (JSON.parse(queryText) as Record<string, unknown>) : {};
  } catch {
    queryJson = {};
  }

  if (isAuthFailureResponse(queryRes.status, queryJson)) {
    console.error(formatApiKeyConfigError());
    process.exit(1);
  }

  const queryBizErr = readTencentOpenApiBusinessError(queryJson);
  if (queryBizErr) {
    console.error('查询失败', queryBizErr.code, queryBizErr.message);
    process.exit(1);
  }

  const qInner = queryJson.Response as Record<string, unknown> | undefined;
  const status = (queryJson.Status ?? qInner?.Status) as string | undefined;
  const files = (queryJson.ResultFile3Ds ?? qInner?.ResultFile3Ds) as unknown;
  let modelUrl: string | undefined;
  if (Array.isArray(files)) {
    const glb = files.find(
      (f: { Type?: string; Url?: string }) =>
        (f?.Type || '').toUpperCase() === 'GLB' && typeof f?.Url === 'string',
    ) as { Url?: string } | undefined;
    modelUrl = glb?.Url || (files[0] as { Url?: string })?.Url;
  }

  console.log('首次查询 Status:', status ?? '(empty)');
  if (modelUrl) console.log('model_url:', modelUrl);
  else console.log('model_url: 尚未就绪（任务可能仍在排队/生成中），可稍后用同一 JobId 再查 query 接口');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
