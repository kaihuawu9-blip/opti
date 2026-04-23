import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { pickPrescriptionOcrText } from '@/lib/paddleRxTextFilter';
import { createAIService } from '@/services/aiService';

export const runtime = 'nodejs';

/**
 * ============================================================
 * 【J:\opti-ai3】庫存 OCR 處理憲章 (Inventory OCR Charter)
 * ============================================================
 *
 * 1. 502 熔斷 (Fail-Fast Logic)
 *    - 拒絕靜默失敗：任何底層異常（Docker 掛起、網絡超時、結構異常）必須回傳 502。
 *    - 超時控制：PADDLE_OCR_FETCH_TIMEOUT_MS 默認 60s，超時即視為服務不可用，不偽裝 200。
 *
 * 2. 雙鏈註釋 (Single Source of Truth)
 *    - 文案不漂移：本文件內的 INVENTORY_ENTRY_PROMPT 透過 JSDoc 雙向引用 aiService。
 *    - 權限隔離：system prompt 僅由本路由注入，確保業務邏輯與服務封裝分離。
 *
 * 3. 採購價補丁 (Smart Auto-fill)
 *    - 保護人工輸入：AI 識別結果 (referenceCost) 僅在庫存表單 purchase_price 為空時預填。
 *    - 字段映射：統一使用 referenceCost 隔離採購成本與銷售價。
 *
 * 4. 存證優先 (Evidence First)
 *    - 證據不丟：執行序為 [落盤(Disk) -> OCR -> AI]。
 *    - 作用域提升：落盤成功後，500/502 響應須帶 evidenceUrl（存證未成功則無），確保溯源鏈路。
 * ============================================================
 */

/**
 * 【AI Service 雙鏈注釋】
 * 消費端：`src/services/aiService.ts` → `extractInventoryEntryFromOcrText(rawText, systemPrompt)`
 * 用途：庫存入庫專用識別（鏡框吊牌 / 鏡片包裝）；維護此文案時請同步檢查該方法的 JSON 解析鍵名。
 */
const INVENTORY_ENTRY_PROMPT = `
你現在是資深倉庫管理員。
輸入圖片可能包含鏡框型號或鏡片包裝信息（若為鏡片則無標籤，需依賴人工後續補錄）。
請從 OCR 文本中提取：
1. brand: 品牌
2. model: 型號
3. size: 尺寸/規格
4. msrp: 建議零售價（如有）
5. cost: 採購參考價（如有）
6. color: 顏色或色號（有則填，無則空字串）
7. refractive_index: 折射率（鏡片包裝常見如 1.67、1.74，無則空字串）

只輸出一個 JSON 對象，鍵名必須為：brand, model, size, color, refractive_index, msrp, cost。
無信息則對應欄位為空字串；價格可讀數字則填數字字串或可解析文本，無則空字串。
不要 Markdown、不要解釋。
`.trim();

type PaddleOcrLine = { text: string; confidence: number; box: unknown };
type PaddleOcrJson = { status?: string; data?: PaddleOcrLine[] };

function paddleBaseUrl(): string {
  const u = (process.env.PADDLE_OCR_BASE_URL || 'http://127.0.0.1:8866').trim().replace(/\/$/, '');
  return u || 'http://127.0.0.1:8866';
}

/** Paddle `/predict` 超时（毫秒），超时与连接失败同属 502 熔断，避免静默挂起。默认 60s，可用 `PADDLE_OCR_FETCH_TIMEOUT_MS` 覆盖。 */
function paddlePredictTimeoutMs(): number {
  const raw = Number(process.env.PADDLE_OCR_FETCH_TIMEOUT_MS ?? '60000');
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  return Math.min(Math.floor(raw), 300_000);
}

/**
 * 入库识别资产存档：锁定 `public/inventory_ref`（与收银 `recordings` 区分）。
 * 存证为第一优先级：落盘失败则整单失败（无法完成资产闭环）。
 */
