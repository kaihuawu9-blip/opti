import { NextRequest, NextResponse } from 'next/server';
import { uploadCustomerImageToOss } from '@/services/autoArchive';

export const runtime = 'nodejs';

const ADMIN_FRAME_PHONE = 'admin-frames';

/**
 * 管理端镜架图上传：写入 OSS 并返回公网 URL，供混元 3D ImageUrl 使用。
 */
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

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const { ossUrl, contentMd5, objectKey } = await uploadCustomerImageToOss(ADMIN_FRAME_PHONE, 'frame', imageBuffer);

    return NextResponse.json({
      ok: true,
      data: {
        imageUrl: ossUrl,
        contentMd5,
        objectKey,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
