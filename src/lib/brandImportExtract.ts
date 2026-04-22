import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export type BrandCatalogChunk = {
  page: number;
  title: string;
  text: string;
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const mod = (await import('pdf-parse')) as {
    default?: (b: Buffer) => Promise<{ text?: string }>;
    PDFParse?: new (options: { data: Buffer | Uint8Array }) => {
      getText: () => Promise<{ text?: string; pages?: Array<{ text?: string }> }>;
      destroy?: () => Promise<void> | void;
    };
  };

  // 兼容旧版：default(buffer) => { text }
  if (typeof mod.default === 'function') {
    const res = await mod.default(buffer);
    return String(res.text || '').replace(/\s+/g, ' ').trim();
  }

  // 兼容新版：new PDFParse({ data }).getText()
  if (typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const res = await parser.getText();
      const joined =
        typeof res?.text === 'string'
          ? res.text
          : Array.isArray(res?.pages)
            ? res.pages.map((p) => String(p?.text || '')).join('\n')
            : '';
      return joined.replace(/\s+/g, ' ').trim();
    } finally {
      await parser.destroy?.();
    }
  }

  throw new Error('PDF 解析器不可用：pdf-parse 导出格式不兼容');
}

async function extractPdfChunks(buffer: Buffer): Promise<BrandCatalogChunk[]> {
  const mod = (await import('pdf-parse')) as {
    default?: (b: Buffer) => Promise<{ text?: string }>;
    PDFParse?: new (options: { data: Buffer | Uint8Array }) => {
      getText: () => Promise<{ text?: string; pages?: Array<{ text?: string }> }>;
      destroy?: () => Promise<void> | void;
    };
  };
  if (typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const res = await parser.getText();
      const pages = Array.isArray(res?.pages) ? res.pages : [];
      const out = pages
        .map((p, idx) => ({
          page: idx + 1,
          title: `PDF 第 ${idx + 1} 页`,
          text: String(p?.text || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((x) => x.text.length > 0);
      if (out.length) return out;
    } finally {
      await parser.destroy?.();
    }
  }
  const merged = await extractPdfText(buffer);
  if (!merged) return [];
  return [{ page: 1, title: 'PDF 第 1 页', text: merged }];
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const lines: string[] = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      const vals = row.values as unknown[];
      if (!vals || vals.length <= 1) return;
      const cells = vals
        .slice(1)
        .map((c) => {
          if (c == null || c === '') return '';
          if (typeof c === 'object' && c !== null && 'text' in (c as { text?: string })) {
            return String((c as { text?: string }).text ?? '');
          }
          if (typeof c === 'object' && c !== null && 'richText' in (c as { richText?: { text: string }[] })) {
            const rt = (c as { richText?: { text: string }[] }).richText;
            return Array.isArray(rt) ? rt.map((x) => x.text).join('') : String(c);
          }
          return String(c);
        })
        .join('\t');
      if (cells.replace(/\t/g, '').trim() !== '') lines.push(cells);
    });
  });
  return lines.join('\n').trim();
}

async function extractXlsxChunks(buffer: Buffer): Promise<BrandCatalogChunk[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out: BrandCatalogChunk[] = [];
  let page = 1;
  wb.eachSheet((ws) => {
    const lines: string[] = [];
    ws.eachRow((row) => {
      const vals = row.values as unknown[];
      if (!vals || vals.length <= 1) return;
      const cells = vals
        .slice(1)
        .map((c) => {
          if (c == null || c === '') return '';
          if (typeof c === 'object' && c !== null && 'text' in (c as { text?: string })) {
            return String((c as { text?: string }).text ?? '');
          }
          if (typeof c === 'object' && c !== null && 'richText' in (c as { richText?: { text: string }[] })) {
            const rt = (c as { richText?: { text: string }[] }).richText;
            return Array.isArray(rt) ? rt.map((x) => x.text).join('') : String(c);
          }
          return String(c);
        })
        .join('\t');
      if (cells.replace(/\t/g, '').trim() !== '') lines.push(cells);
    });
    const text = lines.join('\n').trim();
    if (text) {
      out.push({
        page,
        title: `Excel 工作表「${ws.name || page}」`,
        text,
      });
      page += 1;
    }
  });
  return out;
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number.parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = Number.parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });
  const chunks: string[] = [];
  for (const p of slidePaths) {
    const f = zip.file(p);
    if (!f) continue;
    const xml = await f.async('string');
    const parts = xml
      .split(/<a:t>/)
      .slice(1)
      .map((s) => s.split('</a:t>')[0] || '')
      .filter(Boolean);
    if (parts.length) chunks.push(parts.join(' '));
  }
  return chunks.join('\n').replace(/\s+/g, ' ').trim();
}

async function extractPptxChunks(buffer: Buffer): Promise<BrandCatalogChunk[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number.parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = Number.parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });
  const out: BrandCatalogChunk[] = [];
  for (let i = 0; i < slidePaths.length; i += 1) {
    const p = slidePaths[i];
    const f = zip.file(p);
    if (!f) continue;
    const xml = await f.async('string');
    const parts = xml
      .split(/<a:t>/)
      .slice(1)
      .map((s) => s.split('</a:t>')[0] || '')
      .filter(Boolean);
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({
      page: i + 1,
      title: `PPT 第 ${i + 1} 页`,
      text,
    });
  }
  return out;
}

/** 从上传文件提取纯文本，供 AI 解析。支持 PDF、xlsx、pptx。 */
export async function extractBrandCatalogText(filename: string, buffer: Buffer): Promise<string> {
  const ext = extOf(filename);
  if (ext === '.pdf') {
    const t = await extractPdfText(buffer);
    if (!t) throw new Error('PDF 未解析到文字（可能是扫描件，请先 OCR 或导出 Excel）');
    return t;
  }
  if (ext === '.xlsx') {
    const t = await extractXlsxText(buffer);
    if (!t) throw new Error('Excel 工作表为空或无法读取');
    return t;
  }
  if (ext === '.pptx') {
    const t = await extractPptxText(buffer);
    if (!t) throw new Error('PPTX 未解析到文字');
    return t;
  }
  if (ext === '.xls') {
    throw new Error('暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx');
  }
  if (ext === '.ppt') {
    throw new Error('暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx 或导出 PDF');
  }
  throw new Error('仅支持 PDF、.xlsx、.pptx');
}

/** 分片提取：PDF 按页，PPT 按幻灯片，Excel 按工作表。 */
export async function extractBrandCatalogChunks(filename: string, buffer: Buffer): Promise<BrandCatalogChunk[]> {
  const ext = extOf(filename);
  if (ext === '.pdf') {
    const chunks = await extractPdfChunks(buffer);
    if (!chunks.length) throw new Error('PDF 未解析到文字（可能是扫描件，请先 OCR 或上传图片）');
    return chunks;
  }
  if (ext === '.xlsx') {
    const chunks = await extractXlsxChunks(buffer);
    if (!chunks.length) throw new Error('Excel 工作表为空或无法读取');
    return chunks;
  }
  if (ext === '.pptx') {
    const chunks = await extractPptxChunks(buffer);
    if (!chunks.length) throw new Error('PPTX 未解析到文字');
    return chunks;
  }
  if (ext === '.xls') {
    throw new Error('暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx');
  }
  if (ext === '.ppt') {
    throw new Error('暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx 或导出 PDF');
  }
  throw new Error('仅支持 PDF、.xlsx、.pptx');
}
