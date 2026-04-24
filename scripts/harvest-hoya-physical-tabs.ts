/**
 * StandardEye · 豪雅手册「全域坐标收割」（离线自动对齐）
 *
 * 输入：`public/catalog/hoya/p{N}.jpg`（PDF → JPG 已由 `catalog:hoya-pdf-python` / `catalog:pdf-to-jpg-pages` 产出）
 * 流程：
 *   1) 对每页：`sharp` 解码 → RGBA；
 *   2) 裁出 `HOYA_TOP_RIGHT_QUADRANT_REL` 子图，跑 `scanHoyaTopRightQuadrantCandidates`（全域+橙/蓝/紫）；
 *   3) 候选 `remapQuadrantCandidateToFullPage` 映回整页；
 *   4) 当 `pdfPage` 命中 `HOYA_SERIES_MENU` 时，取菜单 `physicalTabLabel` 作为规范 label（模糊匹配再校验）；
 *      未在菜单的页**仅**入候选报表，不会自动加项避免误塞；
 *   5) 将已落实的行写回 `src/data/hoyaSeriesNav.ts`（仅改 `vOffsetPercent` / `hOffsetPercent`；`id`/`label`/`tabAccent`/`section` 保留）。
 *
 * 运行：
 *   npx tsx scripts/harvest-hoya-physical-tabs.ts            # 只产出候选 JSON（默认 dry-run）
 *   npx tsx scripts/harvest-hoya-physical-tabs.ts --apply    # 真正写回 hoyaSeriesNav.ts（自动生成 .bak）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import {
  HOYA_TOP_RIGHT_QUADRANT_REL,
  matchHoyaSeriesFromColorBlockText,
  remapQuadrantCandidateToFullPage,
  scanHoyaTopRightQuadrantCandidates,
  type PhysicalTabScanCandidate,
} from '@/lib/catalog/handbookPhysicalLabelScan';
import { HOYA_SERIES_MENU } from '@/data/hoyaSeriesNav';

const ROOT = process.cwd();
const PAGES_DIR = path.join(ROOT, 'public', 'catalog', 'hoya');
const NAV_FILE = path.join(ROOT, 'src', 'data', 'hoyaSeriesNav.ts');
const HARVEST_OUT_DIR = path.join(ROOT, 'harvest');
const HARVEST_JSON = path.join(HARVEST_OUT_DIR, 'hoya-physical-tabs.candidates.json');
const TOTAL_PAGES = 74;

const ARGV = new Set(process.argv.slice(2));
const DO_APPLY = ARGV.has('--apply');

type HarvestRow =
  | { pdfPage: number; ok: false; reason: string; error?: string; imageWidth?: number; imageHeight?: number }
  | {
      pdfPage: number;
      ok: true;
      vOffsetPercent: number;
      hOffsetPercent: number;
      bboxNorm: { x: number; y: number; w: number; h: number };
      combinedScore: number;
      contrastScore: number;
      colorBlockScore: number;
      verticalStrokeVariance: number;
      verticalTextBoost: number;
      band: string;
      menuId: string | null;
      physicalTabLabel: string | null;
      aliasKey: string | null;
      imageWidth: number;
      imageHeight: number;
    };

async function cropQuadrantRGBA(filePath: string) {
  const meta = await sharp(filePath).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error(`bad image dims: ${filePath}`);
  const q = HOYA_TOP_RIGHT_QUADRANT_REL;
  const left = Math.floor(q.left * W);
  const top = Math.floor(q.top * H);
  const width = Math.max(1, Math.floor(q.width * W));
  const height = Math.max(1, Math.floor(q.height * H));
  const buf = await sharp(filePath)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return {
    width,
    height,
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength),
    fullWidth: W,
    fullHeight: H,
  };
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function scanOnePage(pdfPage: number): Promise<HarvestRow> {
  const file = path.join(PAGES_DIR, `p${pdfPage}.jpg`);
  try {
    await fs.access(file);
  } catch {
    return { pdfPage, ok: false, reason: 'missing-jpg' };
  }

  const quad = await cropQuadrantRGBA(file);
  const quadImageData = {
    width: quad.width,
    height: quad.height,
    data: quad.data,
    colorSpace: 'srgb' as const,
  } as unknown as ImageData;

  const hits = scanHoyaTopRightQuadrantCandidates(quadImageData, { cellPx: 6, minAreaFrac: 0.0008 });
  if (!hits.length) {
    return { pdfPage, ok: false, reason: 'no-hit', imageWidth: quad.fullWidth, imageHeight: quad.fullHeight };
  }
  const best: PhysicalTabScanCandidate = remapQuadrantCandidateToFullPage(hits[0]!);

  const menuMatch = HOYA_SERIES_MENU.find((m) => m.pdfPage === pdfPage);
  const canonicalLabel = menuMatch?.physicalTabLabel ?? null;
  const aliasHint = canonicalLabel ? matchHoyaSeriesFromColorBlockText(canonicalLabel) : null;

  return {
    pdfPage,
    ok: true,
    vOffsetPercent: r4(best.vOffsetPercent),
    hOffsetPercent: r4(best.hOffsetPercent),
    bboxNorm: {
      x: r4(best.bboxNorm.x),
      y: r4(best.bboxNorm.y),
      w: r4(best.bboxNorm.w),
      h: r4(best.bboxNorm.h),
    },
    combinedScore: r4(best.combinedScore),
    contrastScore: r4(best.contrastScore),
    colorBlockScore: r4(best.colorBlockScore),
    verticalStrokeVariance: r4(best.verticalStrokeVariance),
    verticalTextBoost: best.verticalTextBoost,
    band: best.band,
    menuId: menuMatch?.id ?? null,
    physicalTabLabel: canonicalLabel,
    aliasKey: aliasHint?.aliasKey ?? null,
    imageWidth: quad.fullWidth,
    imageHeight: quad.fullHeight,
  };
}

async function harvestAll(): Promise<HarvestRow[]> {
  const out: HarvestRow[] = [];
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    process.stdout.write(`\r[${String(p).padStart(2, '0')}/${TOTAL_PAGES}] scanning…`);
    try {
      out.push(await scanOnePage(p));
    } catch (err) {
      out.push({ pdfPage: p, ok: false, reason: 'error', error: String((err as Error)?.message ?? err) });
    }
  }
  process.stdout.write('\n');
  return out;
}

function fmtFloat(n: number): string {
  const v = Math.round(n * 10000) / 10000;
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

/** 仅当候选 `colorBlockScore ≥ 阈值` 时写回 `hOffsetPercent`（内嵌色条强特征）；否则仅更新 `vOffsetPercent`，水平回退右缘。 */
const COLOR_BLOCK_MIN_FOR_H = 0.35;

