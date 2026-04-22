import { NextRequest, NextResponse } from 'next/server';
import { getOpenAiCompatibleApiKey, getOpenAiCompatibleBaseUrl } from '@/lib/aiApiCredentials';
import { extractBrandCatalogChunks } from '@/lib/brandImportExtract';
import OSS from 'ali-oss';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_FILE_MB = 500;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_CHUNK_TEXT_CHARS = 3600;
const MAX_DOC_CHUNKS = 18;
const MAX_ITEMS_TOTAL = 240;

export type BrandImportItem = {
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  frame_size?: string | null;
  frame_type: string | null;
  lens_type: string | null;
  price: number;
  stock: number;
  image_url?: string | null;
};

type VisionExtractRow = {
  category?: unknown;
  brand?: unknown;
  model?: unknown;
  spec?: unknown;
  material?: unknown;
  price?: unknown;
  refractive_index?: unknown;
};

function stripCodeFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : s.trim();
}

function asNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[￥,\s]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

const SYSTEM_PROMPT =
  '你是眼镜行业专业的数据录入员，擅长从混乱的 PDF/PPT/图片中提取镜框和镜片参数。你只能输出 JSON 数组，禁止输出解释、注释、Markdown。';

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapLine(s: string, lineLength = 30): string[] {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += lineLength) {
    out.push(t.slice(i, i + lineLength));
  }
  return out;
}

async function textChunkToPngDataUrl(title: string, text: string): Promise<string> {
  const lines = [title, ...wrapLine(text.slice(0, MAX_CHUNK_TEXT_CHARS), 34)];
  const height = Math.max(900, 130 + lines.length * 30);
  const textSpans = lines
    .map((line, idx) => `<tspan x="56" dy="${idx === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="28" y="28" width="1244" height="${height - 56}" rx="20" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <text x="56" y="84" fill="#0f172a" font-size="24" font-family="Arial, Microsoft YaHei, PingFang SC, sans-serif">${textSpans}</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

function normalizeCategory(raw: unknown): '镜片' | '镜框' {
  const t = String(raw ?? '').trim();
  if (t.includes('片')) return '镜片';
  if (t.includes('框')) return '镜框';
  return '镜框';
}

function normalizeSpec(s: string): string | null {
  const raw = s.trim();
  if (!raw) return null;
  const m = raw.match(/(\d{2,3})\s*[-口xX]\s*(\d{2,3})(?:\s*[-xX]\s*(\d{2,3}))?/);
  if (!m) return raw || null;
  const a = m[1];
  const b = m[2];
  const c = m[3];
  return c ? `${a}-${b}-${c}` : `${a}-${b}`;
}

function splitModelAndSpec(modelLike: string, specLike: string): { model: string | null; spec: string | null } {
  const modelRaw = modelLike.trim();
  const specRaw = specLike.trim();
  if (!modelRaw && !specRaw) return { model: null, spec: null };
  if (specRaw) return { model: modelRaw || null, spec: normalizeSpec(specRaw) };
  const joined = modelRaw;
  const m = joined.match(/^([A-Za-z0-9-]{2,})[\s/，,]*((?:\d{2,3}\s*[口\-xX]\s*\d{2,3}(?:\s*[-xX]\s*\d{2,3})?))$/);
  if (!m) return { model: modelRaw || null, spec: null };
  return { model: m[1] || null, spec: normalizeSpec(m[2] || '') };
}

function toBrandImportItem(raw: VisionExtractRow, idx: number): BrandImportItem | null {
  const category = normalizeCategory(raw.category);
  const brand = String(raw.brand ?? '').trim() || null;
  const material = String(raw.material ?? '').trim() || null;
  const price = Math.max(0, asNum(raw.price, 0));
  const modelInput = String(raw.model ?? '').trim();
  const specInput = String(raw.spec ?? '').trim();
  const ri = String(raw.refractive_index ?? '')
    .trim()
    .replace(/[^\d.]/g, '');
  const ms = splitModelAndSpec(modelInput, specInput);

  const model = ms.model;
  const spec = ms.spec;

  const nameParts =
    category === '镜片'
      ? [brand, model, ri ? `${ri}折射率` : null, material]
      : [brand, model, spec, material];
  const name = nameParts.filter(Boolean).join(' ').trim() || `未命名商品_${idx + 1}`;
  const lensType = category === '镜片' ? [brand, model, ri].filter(Boolean).join(' · ') || null : null;
  const frameType = category === '镜框' ? material : null;

  return {
    category,
    name,
    brand,
    model,
    frame_size: category === '镜框' ? spec : null,
    frame_type: frameType,
    lens_type: lensType,
    price,
    stock: 0,
    image_url: null,
  };
}

function dedupeItems(items: BrandImportItem[]): BrandImportItem[] {
  const seen = new Set<string>();
  const out: BrandImportItem[] = [];
  for (const it of items) {
    const key = [
      it.category,
      it.brand || '',
      it.model || '',
      it.frame_size || '',
      it.frame_type || '',
      it.lens_type || '',
      it.price.toFixed(2),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function sanitizeVisionRow(raw: unknown): VisionExtractRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  return {
    category: x.category,
    brand: x.brand,
    model: x.model,
    spec: x.spec,
    material: x.material,
    price: x.price,
    refractive_index: x.refractive_index,
  };
}

async function twoStepVerifyVisionRows(
  apiKey: string,
  baseUrl: string,
  modelPro: string,
  rows: VisionExtractRow[],
): Promise<VisionExtractRow[]> {
  if (!modelPro || rows.length === 0) return rows;
  const user = `检查以下眼镜参数是否合规：型号是否包含异常字符？折射率是否在 1.49-1.74 范围内？只修正字段，不增加内容。

输入 JSON：
${JSON.stringify(rows)}

仅返回修正后的 JSON 数组。`;
  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelPro,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            '你是眼镜参数质检员。只修正字段，不新增记录，不新增字段，不添加解释。输出严格 JSON 数组。',
        },
        { role: 'user', content: user },
      ],
    }),
  });
  const raw = await resp.text();
  if (!resp.ok) return rows;
  try {
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = stripCodeFence(data?.choices?.[0]?.message?.content || '');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return rows;
    const out = parsed.map(sanitizeVisionRow).filter((x): x is VisionExtractRow => Boolean(x));
    return out.length > 0 ? out : rows;
  } catch {
    return rows;
  }
}

function mergeResults(chunks: BrandImportItem[][]): BrandImportItem[] {
  const merged: BrandImportItem[] = [];
  chunks.forEach((arr) => merged.push(...arr));
  return dedupeItems(merged).slice(0, MAX_ITEMS_TOTAL);
}

async function aiExtractStructuredFromVision(
  apiKey: string,
  baseUrl: string,
  model: string,
  modelPro: string,
  imageUrl: string,
  sourceHint: string,
): Promise<BrandImportItem[]> {
  const user = `任务：从图中提取眼镜商品数据。

必须满足：
1) 只返回 JSON 数组，不允许任何解释文本。
2) 字段必须严格且仅包含：
   - category: "镜片" 或 "镜框"
   - brand: 品牌
   - model: 型号（例如 8021）
   - spec: 尺寸（例如 52-18-145）
   - material: 材质（钛/板材等）
   - price: 数字（优先提取零售价或标价）
   - refractive_index: 镜片折射率（1.61/1.67 等，镜框为空字符串）
