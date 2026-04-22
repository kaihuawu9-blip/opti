import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import type { PupilFrameCoordinates, VisionProviderId } from '@/lib/vision/types';
import { toPhysicalMeasures } from '@/lib/vision/physical';
import { VisionService } from '@/lib/vision/VisionService';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isPupilFrameCoordinates(x: unknown): x is PupilFrameCoordinates {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  for (const k of ['left_pupil_x', 'left_pupil_y', 'right_pupil_x', 'right_pupil_y', 'frame_bottom_y'] as const) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function parseImageBuffer(body: Record<string, unknown>): { ok: true; buffer: Buffer } | { ok: false; error: string } {
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : '';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
  if (dataUrl.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/is.exec(dataUrl.replace(/\s/g, ''));
    if (!m?.[2]) return { ok: false, error: 'dataUrl 格式无效' };
    try {
      return { ok: true, buffer: Buffer.from(m[2], 'base64') };
    } catch {
      return { ok: false, error: 'dataUrl Base64 解码失败' };
    }
  }
  if (imageBase64) {
    try {
      return { ok: true, buffer: Buffer.from(imageBase64, 'base64') };
    } catch {
      return { ok: false, error: 'imageBase64 解码失败' };
    }
  }
  return { ok: false, error: '缺少 imageBase64 或 dataUrl' };
}

/**
 * GET 已停用：原 sharp + 磁盘样板图管线已迁至浏览器（红色标定 + Canvas）。
 * 服务端仅保留：毫米换算（JSON）与正式报告单次云端 AI（大图）。
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      error:
        'GET 已停用：标定像素逻辑在客户端执行。请使用 POST JSON：mode=physical（仅换算）或 mode=formal_ai_refine（正式报告 4K 单次云端）。试戴能力说明见 GET /api/try-on',
    },
    { status: 410 },
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体须为 JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: '无效 JSON 对象' }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  const mode = String(rec.mode || '').trim();

  if (mode === 'physical') {
    const pxPerMm = clamp(Number(rec.pxPerMm ?? 4), 1, 20);
    const structured = rec.structured;
    if (!isPupilFrameCoordinates(structured)) {
      return NextResponse.json({ ok: false, error: 'structured 须为完整瞳位像素坐标' }, { status: 400 });
    }
    const physical = toPhysicalMeasures(structured, { pxPerMm, mmPerPx: 1 / pxPerMm });
    const pdPx = Math.hypot(
      structured.right_pupil_x - structured.left_pupil_x,
      structured.right_pupil_y - structured.left_pupil_y,
    );
    const sample = typeof rec.sample === 'string' ? rec.sample : undefined;
    const clientDebug = rec.debug && typeof rec.debug === 'object' ? (rec.debug as Record<string, unknown>) : undefined;

    return NextResponse.json({
      ok: true,
      sample,
      pd: {
        pd_px: Number(pdPx.toFixed(2)),
        pd_mm: Number(physical.pd_mm.toFixed(2)),
      },
      qwenVl: {
        provider: 'qwen-vl',
        source: 'client-structured',
        structured,
      },
      debug: {
        pxPerMm,
        mode: 'physical',
        ...clientDebug,
      },
    });
  }

  if (mode === 'formal_ai_refine') {
    const parsed = parseImageBuffer(rec);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { buffer } = parsed;
    const maxBytes = 28 * 1024 * 1024;
    if (buffer.length < 256) {
      return NextResponse.json({ ok: false, error: '图像数据过短' }, { status: 400 });
    }
    if (buffer.length > maxBytes) {
      return NextResponse.json({ ok: false, error: `图像过大（>${Math.floor(maxBytes / (1024 * 1024))}MB）` }, { status: 413 });
    }

    const pxPerMm = clamp(Number(rec.pxPerMm ?? 4), 1, 20);
    const maxEdge = clamp(Number(rec.maxEdge ?? 3840), 640, 4096);
    const quality = clamp(Number(rec.quality ?? 88), 70, 95);
    const rawProvider = String(rec.provider || 'qwen').trim().toLowerCase();
    const provider: VisionProviderId =
      rawProvider === 'doubao' || rawProvider === 'deepseek' ? (rawProvider as VisionProviderId) : 'qwen';

    let qwenStructured: PupilFrameCoordinates;
    let qwenRawText = '';
    let qwenError = '';
    try {
      const qwenResult = await VisionService.create(provider).analyzePupilFromPhoto(buffer, {
        maxEdge,
        quality,
      });
      qwenStructured = qwenResult.structured;
      qwenRawText = qwenResult.rawText || '';
    } catch (error) {
      qwenError = error instanceof Error ? error.message : 'vision analyze failed';
      return NextResponse.json(
        {
          ok: false,
          error: qwenError,
          mode: 'formal_ai_refine',
        },
        { status: 502 },
      );
    }

    const physical = toPhysicalMeasures(qwenStructured, { pxPerMm, mmPerPx: 1 / pxPerMm });
    const pdPx = Math.hypot(
      qwenStructured.right_pupil_x - qwenStructured.left_pupil_x,
      qwenStructured.right_pupil_y - qwenStructured.left_pupil_y,
    );

    return NextResponse.json({
      ok: true,
      mode: 'formal_ai_refine',
      pd: {
        pd_px: Number(pdPx.toFixed(2)),
        pd_mm: Number(physical.pd_mm.toFixed(2)),
      },
      qwenVl: {
        provider: `${provider}-vl`,
        source: 'cloud-single-pass',
        structured: qwenStructured,
        rawText: qwenRawText || undefined,
        error: qwenError || undefined,
      },
      debug: {
        pxPerMm,
        maxEdge,
        quality,
        imageBytes: buffer.length,
        visionProvider: provider,
      },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: `未知 mode: ${mode || '(空)'}，支持 physical | formal_ai_refine`,
    },
    { status: 400 },
  );
}
