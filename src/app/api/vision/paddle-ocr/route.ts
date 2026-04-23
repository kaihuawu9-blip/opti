import { NextResponse } from 'next/server';

/** Paddle 容器 `/predict` 单行 */
type PaddleOcrLine = {
  text: string;
  confidence: number;
  box: unknown;
};

type PaddleOcrJson = {
  status?: string;
  data?: PaddleOcrLine[];
};

function paddleBaseUrl(): string {
  const u = (process.env.PADDLE_OCR_BASE_URL || 'http://127.0.0.1:8866').trim().replace(/\/$/, '');
  return u || 'http://127.0.0.1:8866';
}

/**
 * multipart：`file`（与 FastAPI 参数名一致）或 `image`（与 rx-ocr 字段对齐）二选一。
 * 将图片转发至本地 PaddleOCR 容器，返回拼接文本；结构化蒸馏可后续接 AI。
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get('file') ?? formData.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ error: '缺少图片（multipart 字段 file 或 image）' }, { status: 400 });
    }
    if (!image.size || !image.type.startsWith('image/')) {
      return NextResponse.json({ error: '请上传有效图片文件' }, { status: 400 });
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
        { error: 'OCR 服务返回错误', detail: ocrData },
        { status: ocrResponse.status >= 400 ? ocrResponse.status : 502 },
      );
    }

    if (ocrData.status !== 'success' || !Array.isArray(ocrData.data)) {
      return NextResponse.json(
        { error: 'OCR 结果异常', detail: ocrData },
        { status: 502 },
      );
    }

    const rawText = ocrData.data.map((item) => item.text).join(' ');

    return NextResponse.json({
      rawText,
      structData: null as null,
      lines: ocrData.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'OCR 链接失败', message }, { status: 500 });
  }
}
