import { createHash } from 'node:crypto';

import OSS from 'ali-oss';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';

export type CustomerUploadType = 'rx' | 'frame' | 'pd' | 'other';

export type AutoArchiveInput = {
  sourceFileName?: string;
  customerPhone?: string | null;
  ossUrl: string;
  type: CustomerUploadType;
  imageBuffer?: Buffer;
  mimeType?: string;
};

type RxExtractResult = {
  rightSph?: number;
  rightCyl?: number | null;
  rightAxis?: number | null;
  leftSph?: number;
  leftCyl?: number | null;
  leftAxis?: number | null;
  pd?: number;
  ph?: number | null;
  customerName?: string;
};

type FrameExtractResult = {
  brand?: string;
  model?: string;
  spec?: string;
  material?: string;
  price?: number;
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const m = digits.match(/1\d{10}/);
  return m ? m[0] : null;
}

function extractPhoneFromText(text: string): string | null {
  return normalizePhone(text || '');
}

function pickCustomerPhone(input: AutoArchiveInput): string | null {
  return (
    normalizePhone(input.customerPhone || '') ||
    extractPhoneFromText(input.sourceFileName || '') ||
    extractPhoneFromText(input.ossUrl || '')
  );
}

function asFiniteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseJsonFromModelContent(content: string): unknown {
  const plain = content.trim();
  const fence = plain.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fence ? fence[1].trim() : plain;
  const startObj = source.indexOf('{');
  const endObj = source.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    return JSON.parse(source.slice(startObj, endObj + 1));
  }
  const startArr = source.indexOf('[');
  const endArr = source.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) {
    return JSON.parse(source.slice(startArr, endArr + 1));
  }
  return JSON.parse(source);
}

function normalizeOssEndpoint(rawEndpoint: string, region: string): string {
  const fallback = region ? `https://${region}.aliyuncs.com` : '';
  const raw = rawEndpoint.trim();
  if (!raw) return fallback;
  if (raw.startsWith('://')) return fallback;

  // 兼容仅填域名的情况，例如 `oss-cn-hangzhou.aliyuncs.com`
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^:\/\//, '')}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) throw new Error('missing hostname');
    // 例如误填 `://aliyuncs.com` 或 `aliyuncs.com`，会缺失 region 段，必须回退。
    if (/^aliyuncs\.com$/i.test(u.hostname) || /^www\.aliyuncs\.com$/i.test(u.hostname)) {
      throw new Error('missing region host');
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    if (fallback) {
      console.warn(`[autoArchive] invalid OSS endpoint "${raw}", fallback to ${fallback}`);
      return fallback;
    }
    return '';
  }
}

function ossClient(): OSS {
  const region = (process.env.OSS_REGION || process.env.NEXT_PUBLIC_OSS_REGION || '').trim();
  const bucket = (process.env.OSS_BUCKET || process.env.NEXT_PUBLIC_OSS_BUCKET || '').trim();
  const accessKeyId = (process.env.OSS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET || '').trim();
  const endpoint = normalizeOssEndpoint(
    process.env.OSS_ENDPOINT || process.env.NEXT_PUBLIC_OSS_ENDPOINT || '',
    region,
  );
  if (!region || !bucket || !accessKeyId || !accessKeySecret || !endpoint) {
    throw new Error('OSS 配置不完整');
  }
  return new OSS({ region, bucket, accessKeyId, accessKeySecret, endpoint });
}

export function buildCustomerRecordObjectKey(customerPhone: string, type: CustomerUploadType, timestamp = Date.now()): string {
  return `records/${customerPhone}/${timestamp}_${type}.jpg`;
}