3) 如果存在多个颜色/配色，请按颜色拆分为多条记录。
4) 如果型号和尺寸连在一起（如 "8021 52口18"），请自动拆分为 model/spec。
5) 无法确定的字段填空字符串，price 填 0。
6) 不得杜撰图片中不存在的信息。

返回示例（仅示例，实际必须依据图片）：
[{"category":"镜框","brand":"雷朋","model":"8021","spec":"52-18-145","material":"钛","price":699,"refractive_index":""}]

来源标识：${sourceHint}`;

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: user },
          ],
        },
      ],
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`AI 请求失败: ${raw.slice(0, 500)}`);
  }

  let content = '';
  try {
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    content = data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    throw new Error('AI 返回格式异常');
  }
  if (!content) throw new Error('AI 未返回内容');

  const jsonStr = stripCodeFence(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`无法解析 AI 输出的 JSON：${content.slice(0, 280)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('AI 输出不是 JSON 数组');
  }
  const rowsRaw = (parsed as unknown[]).map(sanitizeVisionRow).filter((x): x is VisionExtractRow => Boolean(x));
  const rows = await twoStepVerifyVisionRows(apiKey, baseUrl, modelPro, rowsRaw);

  const out: BrandImportItem[] = [];
  rows.slice(0, 80).forEach((r, i) => {
    const n = toBrandImportItem(r, i);
    if (n) out.push(n);
  });
  return out;
}

function sortFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
}

function isPdfFileName(name: string): boolean {
  return /\.pdf$/i.test(name || '');
}

