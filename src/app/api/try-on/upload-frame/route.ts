import { NextRequest, NextResponse } from 'next/server';
import { uploadCustomerImageToOss } from '@/services/autoArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** OSS 路径前缀用固定「客户手机」字段区分用途，不入客户档案 */
const TRY_ON_OSS_PHONE = 'try-on-tablet';

function mapOssErrorMessage(raw: string): string {
  if (/Access Key Id.*does not exist|InvalidAccessKeyId/i.test(raw)) {
    return 'OSS 凭证配置错误：AccessKeyId 无效或已删除';
  }
  if (/SignatureDoesNotMatch|InvalidAccessKeySecret|AccessKeySecret/i.test(raw)) {
    return 'OSS 凭证配置错误：AccessKeySecret 不匹配';
  }
  if (/bucket.*not exist|NoSuchBucket/i.test(raw)) {
    return 'OSS 配置错误：Bucket 不存在或名称填写错误';
  }
  return raw;
}

function isLikelyImageFile(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  const n = (file.name || '').toLowerCase();
  return /\.(heic|heif|jpg|jpeg|png|webp|gif|bmp|tif|tiff)$/i.test(n);
}

/**
 * AI 试戴：平板 / 内置浏览器若无法稳定使用本地 blob 解码，可先上传 OSS，再用同源代理 URL 拉取抠图。
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少表单字段 file' }, { status: 400 });
    }
    if (!isLikelyImageFile(file)) {
      return NextResponse.json({ ok: false, error: '请选择图片文件' }, { status: 400 });
    }
    if (file.size > 22 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: '图片过大（>22MB）' }, { status: 413 });
    }

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const { ossUrl, objectKey } = await uploadCustomerImageToOss(TRY_ON_OSS_PHONE, 'frame', imageBuffer);

    /** 浏览器抠图需可读像素：私有桶 / 内网 URL 时直连会失败，改用同源 GET 带 AK 拉取 */
    const sameOriginReadUrl = `/api/try-on/oss-read?objectKey=${encodeURIComponent(objectKey)}`;

    return NextResponse.json({
      ok: true,
      data: {
        objectKey,
        ossUrl,
        sameOriginReadUrl,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 线上排查平板环境 OSS 中转失败时需要明确看到失败原因。
    console.error('[try-on/upload-frame] failed:', msg);
    return NextResponse.json({ ok: false, error: mapOssErrorMessage(msg) }, { status: 500 });
  }
}
