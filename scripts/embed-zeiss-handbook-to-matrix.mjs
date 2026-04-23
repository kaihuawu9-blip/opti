#!/usr/bin/env node
/**
 * 将 public/catalog/zeiss-handbook/ 下首个 PDF 每页渲为 WebP，写入
 * ai-data/zeiss_digital_handbook/2026_price_matrix.json 的 `handbookPageImageData`（key: "1".."N"）。
 * 与价目、矩阵同包，供 ZeissHandbookPage 以 data URL 直贴，无 /catalog/ 路径。
 *
 * 用法：node scripts/embed-zeiss-handbook-to-matrix.mjs
 * 依赖：Node 20+、pdf-to-img、sharp（项目已装）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HAND = path.join(ROOT, 'public', 'catalog', 'zeiss-handbook');
const MATRIX = path.join(ROOT, 'ai-data', 'zeiss_digital_handbook', '2026_price_matrix.json');

async function findPdf() {
  const names = await fs.readdir(HAND).catch(() => []);
  const hit = names.find((n) => n.toLowerCase().endsWith('.pdf'));
  if (!hit) {
    throw new Error(`未找到 PDF：请放入\n  ${HAND}`);
  }
  return path.join(HAND, hit);
}

function toDataUrlWebp(buf) {
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

async function main() {
  const pdfPath = await findPdf();
  const raw = await fs.readFile(MATRIX, 'utf8');
  const j = JSON.parse(raw);
  if (typeof j !== 'object' || j === null) throw new Error('价目 JSON 根须为对象');
  if (!Array.isArray(j.products)) throw new Error('价目 JSON 缺少 products 数组');

  const handbookPageImageData = {};
  const document = await pdf(pdfPath, { scale: 1.5 });
  let i = 0;
  for await (const image of document) {
    i += 1;
    const webp = await sharp(image).webp({ quality: 82 }).toBuffer();
    handbookPageImageData[String(i)] = toDataUrlWebp(webp);
    if (i % 5 === 0) process.stdout.write(`  已处理 ${i} 页…\n`);
  }

  j.handbookPageImageData = handbookPageImageData;
  await fs.writeFile(MATRIX, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`\n完成：共 ${i} 页已写入 ${MATRIX}`);
  console.log('注意：全量内嵌会显著增大 JSON 体积，构建时一并打包。');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