async function tryRenderPdfPageDataUrl(buffer: Buffer, page: number): Promise<string | null> {
  try {
    const png = await sharp(buffer, { density: 220, page: Math.max(0, page - 1) }).png().toBuffer();
    if (!png.length) return null;
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

async function uploadToOssIfConfigured(fileName: string, buf: Buffer, mimeType: string): Promise<string | null> {
  const region = (process.env.OSS_REGION || process.env.NEXT_PUBLIC_OSS_REGION || '').trim();
  const bucket = (process.env.OSS_BUCKET || process.env.NEXT_PUBLIC_OSS_BUCKET || '').trim();
  const accessKeyId = (process.env.OSS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET || '').trim();
  const endpoint = (
    process.env.OSS_ENDPOINT ||
    process.env.NEXT_PUBLIC_OSS_ENDPOINT ||
    (region ? `https://${region}.aliyuncs.com` : '')
  ).trim();

  if (!region || !bucket || !accessKeyId || !accessKeySecret || !endpoint) return null;

  const client = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
  });
  const safeName = fileName.replace(/[^\w.\-]/g, '_');
  const objectKey = `brand-import/${Date.now()}-${safeName}`;
  const putResult = await client.put(objectKey, buf, {
    headers: { 'Content-Type': mimeType || 'application/octet-stream' },
  });
  return putResult.url || null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getOpenAiCompatibleApiKey();
    const baseUrl = getOpenAiCompatibleBaseUrl();
    const model = (process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const modelPro = (process.env.OPENAI_MODEL_PRO || process.env.DOUBAO_PRO_MODEL || process.env.OPENAI_MODEL || '').trim();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: '服务端未配置 OPENAI_API_KEY 或 AI_API_KEY' },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const all = form.getAll('files');
    const single = form.get('file');
    const files = sortFilesByName(
      [...all, single].filter((x): x is File => x instanceof File && x.size > 0),
    );
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: '请上传文件（支持单个或多个）' }, { status: 400 });
    }
    const mergedItems: BrandImportItem[] = [];
    const mergedChunks: BrandImportItem[][] = [];
    const fileSummaries: Array<{
      fileName: string;
      sourceUrl: string | null;
      itemsCount: number;
      mode: 'image-vision' | 'doc-vision-chunks';
      chunks?: number;
      textLength?: number;
      truncated?: boolean;
    }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { ok: false, error: `文件 ${file.name} 过大（上限 ${MAX_FILE_MB}MB）` },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      let sourceUrl: string | null = null;
      try {
        sourceUrl = await uploadToOssIfConfigured(file.name || 'upload', buf, file.type || '');
      } catch {
        sourceUrl = null;
      }

      if (isImageFile(file)) {
        const imageUrl = sourceUrl || `data:${file.type || 'image/png'};base64,${buf.toString('base64')}`;
        const items = await aiExtractStructuredFromVision(apiKey, baseUrl, model, modelPro, imageUrl, `${file.name} 原图`);
        const withImage = items.map((it) => ({ ...it, image_url: it.image_url || sourceUrl || null }));
        mergedItems.push(...withImage);
        mergedChunks.push(withImage);
        fileSummaries.push({
          fileName: file.name,
          sourceUrl,
          itemsCount: withImage.length,
          mode: 'image-vision',
        });
      } else {
        let chunks: Awaited<ReturnType<typeof extractBrandCatalogChunks>>;
        try {
          chunks = await extractBrandCatalogChunks(file.name || 'upload', buf);
        } catch (e) {
          return NextResponse.json(
            { ok: false, error: `${file.name}: ${e instanceof Error ? e.message : String(e)}` },
            { status: 400 },
          );
        }
        const limited = chunks.slice(0, MAX_DOC_CHUNKS);
        const docsItems: BrandImportItem[] = [];
        for (const ck of limited) {
          const text = ck.text.slice(0, MAX_CHUNK_TEXT_CHARS);
          if (!text) continue;
          const chunkImage =
            (isPdfFileName(file.name) ? await tryRenderPdfPageDataUrl(buf, ck.page) : null) ||
            (await textChunkToPngDataUrl(`${file.name} · ${ck.title}`, text));
          const sub = await aiExtractStructuredFromVision(
            apiKey,
            baseUrl,
            model,
            modelPro,
            chunkImage,
            `${file.name} / ${ck.title}`,
          );
          docsItems.push(...sub);
        }
        mergedItems.push(...docsItems);
        mergedChunks.push(docsItems);
        fileSummaries.push({
          fileName: file.name,
          sourceUrl,
          itemsCount: docsItems.length,
          mode: 'doc-vision-chunks',
          chunks: limited.length,
          textLength: chunks.reduce((n, x) => n + x.text.length, 0),
          truncated: chunks.length > MAX_DOC_CHUNKS,
        });
      }
    }

    const deduped = mergeResults(mergedChunks.length ? mergedChunks : [mergedItems]);

    return NextResponse.json({
      ok: true,
      data: {
        items: deduped,
        files: fileSummaries,
        fileName: files[0]?.name || '',
        textLength: fileSummaries.reduce((n, f) => n + (f.textLength || 0), 0),
        truncated: fileSummaries.some((f) => Boolean(f.truncated)),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
