#!/usr/bin/env node
/**
 * 将 public/catalog/zeiss-handbook/ 下首个 .pdf 逐页渲染为 PNG，
 * 输出到 public/catalog/zeiss-handbook/pages/，供 3D 翻页读取（与 extract-zeiss-pricelist 文本解析独立）。
 *
 * 用法：node scripts/export-zeiss-handbook-images.mjs
 * 要求：Node 20+（与 pdf-to-img 一致）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdf } from 'pdf-to-img';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HAND = path.join(ROOT, 'public', 'catalog', 'zeiss-handbook');
const OUT = path.join(HAND, 'pages');

async function findPdf() {
  const names = await fs.readdir(HAND).catch(() => []);
  const hit = names.find((n) => n.toLowerCase().endsWith('.pdf'));
  if (!hit) {
    throw new Error(
      `未找到 PDF：请将 2026 价目册 PDF 放入\n  ${HAND}`,
    );
  }
  return path.join(HAND, hit);
}

async function main() {
  const pdfPath = await findPdf();
  await fs.mkdir(OUT, { recursive: true });

  const document = await pdf(pdfPath, { scale: 2 });
  let i = 0;
  for await (const image of document) {
    i += 1;
    const name = `page_${String(i).padStart(3, '0')}.png`;
    await fs.writeFile(path.join(OUT, name), image);
    if (i % 10 === 0) process.stdout.write(`  ${i} 页…\n`);
  }
  console.log(`\n完成：共 ${i} 页 → ${OUT}`);
  console.log('刷新「蔡司数字化手册」页面即可加载翻页（GET /api/catalog/zeiss-manifest 会扫描到这些 PNG）。');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