async function persistStockEntryImage(imageBytes: Uint8Array): Promise<{ localPath: string; webUrl: string }> {
  const filename = `stock_entry_${Date.now()}.jpg`;
  if (!/^stock_entry_\d+\.jpg$/.test(filename)) {
    throw new Error(`非法存证文件名：${filename}`);
  }
  const dir = join(process.cwd(), 'public', 'inventory_ref');
  await mkdir(dir, { recursive: true });
  const localPath = join(dir, filename);
  await writeFile(localPath, imageBytes);
  const webUrl = `/inventory_ref/${filename}`;
  if (!webUrl.startsWith('/') || webUrl.includes('..')) {
    throw new Error(`非法存证 URL：${webUrl}`);
  }
  return { localPath, webUrl };
}

/**
 * POST multipart `file` | `image` → 先存证 `inventory_ref` → Paddle 取字 → 启发式 AI 提取（无字/读不出则字段为空）。
 */
export async function POST(req: Request) {
  /** 存证成功后写入，供 Paddle/AI 任一步骤抛错时仍可在 500 响应中带回预览路径 */
  let evidenceUrl: string | null = null;

  try {
    const formData = await req.formData();
    const image = formData.get('file') ?? formData.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: '缺少图片（multipart 字段 file 或 image）' }, { status: 400 });
    }
    if (!image.size || !image.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: '请上传有效图片文件' }, { status: 400 });
    }

    const imageBytes = new Uint8Array(await image.arrayBuffer());

    let localPath: string;
    try {
      const persisted = await persistStockEntryImage(imageBytes);
      evidenceUrl = persisted.webUrl;
      localPath = persisted.localPath;
      console.info('[api/inventory/ocr] 入库存证成功', { localPath, webUrl: evidenceUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/inventory/ocr] 入库存证失败（资产未落盘）:', e);
      return NextResponse.json(
        {
          ok: false,
          error: '入库存证写入失败',
          message: msg,
          hint: '请确认进程对 public/inventory_ref 目录有写权限。',
        },
        { status: 500 },
      );
    }

    const forward = new FormData();
    forward.append(
      'file',
      new File([imageBytes], image.name || 'stock_entry.jpg', {
        type: image.type || 'image/jpeg',
      }),
    );

    let ocrResponse: Response;
    let ocrData: PaddleOcrJson;
    try {
      ocrResponse = await fetch(`${paddleBaseUrl()}/predict`, {
        method: 'POST',
        body: forward,
        signal: AbortSignal.timeout(paddlePredictTimeoutMs()),
      });
      ocrData = (await ocrResponse.json().catch(() => ({}))) as PaddleOcrJson;
    } catch (e) {
      console.error('[api/inventory/ocr] Paddle 请求失败（网络/进程不可用）:', e);
      return NextResponse.json(
        {
          ok: false,
          error: 'OCR 引擎(Paddle)不可用，请检查 Docker 与网络',
          evidenceUrl,
        },
        { status: 502 },
      );
    }

    if (!ocrResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'OCR 引擎(Paddle)响应故障，请检查 Docker 状态',
          evidenceUrl,
          paddle: { status: ocrResponse.status, detail: ocrData },
        },
        { status: 502 },
      );
    }

    if (ocrData.status !== 'success' || !Array.isArray(ocrData.data)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'OCR 引擎(Paddle)返回异常，未取到有效识别数据',
          evidenceUrl,
          paddle: { detail: ocrData },
        },
        { status: 502 },
      );
    }

    const ocrPick = pickPrescriptionOcrText(ocrData.data);
    /** 入库场景用全文，不用验光过滤后的 forModel，避免包装无「处方关键词」时被丢字 */
    const rawText = (ocrPick.joinedAll || '').trim();

    const extracted = await createAIService().extractInventoryEntryFromOcrText(
      rawText,
      INVENTORY_ENTRY_PROMPT,
    );

    return NextResponse.json({
      ok: true,
      rawText,
      evidenceUrl: evidenceUrl!,
      result: {
        brand: extracted.brand,
        model: extracted.model,
        size: extracted.size,
        color: extracted.color,
        refractiveIndex: extracted.refractiveIndex,
        suggestedRetailPrice: extracted.suggestedRetailPrice,
        referenceCost: extracted.referenceCost,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/inventory/ocr] 关键链路崩溃:', error);
    return NextResponse.json(
      {
        ok: false,
        error: '入库 OCR 链路失败',
        message,
        evidenceUrl,
      },
      { status: 500 },
    );
  }
}