export async function uploadCustomerImageToOss(
  customerPhone: string,
  type: CustomerUploadType,
  inputBuffer: Buffer,
): Promise<{ objectKey: string; ossUrl: string; contentMd5: string }> {
  const objectKey = buildCustomerRecordObjectKey(customerPhone, type);
  const jpeg = await sharp(inputBuffer).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const contentMd5 = createHash('md5').update(jpeg).digest('hex');
  const client = ossClient();
  const put = await client.put(objectKey, jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  if (!put.url) throw new Error('OSS 上传失败：未返回 URL');
  return { objectKey, ossUrl: put.url, contentMd5 };
}

/** 与 POST /api/try-on/upload-frame 使用的 customerPhone 一致，用于同源读图白名单 */
export const TRY_ON_OSS_READ_PREFIX = 'records/try-on-tablet/';

/** 服务端带 AK 读取 OSS（私有桶 / 内网 put.url 时浏览器无法直连，需走此路径） */
export async function readOssObjectForTryOnTablet(objectKey: string): Promise<Buffer> {
  if (!objectKey.startsWith(TRY_ON_OSS_READ_PREFIX) || objectKey.includes('..')) {
    throw new Error('FORBIDDEN_OBJECT_KEY');
  }
  const client = ossClient();
  const result = await client.get(objectKey);
  const c = result.content as Buffer | Uint8Array | string | undefined;
  if (!c) throw new Error('EMPTY_OBJECT');
  if (Buffer.isBuffer(c)) return c;
  if (c instanceof Uint8Array) return Buffer.from(c);
  return Buffer.from(String(c), 'binary');
}

async function requestDoubaoJson(
  messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>,
  model: string,
): Promise<unknown> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  if (!apiKey) throw new Error('未配置 OPENAI_API_KEY');
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages,
    }),
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`豆包调用失败: ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('豆包返回空内容');
  return parseJsonFromModelContent(content);
}

async function extractRxFromImageDataUrl(imageDataUrl: string): Promise<RxExtractResult | null> {
  const model = (process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL || '').trim();
  if (!model) return null;
  const parsed = await requestDoubaoJson(
    [
      {
        role: 'system',
        content: '你是眼镜店验光单 OCR 录入员。仅输出 JSON。',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          {
            type: 'text',
            text: `请提取并只返回 JSON：
{
  "rightSph": 0,
  "rightCyl": null,
  "rightAxis": null,
  "leftSph": 0,
  "leftCyl": null,
  "leftAxis": null,
  "pd": 0,
  "ph": null,
  "customerName": ""
}
读不到填 null 或 0，不要编造。`,
          },
        ],
      },
    ],
    model,
  );
  if (!parsed || typeof parsed !== 'object') return null;
  const x = parsed as Record<string, unknown>;
  const rightSph = asFiniteNumber(x.rightSph);
  const leftSph = asFiniteNumber(x.leftSph);
  const pd = asFiniteNumber(x.pd);
  if (rightSph == null || leftSph == null || pd == null) return null;
  return {
    rightSph,
    rightCyl: asFiniteNumber(x.rightCyl),
    rightAxis: asFiniteNumber(x.rightAxis),
    leftSph,
    leftCyl: asFiniteNumber(x.leftCyl),
    leftAxis: asFiniteNumber(x.leftAxis),
    pd,
    ph: asFiniteNumber(x.ph),
    customerName: typeof x.customerName === 'string' ? x.customerName.trim() : undefined,
  };
}

async function extractFrameFromImageDataUrl(imageDataUrl: string): Promise<FrameExtractResult | null> {
  const model = (process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL || '').trim();
  if (!model) return null;
  const parsed = await requestDoubaoJson(
    [
      {
        role: 'system',
        content: '你是眼镜行业录入员。仅输出 JSON。',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          {
            type: 'text',
            text: `识别该图片中的镜框信息，只返回 JSON：
{"brand":"","model":"","spec":"","material":"","price":0}
读不到填空字符串或 0。`,
          },
        ],
      },
    ],
    model,
  );
  if (!parsed || typeof parsed !== 'object') return null;
  const x = parsed as Record<string, unknown>;
  return {
    brand: typeof x.brand === 'string' ? x.brand.trim() : '',
    model: typeof x.model === 'string' ? x.model.trim() : '',
    spec: typeof x.spec === 'string' ? x.spec.trim() : '',
    material: typeof x.material === 'string' ? x.material.trim() : '',
    price: asFiniteNumber(x.price) ?? 0,
  };
}

async function verifyFrameOrRxWithPro(raw: unknown): Promise<unknown> {
  const model = (process.env.OPENAI_MODEL_PRO || process.env.DOUBAO_PRO_MODEL || process.env.OPENAI_MODEL || '').trim();
  if (!model) return raw;
  const parsed = await requestDoubaoJson(
    [
      {
        role: 'system',
        content:
          '你是眼镜参数质检员。只修正字段，不增加内容，不删除已有对象结构，只输出 JSON。',
      },
      {
        role: 'user',
        content: `检查以下眼镜参数是否合规：型号是否包含异常字符？折射率是否在 1.49-1.74 范围内？只修正字段，不增加内容。\n${JSON.stringify(
          raw,
        )}`,
      },
    ],
    model,
  );
  return parsed;
}

function isRxValid(rx: RxExtractResult | null): rx is RxExtractResult {
  if (!rx) return false;
  if (!Number.isFinite(rx.rightSph) || !Number.isFinite(rx.leftSph) || !Number.isFinite(rx.pd)) return false;
  if (rx.pd <= 40 || rx.pd >= 80) return false;
  if (Math.abs(rx.rightSph) > 25 || Math.abs(rx.leftSph) > 25) return false;
  return true;
}

function isFrameValid(frame: FrameExtractResult | null): frame is FrameExtractResult {
  if (!frame) return false;
  if (!frame.brand || !frame.model) return false;
  if (!Number.isFinite(frame.price ?? NaN) || (frame.price ?? 0) < 0) return false;
  return true;
}

function sendBackOfficeAlert(message: string): void {
  // 临时后台提醒：先落日志，后续可接 IM/短信/站内通知。
  console.error(`[BACKOFFICE_ALERT] ${message}`);
}

export async function autoArchiveAfterOssUpload(input: AutoArchiveInput): Promise<{
  customerId: string;
  photoId: string;
  status: 'OK' | 'NEED_MANUAL_REVIEW';
}> {
  const customerPhone = pickCustomerPhone(input);
  if (!customerPhone) {
    throw new Error('无法从文件名或参数中提取客户手机号');
  }

  let rxExtracted: RxExtractResult | null = null;
  let frameExtracted: FrameExtractResult | null = null;
  let photoStatus: 'OK' | 'NEED_MANUAL_REVIEW' = 'OK';
  let reviewNote: string | null = null;

  if (input.imageBuffer && input.imageBuffer.length > 0) {
    const jpeg = await sharp(input.imageBuffer).rotate().jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    try {
      if (input.type === 'rx' || input.type === 'pd') {
        const baseRx = await extractRxFromImageDataUrl(dataUrl);
        const verified = (await verifyFrameOrRxWithPro(baseRx)) as RxExtractResult | null;
        rxExtracted = verified && typeof verified === 'object' ? verified : baseRx;
      } else if (input.type === 'frame') {
        const baseFrame = await extractFrameFromImageDataUrl(dataUrl);
        const verified = (await verifyFrameOrRxWithPro(baseFrame)) as FrameExtractResult | null;
        frameExtracted = verified && typeof verified === 'object' ? verified : baseFrame;
      }
    } catch (e) {
      photoStatus = 'NEED_MANUAL_REVIEW';
      reviewNote = `AI 识别失败：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (input.type === 'rx' || input.type === 'pd') {
    if (!isRxValid(rxExtracted)) {
      photoStatus = 'NEED_MANUAL_REVIEW';
      if (!reviewNote) reviewNote = '验光参数缺失或超出合理范围';
    }
  }
  if (input.type === 'frame') {
    if (!isFrameValid(frameExtracted)) {
      photoStatus = 'NEED_MANUAL_REVIEW';
      if (!reviewNote) reviewNote = '镜框参数缺失或不合法';
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let customer = await tx.customer.findUnique({ where: { customerPhone } });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          customerPhone,
          status: 'ACTIVE',
        },
      });
    }

    const photo = await tx.customerPhoto.create({
      data: {
        customerId: customer.id,
        ossUrl: input.ossUrl,
        sourceFile: input.sourceFileName || null,
        type: input.type,
        status: photoStatus,
        reviewNote,
      },
    });

    if (photoStatus === 'OK' && isRxValid(rxExtracted)) {
      await tx.prescription.create({
        data: {
          customerId: customer.id,
          customerName: rxExtracted.customerName || customer.name || null,
          phone: customer.customerPhone,
          rightSph: Number(rxExtracted.rightSph),
          rightCyl: rxExtracted.rightCyl ?? null,
          rightAxis: rxExtracted.rightAxis != null ? Math.trunc(rxExtracted.rightAxis) : null,
          leftSph: Number(rxExtracted.leftSph),
          leftCyl: rxExtracted.leftCyl ?? null,
          leftAxis: rxExtracted.leftAxis != null ? Math.trunc(rxExtracted.leftAxis) : null,
          pd: Number(rxExtracted.pd),
          ph: rxExtracted.ph ?? null,
          status: 'OK',
        },
      });
    } else if (input.type === 'frame' && photoStatus === 'OK' && isFrameValid(frameExtracted)) {
      await tx.frame.create({
        data: {
          brand: frameExtracted.brand || '未知品牌',
          model: frameExtracted.model || '未知型号',
          size: frameExtracted.spec || '',
          color: '未识别',
          material: frameExtracted.material || '未识别',
          price: Number(frameExtracted.price || 0),
          inventory: 0,
          ossImageUrl: input.ossUrl,
          status: 'OK',
        },
      });
    }

    return { customerId: customer.id, photoId: photo.id };
  });

  if (photoStatus === 'NEED_MANUAL_REVIEW') {
    sendBackOfficeAlert(
      `客户 ${customerPhone} 上传图片需人工复核，文件=${input.sourceFileName || '-'}，原因=${reviewNote || '-'}`,
    );
  }

  return {
    customerId: result.customerId,
    photoId: result.photoId,
    status: photoStatus,
  };
}
