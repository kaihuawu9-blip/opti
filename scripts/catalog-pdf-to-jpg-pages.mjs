#!/usr/bin/env node
/**
 * 资源自愈：public/catalog/[品牌]/ 下首个 PDF → 同级 p1.jpg … pN.jpg
 * （与 Zeiss export 同源：pdf-to-img + sharp；无需系统 Poppler / Python）
 *
 * 用法：
 *   node scripts/catalog-pdf-to-jpg-pages.mjs --dir public/catalog/hoya
 *   node scripts/catalog-pdf-to-jpg-pages.mjs --dir public/catalog/hoya --dpi 175
 *
 * 成功时 stdout 末行打印 JSON：{"pages":N,"dir":"...","pdf":"..."}
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { dir: null, dpi: 175 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) {
      out.dir = argv[++i];
    } else if (argv[i] === '--dpi' && argv[i + 1]) {
      out.dpi = Number(argv[++i]);
    }
  }
  return out;
}

async function findPdf(catalogDir) {
  const names = await fs.readdir(catalogDir).catch(() => []);
  const hit = names.find((n) => n.toLowerCase().endsWith('.pdf'));
  if (!hit) throw new Error(`未找到 PDF：${catalogDir}`);
  return path.join(catalogDir, hit);
}

async function main() {
  const { dir, dpi } = parseArgs(process.argv);
  if (!dir) {
    console.error('用法: node scripts/catalog-pdf-to-jpg-pages.mjs --dir public/catalog/hoya [--dpi 175]');
    process.exit(2);
  }
  const catalogDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  await fs.mkdir(catalogDir, { recursive: true });
  const pdfPath = await findPdf(catalogDir);
  const scale = Math.max(1, Math.min(4, dpi / 72));
  const document = await pdf(pdfPath, { scale });
  let i = 0;
  for await (const buf of document) {
    i += 1;
    const outPath = path.join(catalogDir, `p${i}.jpg`);
    const jpg = await sharp(buf).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    await fs.writeFile(outPath, jpg);
    if (i % 10 === 0) process.stdout.write(`  ${i} 页…\n`);
  }
  if (i === 0) throw new Error('PDF 无页面');
  const rel = path.relative(ROOT, catalogDir).split(path.sep).join('/');
  const pdfName = path.basename(pdfPath);
  const metaPath = path.join(ROOT, 'src', 'data', 'hoyaHandbookPageCount.json');
  await fs.writeFile(
    metaPath,
    `${JSON.stringify(
      { pages: i, dir: rel, pdf: pdfName, generatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`\n完成：共 ${i} 页 → ${catalogDir}（${pdfName}）`);
  console.log(`已写入 ${path.relative(ROOT, metaPath)}`);
  console.log(JSON.stringify({ pages: i, dir: rel, pdf: pdfName }));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
