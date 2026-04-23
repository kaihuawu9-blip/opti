import { NextResponse } from 'next/server';
import { createAIService } from '@/services/aiService';

export const runtime = 'nodejs';

type PaddleOcrLine = { text: string; confidence: number; box: unknown };
type PaddleOcrJson = { status?: string; data?: PaddleOcrLine[] };

function paddleBaseUrl(): string {
  const u = (process.env.PADDLE_OCR_BASE_URL || 'http://127.0.0.1:8866').trim().replace(/\/$/, '');
  return u || 'http://127.0.0.1:8866';
}

/**
 * 收银台验光图：multipart `file` | `image` → 本地 Paddle `/predict` → 拼接 rawText → AI 抽取球镜/柱镜/轴位 → JSON。
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get('file') ?? formData.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少图片（multipart 字段 file 或 image）' }, { status: 400 });
    }
    if (!image.size || !image.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: '请上传有效图片文件' }, { status: 400 });
    }

    const forward = new FormData();
    forward.append('file', image, image.name || 'rx.jpg');

    const ocrResponse = await fetch(`${paddleBaseUrl()}/predict`, {
      method: 'POST',
      body: forward,
    });

    const ocrData = (await ocrResponse.json().catch(() => ({}))) as PaddleOcrJson;

    if (!ocrResponse.ok) {
      return NextResponse.json(
        { ok: false, error: 'Paddle OCR 服务异常', detail: ocrData },
        { status: ocrResponse.status >= 400 ? ocrResponse.status : 502 },
      );
    }

    if (ocrData.status !== 'success' || !Array.isArray(ocrData.data)) {
      return NextResponse.json(
        { ok: false, error: 'Paddle OCR 返回格式异常', detail: ocrData },
        { status: 502 },
      );
    }

    const rawText = ocrData.data.map((item) => item.text).join(' ');

    let right: Record<string, unknown>;
    let left: Record<string, unknown>;
    try {
      const eyes = await createAIService().extractRxSphCylAxisFromOcrText(rawText);
      right = {
        ds: eyes.right.ds,
        dc: eyes.right.dc,
        axis: eyes.right.axis,
        va: eyes.right.va,
        pd: eyes.right.pd,
        add: eyes.right.add,
      };
      left = {
        ds: eyes.left.ds,
        dc: eyes.left.dc,
        axis: eyes.left.axis,
        va: eyes.left.va,
        pd: eyes.left.pd,
        add: eyes.left.add,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          error: `AI 解析失败：${message}`,
          rawText,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      rawText,
      result: { right, left },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: 'OCR 链路失败', message }, { status: 500 });
  }
}
