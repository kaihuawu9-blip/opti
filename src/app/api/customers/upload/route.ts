import { NextRequest, NextResponse } from 'next/server';
import {
  autoArchiveAfterOssUpload,
  type CustomerUploadType,
  uploadCustomerImageToOss,
} from '@/services/autoArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function normalizeType(raw: string): CustomerUploadType {
  const t = raw.trim().toLowerCase();
  if (t === 'rx' || t === 'frame' || t === 'pd') return t;
  return 'other';
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少上传文件 file' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: '仅支持图片上传' }, { status: 400 });
    }

    const customerPhone = String(form.get('customerPhone') || '').trim();
    const type = normalizeType(String(form.get('type') || 'other'));
    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const { objectKey, ossUrl } = await uploadCustomerImageToOss(customerPhone, type, imageBuffer);
    const archived = await autoArchiveAfterOssUpload({
      sourceFileName: file.name,
      customerPhone,
      ossUrl,
      type,
      imageBuffer,
      mimeType: file.type,
    });

    return NextResponse.json({
      ok: true,
      data: {
        objectKey,
        ossUrl,
        customerId: archived.customerId,
        photoId: archived.photoId,
        status: archived.status,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