function applyHarvestToNavSource(src: string, hMap: Map<number, Extract<HarvestRow, { ok: true }>>): string {
  const blockRe =
    /\{\s*kind:\s*'(?:section|product)',\s*id:\s*'([^']+)',\s*pdfPage:\s*(\d+),[\s\S]*?\n\s*\},\n/g;
  return src.replace(blockRe, (block, _id: string, pdfPageStr: string) => {
    const pdfPage = Number(pdfPageStr);
    const h = hMap.get(pdfPage);
    if (!h) return block;

    const writeH = h.colorBlockScore >= COLOR_BLOCK_MIN_FOR_H;

    // 以首行 `kind:` 前导空白作为块内字段缩进，避免 indent 错位
    const indentMatch = block.match(/\n?(\s*)kind:/);
    const indent = indentMatch ? indentMatch[1] : '    ';

    let next = block;
    const vLineRe = /^\s*vOffsetPercent:\s*([\d.-]+),\s*\n/m;
    if (vLineRe.test(next)) {
      next = next.replace(vLineRe, `${indent}vOffsetPercent: ${fmtFloat(h.vOffsetPercent)},\n`);
    } else {
      next = next.replace(
        /^(\s*)physicalTabLabel:\s*'[^']+',\s*\n/m,
        (line) => `${line}${indent}vOffsetPercent: ${fmtFloat(h.vOffsetPercent)},\n`,
      );
    }

    const hLineRe = /^\s*hOffsetPercent:\s*([\d.-]+),\s*\n/m;
    if (writeH) {
      if (hLineRe.test(next)) {
        next = next.replace(hLineRe, `${indent}hOffsetPercent: ${fmtFloat(h.hOffsetPercent)},\n`);
      } else {
        next = next.replace(
          /^(\s*)vOffsetPercent:\s*[-\d.]+,\s*\n/m,
          (line) => `${line}${indent}hOffsetPercent: ${fmtFloat(h.hOffsetPercent)},\n`,
        );
      }
    } else if (hLineRe.test(next)) {
      next = next.replace(hLineRe, '');
    }
    return next;
  });
}

async function main() {
  await fs.mkdir(HARVEST_OUT_DIR, { recursive: true });
  const rows = await harvestAll();
  const okCount = rows.filter((r) => r.ok).length;
  const missedPages = rows.filter((r) => !r.ok).map((r) => r.pdfPage);
  const report = {
    generatedAt: new Date().toISOString(),
    totalPages: TOTAL_PAGES,
    okPages: okCount,
    missedPages,
    quadrant: HOYA_TOP_RIGHT_QUADRANT_REL,
    rows,
  };
  await fs.writeFile(HARVEST_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(`候选报表：${path.relative(ROOT, HARVEST_JSON)}  (命中 ${okCount}/${TOTAL_PAGES})`);

  if (!DO_APPLY) {
    console.log('(dry-run) 未写回 hoyaSeriesNav.ts；加 --apply 生效。');
    return;
  }

  const hMap = new Map<number, Extract<HarvestRow, { ok: true }>>();
  for (const r of rows) if (r.ok) hMap.set(r.pdfPage, r);

  const tsSource = await fs.readFile(NAV_FILE, 'utf8');
  await fs.writeFile(NAV_FILE + '.bak', tsSource, 'utf8');
  const next = applyHarvestToNavSource(tsSource, hMap);
  if (next === tsSource) {
    console.log('未产生修改（可能菜单块解析未命中；请检查 hoyaSeriesNav.ts 对齐）。');
    return;
  }
  await fs.writeFile(NAV_FILE, next, 'utf8');
  console.log(`已写回：${path.relative(ROOT, NAV_FILE)}（备份：hoyaSeriesNav.ts.bak）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
