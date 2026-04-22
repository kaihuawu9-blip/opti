import OSS from 'ali-oss';

/** 管理端镜架上传前缀，与 `uploadCustomerImageToOss('admin-frames', 'frame', …)` 一致。 */
export const ADMIN_FRAMES_OSS_PREFIX = 'records/admin-frames/';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOssEndpoint(rawEndpoint: string, region: string): string {
  const fallback = region ? `https://${region}.aliyuncs.com` : '';
  const raw = rawEndpoint.trim();
  if (!raw) return fallback;
  if (raw.startsWith('://')) return fallback;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^:\/\//, '')}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) throw new Error('missing hostname');
    if (/^aliyuncs\.com$/i.test(u.hostname) || /^www\.aliyuncs\.com$/i.test(u.hostname)) {
      throw new Error('missing region host');
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    if (fallback) return fallback;
    return '';
  }
}

function createOssClient(): OSS | null {
  const region = (process.env.OSS_REGION || process.env.NEXT_PUBLIC_OSS_REGION || '').trim();
  const bucket = (process.env.OSS_BUCKET || process.env.NEXT_PUBLIC_OSS_BUCKET || '').trim();
  const accessKeyId = (process.env.OSS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET || '').trim();
  const endpoint = normalizeOssEndpoint(
    process.env.OSS_ENDPOINT || process.env.NEXT_PUBLIC_OSS_ENDPOINT || '',
    region,
  );
  if (!region || !bucket || !accessKeyId || !accessKeySecret || !endpoint) {
    return null;
  }
  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure: true,
  });
}

function presignExpiresSeconds(): number {
  const raw = (process.env.TENCENT_3D_OSS_PRESIGN_EXPIRES_SEC || '7200').trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 300) return 7200;
  return Math.min(n, 604800);
}

function ensureHttps(url: string): string {
  const t = url.trim();
  if (t.startsWith('http://')) return `https://${t.slice('http://'.length)}`;
  return t;
}

/**
 * 从公网 OSS URL 解析 object key（虚拟主机或 path-style）。
 * 不匹配当前配置的 bucket 时返回 null。
 */
export function extractAliyunOssObjectKey(imageUrl: string, bucket: string): string | null {
  const b = bucket.trim();
  if (!b) return null;
  let u: URL;
  try {
    u = new URL(imageUrl.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const vh = new RegExp(`^${escapeRegExp(b.toLowerCase())}\\.oss-[a-z0-9-]+\\.aliyuncs\\.com$`);
  if (vh.test(host)) {
    const key = u.pathname.replace(/^\/+/, '');
    return key || null;
  }
  if (/^oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === b) {
      return parts.slice(1).join('/');
    }
  }
  return null;
}

/**
 * 为混元 / 腾讯云拉取：若 URL 属于当前配置的 OSS 桶，则生成带完整 `https://` 的 GET 预签名 URL；否则原样返回（仅补全协议）。
 */
export async function resolveImageUrlForHunyuan3dFetch(imageUrl: string): Promise<string> {
  const trimmed = (imageUrl || '').trim();
  if (!trimmed) return trimmed;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return trimmed;

  const bucket = (process.env.OSS_BUCKET || process.env.NEXT_PUBLIC_OSS_BUCKET || '').trim();
  if (!bucket) return ensureHttps(trimmed);

  const key = extractAliyunOssObjectKey(trimmed, bucket);
  if (!key || key.includes('..')) return ensureHttps(trimmed);

  const client = createOssClient();
  if (!client) return ensureHttps(trimmed);

  try {
    const raw = client.signatureUrl(key, { expires: presignExpiresSeconds(), method: 'GET' });
    return ensureHttps(raw);
  } catch {
    return ensureHttps(trimmed);
  }
}

/**
 * 列出管理端镜架目录下最新一条 `_frame.jpg`，并返回预签名 HTTPS GET URL（供混元拉取）。
 */
export async function getLatestAdminFramePresignedUrl(): Promise<{ objectKey: string; url: string }> {
  const client = createOssClient();
  if (!client) {
    throw new Error('OSS 未配置：需 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_ENDPOINT（或与 NEXT_PUBLIC_* 对应项）');
  }
  const list = await client.list(
    {
      prefix: ADMIN_FRAMES_OSS_PREFIX,
      'max-keys': 1000,
    },
    {},
  );
  const objects = list.objects || [];
  const frames = objects.filter((o) => typeof o.name === 'string' && /_frame\.jpg$/i.test(o.name));
  if (frames.length === 0) {
    throw new Error(`OSS 前缀 ${ADMIN_FRAMES_OSS_PREFIX} 下未找到镜架图（*_frame.jpg），请先通过管理端上传镜架图`);
  }
  frames.sort((a, b) => {
    const ta = new Date(a.lastModified || 0).getTime();
    const tb = new Date(b.lastModified || 0).getTime();
    return tb - ta;
  });
  const objectKey = frames[0].name as string;
  const raw = client.signatureUrl(objectKey, { expires: presignExpiresSeconds(), method: 'GET' });
  const url = ensureHttps(raw);
  if (!url.startsWith('https://')) {
    throw new Error('预签名 URL 缺少 https 协议头');
  }
  return { objectKey, url };
}
