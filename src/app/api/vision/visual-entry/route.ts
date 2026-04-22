import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type VisualEntryResult = {
  right: { ds: string; dc: string; axis: string };
  left: { ds: string; dc: string; axis: string };
};

/**
 * 预留给豆包 AI / OCR 的视觉录入接口。
 * 当前返回一份稳定示例，便于前端联调「摄像头预览 -> JSON 回填 OD/OS S/C/A」流程。
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    const image = form?.get('image');
    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少 image 文件' }, { status: 400 });
    }

    const mock: VisualEntryResult = {
      right: { ds: '-5.75', dc: '-1.00', axis: '170' },
      left: { ds: '-5.50', dc: '-0.75', axis: '15' },
    };

    return NextResponse.json({
      ok: true,
      provider: 'visual-entry-mock',
      result: mock,
      note: '请替换为真实 OCR/AI 推理服务返回结构。',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
