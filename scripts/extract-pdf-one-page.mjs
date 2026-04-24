/**
 * 从 PDF 提取单页。
 * 用法:
 *   node scripts/extract-pdf-one-page.mjs --pdf path/to/file.pdf --page 12 [--format pdf|jpg] [--dpi 175] [--out path]
 * 未指定 --out 时写入 PDF 同目录：{basename}-p{N}.pdf 或 .jpg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { pdf as pdfToImg } from 'pdf-to-img';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let pdf = null;
  let page = null;
  let out = null;
  let format = 'pdf';
  let dpi = 175;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pdf' && argv[i + 1]) pdf = argv[++i];
    else if (argv[i] === '--page' && argv[i + 1]) page = parseInt(argv[++i], 10);
    else if (argv[i] === '--out' && argv[i + 1]) out = argv[++i];
    else if (argv[i] === '--format' && argv[i + 1]) format = String(argv[++i]).toLowerCase();
    else if (argv[i] === '--jpg') format = 'jpg';
    else if (argv[i] === '--dpi' && argv[i + 1]) dpi = Number(argv[++i]);
  }
  if (format !== 'pdf' && format !== 'jpg') format = 'pdf';
  return { pdf, page, out, format, dpi };
}

async function extractPdf(pdfPath, page1, outPath) {
  const buf = fs.readFileSync(pdfPath);
  const src = await PDFDocument.load(buf);
  const n = src.getPageCount();
  if (page1 > n) {
    console.error(`页码 ${page1} 超出范围（共 ${n} 页）`);
    process.exit(1);
  }
  const idx = page1 - 1;
  const outDoc = await PDFDocument.create();
  const [copied] = await outDoc.copyPages(src, [idx]);
  outDoc.addPage(copied);
  const bytes = await outDoc.save();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);
}

async function extractJpg(pdfPath, page1, outPath, dpi) {
  const scale = Math.max(1, Math.min(4, dpi / 72));
  const doc = await pdfToImg(pdfPath, { scale });
  if (page1 > doc.length) {
    console.error(`页码 ${page1} 超出范围（共 ${doc.length} 页）`);
    process.exit(1);
  }
  const pngBuf = await doc.getPage(page1);
  const jpgBuf = await sharp(pngBuf).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, jpgBuf);
}

async function main() {
  const { pdf: pdfArg, page: page1, out: outArg, format, dpi } = parseArgs(process.argv);
  if (!pdfArg || !page1 || page1 < 1) {
    console.error(
      '用法: node scripts/extract-pdf-one-page.mjs --pdf <path> --page <1-based> [--format pdf|jpg] [--dpi 175] [--out path]',
    );
    process.exit(2);
  }
  const pdfPath = path.isAbsolute(pdfArg) ? pdfArg : path.join(__dirname, '..', pdfArg);
  if (!fs.existsSync(pdfPath)) {
    console.error('文件不存在:', pdfPath);
    process.exit(1);
  }
  const base = path.basename(pdfPath, path.extname(pdfPath));
  const dir = path.dirname(pdfPath);
  const ext = format === 'jpg' ? '.jpg' : '.pdf';
  const defaultName = `${base}-p${page1}${ext}`;
  const outPath = outArg
    ? path.isAbsolute(outArg)
      ? outArg
      : path.join(__dirname, '..', outArg)
    : path.join(dir, defaultName);

  if (format === 'jpg') {
    await extractJpg(pdfPath, page1, outPath, dpi);
  } else {
    await extractPdf(pdfPath, page1, outPath);
  }
  console.log(outPath);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
