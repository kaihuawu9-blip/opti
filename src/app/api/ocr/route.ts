import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { pickPrescriptionOcrText } from '@/lib/paddleRxTextFilter';
import { createAIService } from '@/services/aiService';

export const runtime = 'nodejs';

type PaddleOcrLine = { text: string; confidence: number; box: unknown };
type PaddleOcrJson = { status?: string; data?: PaddleOcrLine[] };

/** 与镜腿/吊牌刻字相近：含 □，或同时含数字与中杠类分隔符 → 走镜腿结构化模型 */
function ocrTextLooksLikeTempleMarking(joined: string): boolean {
  const t = joined.trim();
  if (!t) return false;
  const hasDigit = /[0-9０-９]/.test(t);
  const hasHyphen = /[-－﹣−–—~〜]/.test(t);
  const hasBox = /□|■/.test(t);
  return Boolean(hasBox || (hasDigit && hasHyphen));
}

function paddleBaseUrl(): string {
  const u = (process.env.PADDLE_OCR_BASE_URL || 'http://127.0.0.1:8866').trim().replace(/\/$/, '');
  return u || 'http://127.0.0.1:8866';
}

/** 存证日志用：区分镜腿强制帧 vs 自定义添加 */
type OcrRecordingIntent = 'frame' | 'custom_add';

/**
 * 收银 OCR 存证：原图落盘 `public/recordings`（溯源）。
 * - `localPath`：服务端绝对路径（日志/运维）
 * - `webUrl`：浏览器同源可用的 **pathname**（以 `/` 开头，对应 Next `public/`），如 `/recordings/frame_173.jpg`
 * 文件名沿用 `frame_${ms}.jpg`，与既有运维/说明一致。
 */
async function persistFrameRecordingJpeg(imageBytes: Uint8Array): Promise<{ localPath: string; webUrl: string }> {
  const dir = join(process.cwd(), 'public', 'recordings');
  await mkdir(dir, { recursive: true });
  const filename = `frame_${Date.now()}.jpg`;
  if (!/^[a-z0-9_.-]+$/i.test(filename)) {
    throw new Error(`非法存证文件名：${filename}`);
  }
  const absolutePath = join(dir, filename);
  await writeFile(absolutePath, imageBytes);
  const webUrl = `/recordings/${filename}`;
  return { localPath: absolutePath, webUrl };
}

/**
 * 存证先于 AI；写入失败**不中断** Paddle/后续 AI（溯源链断档仅打日志）。
 * @returns 成功时为规范 web pathname，失败为 `null`
 */
async function tryPersistOcrRecording(
  imageBytes: Uint8Array,
  intent: OcrRecordingIntent,
): Promise<string | null> {
  try {
    const { localPath, webUrl } = await persistFrameRecordingJpeg(imageBytes);
    if (!webUrl.startsWith('/') || webUrl.includes('..')) {
      throw new Error(`存证 webUrl 非安全路径：${webUrl}`);
    }
    console.info('[api/ocr] 存证成功', { intent, localPath, webUrl });
    return webUrl;
  } catch (e) {
    console.error('【存证失败】虽不影响识别，但溯源链路已断:', { intent, err: e });
    return null;
  }
}

