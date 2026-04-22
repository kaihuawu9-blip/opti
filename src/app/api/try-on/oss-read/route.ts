import { NextRequest, NextResponse } from 'next/server';
import { readOssObjectForTryOnTablet } from '@/services/autoArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/**
 * 试戴页用：按 objectKey 读取「试戴上传」前缀下的 JPEG（服务端 OSS SDK，支持私有桶）。
 * 说明：平板内置浏览器会话不稳定，此路由不依赖登录态，改由 objectKey 前缀白名单限制访问范围。
 */
export async function GET(req: NextRequest) {
  try {
    const rawKey = (req.nextUrl.searchParams.get('objectKey') || '').trim();
    if (!rawKey) {
      return NextResponse.json({ ok: false, error: 'missing objectKey' }, { status: 400 });
    }
    let objectKey: string;
    try {
      objectKey = decodeURIComponent(rawKey);
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid objectKey' }, { status: 400 });
    }

    const buf = await readOssObjectForTryOnTablet(objectKey);
    if (buf.length > 25 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'object too large' }, { status: 413 });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=120',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'FORBIDDEN_OBJECT_KEY') {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    console.error('[try-on/oss-read] failed:', msg);
    return NextResponse.json({ ok: false, error: mapOssErrorMessage(msg) }, { status: 500 });
  }
}
