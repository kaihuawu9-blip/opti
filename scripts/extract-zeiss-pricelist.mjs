/**
 * Zeiss 价目册 PDF 逐页文本抽取脚本（pdf-parse v2 API）
 * 输出：ai-data/zeiss_digital_handbook/2026_pricelist_raw.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

const PDF_REL =
  'public/catalog/zeiss-handbook/2026_蔡司价目册-1106-终审8（预览可复制）(1).pdf';
const OUT_REL = 'ai-data/zeiss_digital_handbook/2026_pricelist_raw.json';

async function main() {
  const root = process.cwd();
  const pdfPath = path.resolve(root, PDF_REL);
  const outPath = path.resolve(root, OUT_REL);

  const buf = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });

  const info = await parser.getInfo({ parsePageInfo: false });
  const text = await parser.getText({
    splitByPage: true,
  });

  const pages = (text.pages || []).map((p, i) => ({
    page: p.pageNumber ?? i + 1,
    text: p.text || '',
  }));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        sourcePdf: PDF_REL,
        totalPages: info.numpages ?? pages.length,
        title: info.info?.Title,
        extractedAt: new Date().toISOString(),
        pages,
      },
      null,
      2,
    ),
  );
  console.log(
    `[zeiss-pdf] 抽取完成：${pages.length} 页 → ${OUT_REL} (title=${JSON.stringify(info.info?.Title ?? '')})`,
  );

  await parser.destroy();
}

main().catch((err) => {
  console.error('[zeiss-pdf] 抽取失败：', err);
  process.exit(1);
});