/**
 * 收银台 OCR：multipart `file` | `image` → 本地 Paddle `/predict`。
 * - 默认 intent=rx：验光文本 → AI 抽取球镜/柱镜/轴位。
 * - intent=frame 或 mode=frame：镜腿/吊牌；原图存证 + AI 抽取 brand / model / size / color。
 * - intent=custom_add 或 mode=custom_add：自定义商品名称 OCR；可选 category；Paddle 取字后**一律**原图存证 public/recordings，再按全文启发式选镜腿或通用品名 AI 模型。
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const mode = String(formData.get('mode') || '').trim().toLowerCase();
    let intent = String(formData.get('intent') || 'rx').trim().toLowerCase();
    const category = String(formData.get('category') || '').trim();
    if (mode === 'frame') intent = 'frame';
    if (mode === 'custom_add') intent = 'custom_add';

    const image = formData.get('file') ?? formData.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少图片（multipart 字段 file 或 image）' }, { status: 400 });
    }
    if (!image.size || !image.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: '请上传有效图片文件' }, { status: 400 });
    }

    const imageBytes = new Uint8Array(await image.arrayBuffer());

    /** intent=frame：存证尽量早于 Paddle/AI；失败则继续识别，仅无 evidenceUrl */
    let evidenceUrl: string | null = null;
    if (intent === 'frame') {
      evidenceUrl = await tryPersistOcrRecording(imageBytes, 'frame');
    }

    const forward = new FormData();
    const defaultUploadName =
      intent === 'frame' ? 'frame.jpg' : intent === 'custom_add' ? 'custom.jpg' : 'rx.jpg';
    forward.append(
      'file',
      new File([imageBytes], image.name || defaultUploadName, {
        type: image.type || 'image/jpeg',
      }),
    );

    const ocrResponse = await fetch(`${paddleBaseUrl()}/predict`, {
      method: 'POST',
      body: forward,
    });

    const ocrData = (await ocrResponse.json().catch(() => ({}))) as PaddleOcrJson;

    if (!ocrResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Paddle OCR 服务异常',
          detail: ocrData,
          hint: '无法连接本机 OCR 服务（Paddle）。请确认 8866 端口上已启动容器，或检查 PADDLE_OCR_BASE_URL。',
        },
        { status: ocrResponse.status >= 400 ? ocrResponse.status : 502 },
      );
    }

    if (ocrData.status !== 'success' || !Array.isArray(ocrData.data)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Paddle OCR 返回格式异常',
          detail: ocrData,
          hint: 'OCR 引擎返回格式异常。请确认本机 Paddle 容器正常，或稍后重试。',
        },
        { status: 502 },
      );
    }

    const ocrPick = pickPrescriptionOcrText(ocrData.data);
    if (!ocrPick.joinedAll) {
      return NextResponse.json(
        {
          ok: false,
          error: '未从画面中提取到文字',
          rawText: '',
          hint: '已拍摄，但图内未识别出可解析文字。请换更清晰的验光单、补光/对焦后重拍，或改用手动输入。',
        },
        { status: 502 },
      );
    }

    /** 镜框镜腿：全文送模型；入参可用 mode=frame 或 intent=frame */
    if (intent === 'frame') {
      const rawText = ocrPick.joinedAll.trim();
      try {
        const extracted = await createAIService().extractFrameTempleFromOcrText(rawText);
        const { brand, model, size, color, productName } = extracted;
        const modelLine = [model, size, color].filter(Boolean).join(' ').trim();
        return NextResponse.json({
          ok: true,
          ocrMode: 'temple',
          rawText,
          evidenceUrl,
          result: {
            brand,
            model,
            size,
            color,
            productName,
            /** 兼容旧前端：合并型号/尺寸/色号一行 */
            modelLine: modelLine || model,
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            ok: false,
            error: `镜架信息解析失败：${message}`,
            rawText: rawText.slice(0, 400),
            evidenceUrl,
            hint: '已识别到文字，但未能拆出品牌/型号/尺寸。请手填或重拍更清晰镜腿刻字。',
          },
          { status: 502 },
        );
      }
    }

    /** custom_add：不区分类别（category 仅影响通用品名 AI 提示）；凡进入此分支均已走 Paddle joinedAll。 */
    if (intent === 'custom_add') {
      const rawText = ocrPick.joinedAll.trim();
      /** custom_add：存证先于启发式/AI；失败不中断，仅 evidenceUrl 为空 */
      const evidenceUrlCustom = await tryPersistOcrRecording(imageBytes, 'custom_add');
      const looksTemple = ocrTextLooksLikeTempleMarking(rawText);
      if (looksTemple) {
        try {
          const extracted = await createAIService().extractFrameTempleFromOcrText(rawText);
          const { brand, model, size, color, productName } = extracted;
          const modelLine = [model, size, color].filter(Boolean).join(' ').trim();
          return NextResponse.json({
            ok: true,
            ocrMode: 'temple',
            rawText,
            evidenceUrl: evidenceUrlCustom,
            result: {
              brand,
              model,
              size,
              color,
              productName,
              modelLine: modelLine || model,
            },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return NextResponse.json(
            {
              ok: false,
              error: `镜架信息解析失败：${message}`,
              rawText: rawText.slice(0, 400),
              evidenceUrl: evidenceUrlCustom,
              hint: '已识别到文字，但未能拆出品牌/型号/尺寸。请手填或重拍更清晰镜腿刻字。',
            },
            { status: 502 },
          );
        }
      }
      try {
        const gen = await createAIService().extractGenericCustomProductFromOcrText(
          rawText,
          category || '其他',
        );
        return NextResponse.json({
          ok: true,
          ocrMode: 'generic',
          rawText,
          evidenceUrl: evidenceUrlCustom,
          result: {
            productName: gen.productName,
            modelLine: gen.modelLine,
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            ok: false,
            error: `自定义商品解析失败：${message}`,
            rawText: rawText.slice(0, 400),
            evidenceUrl: evidenceUrlCustom,
            hint: '已识别到文字，但未能生成商品名称。请手填或重拍更清晰的包装/标签。',
          },
          { status: 502 },
        );
      }
    }

    if (!ocrPick.forModel) {
      return NextResponse.json(
        {
          ok: false,
          error: '取字多为非验光内容',
          rawText: ocrPick.joinedAll.slice(0, 300),
          hint: '取到的字以镜架刻字/背景等为主，未识别到带数字或验光表头的行。请把单页**中央度数控**对准、减少反光，或改用手动输入。',
        },
        { status: 502 },
      );
    }

    const rawText = ocrPick.forModel;

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
      const hint =
        message.includes('OCR 文本为空') || /^\s*$/.test(rawText)
          ? '已识别到画面，但仍未获得可填写的度数。请重拍、增强对比，或改用手动输入。'
          : '已识别到与验光相关的字，但暂未能拆出球镜/柱镜/轴位。请对照原单手动校对。';
      return NextResponse.json(
        {
          ok: false,
          error: `AI 解析失败：${message}`,
          rawText,
          hint,
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
