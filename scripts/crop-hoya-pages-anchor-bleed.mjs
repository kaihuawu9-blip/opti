/**
 * 豪雅 `public/catalog/hoya/pages/p{n}.jpg`：
 * - **Physical Anchor 页**（与 `HOYA_SERIES_MENU` / `isHoyaPhysicalAnchorPdfPage` 一致）：
 *   1. 多色裁切线（红 / 品红紫 / 青）→ 定位 top / bottom / 对侧内边；
 *   2. 黄标签像素范围 → 判定「凸出侧」（left / right）与垂直窗口 [yTop, yBot]；
 *   3. 以「标签外缘」为该侧裁切 bbox，**标签垂直窗口之外** 把超过「内侧基准线」的像素 alpha 置 0；
 *   输出 **PNG**（透明通道，前端点击可精准穿透）。
 * - **非锚点页**：原样复制为 JPG。
 *
 * 输出：`public/catalog/hoya/pages/pages_s/`（锚点 `.png`，其它 `.jpg`）
 *
 * 运行：`node scripts/crop-hoya-pages-anchor-bleed.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'public', 'catalog', 'hoya', 'pages');
/** 与 `src/data/hoyaSeriesNav.ts` 中 `HOYA_SERIES_MENU` 的 `pdfPage` 同步 */
const HOYA_PHYSICAL_ANCHOR_PDF_PAGES = new Set([1, 8, 9, 12, 16, 20, 27, 34, 42]);

const OUT_DIR = path.join(SRC_DIR, 'pages_s');

function rgbSaturation(r, g, b) {
  const M = Math.max(r, g, b);
  const m = Math.min(r, g, b);
  return (M - m) / 255;
}

/** 红 / 品红紫 / 青 系裁切线 */
function isGuideLineColor(r, g, b) {
  if (rgbSaturation(r, g, b) < 0.18) return false;
  const M = Math.max(r, g, b);
  if (M < 72) return false;
  if (r > 95 && r > g + 22 && r > b + 12) {
    if (r > 155 && g < 150 && b < 150 && r - g > 25 && r - b > 15) return true;
    if (r > 125 && b > 55 && r > g + 10 && b > g + 5 && r + b > g + 95) return true;
    if (r > 175 && g > 75 && g < 165 && b > 95 && b < 205 && r > g && Math.abs(r - b) < 55) return true;
  }
  if (r > 85 && b > 75 && g < Math.min(r, b) + 55 && r > g + 12 && b > g + 10 && r + b > g * 2 + 40) {
    return true;
  }
  if (b > 92 && b > r + 14 && g > 55 && g + b > r + 110 && Math.abs(g - b) < 95) {
    return true;
  }
  return false;
}

/** 「新乐学」类亮黄标签 */
function isYellowTabInk(r, g, b) {
  if (r < 170 || g < 150) return false;
  if (b > 170) return false;
  if (r - b < 32) return false;
  if (g - b < 22) return false;
  return true;
}

function collectColumnGuideCounts(data, w, h, channels) {
  const col = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      if (!isGuideLineColor(data[i], data[i + 1], data[i + 2])) continue;
      col[x]++;
    }
  }
  return col;
}

function collectRowGuideCountsMid(data, w, h, channels) {
  const row = new Uint32Array(h);
  const midX0 = Math.floor(w * 0.1);
  const midX1 = Math.floor(w * 0.9);
  for (let y = 0; y < h; y++) {
    for (let x = midX0; x <= midX1; x++) {
      const i = (y * w + x) * channels;
      if (isGuideLineColor(data[i], data[i + 1], data[i + 2])) row[y]++;
    }
  }
  return row;
}

/** 黄标 bbox（全图）；返回 null 表示未识别到黄块 */
function detectYellowTabBBox(data, w, h, channels) {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let hits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      if (!isYellowTabInk(data[i], data[i + 1], data[i + 2])) continue;
      hits++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (hits < 120 || maxX < 0) return null;
  return { minX, maxX, minY, maxY, hits };
}

/** 在 [x0, x1] 水平带中找列计数的局部峰 x（用于内侧竖线） */
function findVerticalPeakInRange(colGuide, x0, x1, h) {
  if (x1 <= x0 + 2) return -1;
  let bandMax = 0;
  for (let x = x0; x <= x1; x++) if (colGuide[x] > bandMax) bandMax = colGuide[x];
  const t = Math.max(bandMax * 0.32, h * 0.04, 12);
  let bestX = -1;
  let bestS = 0;
  for (let x = x0 + 1; x <= x1 - 1; x++) {
    const c = colGuide[x];
    if (c < t) continue;
    if (c < colGuide[x - 1] || c < colGuide[x + 1]) continue;
    if (c > bestS) {
      bestS = c;
      bestX = x;
    }
  }
  return bestX;
}

/**
 * 侦测完整几何：
 *   top / bottom：裁切线
 *   outerLeftX / outerRightX：最外裁切线 x
 *   innerLeftX / innerRightX：内侧基准线 x（紫/青/双红）
 *   tabSide: 'left' | 'right' | null
 *   tabOuterX：凸出侧的「页缘」x（含标签，用作该侧 bbox 边界）
 *   tabYTop / tabYBot：标签垂直窗口（该窗口内允许保留标签凸出；窗口外抠除）
 */
function detectGeometry(data, w, h, channels) {
  const rowGuide = collectRowGuideCountsMid(data, w, h, channels);
  const colGuide = collectColumnGuideCounts(data, w, h, channels);

  const rowStrong = Math.max(60, Math.floor(w * 0.18));
  const rowH = Math.max(38, Math.floor(w * 0.055));
  const rowWeak = Math.max(22, Math.floor(w * 0.038));
  const colThresh = Math.max(40, Math.floor(h * 0.085));

  const yTopBand = Math.floor(h * 0.32);
  const yBottomBand0 = Math.floor(h * 0.52);

  let top = -1;
  for (let y = 0; y <= yTopBand; y++) if (rowGuide[y] >= rowStrong) { top = y; break; }
  if (top < 0) for (let y = 0; y <= yTopBand; y++) if (rowGuide[y] >= rowH) { top = y; break; }

  let bottom = -1;
  for (let y = h - 1; y >= yBottomBand0; y--) if (rowGuide[y] >= rowStrong) { bottom = y; break; }
  if (bottom < 0) for (let y = h - 1; y >= yBottomBand0; y--) if (rowGuide[y] >= rowH) { bottom = y; break; }
  if (bottom < 0 || (top >= 0 && bottom <= top + Math.floor(h * 0.12))) {
    const y0 = Math.floor(h * 0.7);
    let bestY = -1;
    let bestCnt = 0;
    for (let y = y0; y < h; y++) if (rowGuide[y] > bestCnt && rowGuide[y] >= rowWeak) { bestCnt = rowGuide[y]; bestY = y; }
    if (bestY > (top >= 0 ? top : 0) + Math.floor(h * 0.15)) bottom = bestY;
  }

  let outerLeftX = -1;
  for (let x = 0; x < w; x++) if (colGuide[x] >= colThresh) { outerLeftX = x; break; }
  let outerRightX = -1;
  for (let x = w - 1; x >= 0; x--) if (colGuide[x] >= colThresh) { outerRightX = x; break; }

  if (outerLeftX < 0 || outerRightX < 0 || outerRightX <= outerLeftX + 8) return null;
  if (top < 0) top = Math.min(14, Math.floor(h * 0.018));
  if (bottom < 0 || bottom <= top + Math.floor(h * 0.08)) bottom = h - 1 - Math.min(14, Math.floor(h * 0.018));

  const bandPx = Math.floor(w * 0.16);
  let innerLeftX = findVerticalPeakInRange(colGuide, outerLeftX + 2, Math.min(w - 2, outerLeftX + bandPx), h);
  if (innerLeftX < 0) innerLeftX = outerLeftX;
  let innerRightX = findVerticalPeakInRange(colGuide, Math.max(1, outerRightX - bandPx), outerRightX - 2, h);
  if (innerRightX < 0) innerRightX = outerRightX;

  const tab = detectYellowTabBBox(data, w, h, channels);
  let tabSide = null;
  let tabOuterX = -1;
  let tabYTop = -1;
  let tabYBot = -1;
  if (tab) {
    const cx = (tab.minX + tab.maxX) / 2;
    tabSide = cx < w / 2 ? 'left' : 'right';
    tabYTop = Math.max(0, tab.minY - 2);
    tabYBot = Math.min(h - 1, tab.maxY + 2);
    tabOuterX = tabSide === 'left' ? tab.minX : tab.maxX;
  }

  return {
    top,
    bottom,
    outerLeftX,
    outerRightX,
    innerLeftX,
    innerRightX,
    tabSide,
    tabOuterX,
    tabYTop,
    tabYBot,
  };
}

/**
 * 根据几何计算最终 bbox + 抠除窗口（全图坐标）。
 * - 非标签侧用 outerInside（= 内侧线）作 bbox 边缘（紧贴裁切线），标签侧用 max(tabOuterX, outerLineX) 含标签凸出。
 * - knockoutInnerXFull / knockoutYWindow：抠除参考值。
 */
function computeCropPlan(g, w, h) {
  const pad = 3;
  let left;
  let right;
  let knockoutSide = null;
  let knockoutInnerX = -1;
  let tabYTop = -1;
  let tabYBot = -1;

  if (g.tabSide === 'left') {
    left = Math.max(0, Math.min(g.tabOuterX, g.outerLeftX) - pad);
    right = Math.min(w - 1, g.innerRightX - pad);
    knockoutSide = 'left';
    knockoutInnerX = g.innerLeftX;
    tabYTop = g.tabYTop;
    tabYBot = g.tabYBot;
  } else if (g.tabSide === 'right') {
    left = Math.max(0, g.innerLeftX + pad);
    right = Math.min(w - 1, Math.max(g.tabOuterX, g.outerRightX) + pad);
    knockoutSide = 'right';
    knockoutInnerX = g.innerRightX;
    tabYTop = g.tabYTop;
    tabYBot = g.tabYBot;
  } else {
    left = Math.max(0, g.innerLeftX + pad);
    right = Math.min(w - 1, g.innerRightX - pad);
  }

  const top = Math.max(0, g.top + pad);
  const bottom = Math.min(h - 1, g.bottom - pad);
  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw < 100 || ch < 100) return null;
  if (ch < h * 0.42 || cw < w * 0.3) return null;

  return {
    extract: { left, top, width: cw, height: ch },
    knockoutSide,
    knockoutInnerXLocal: knockoutSide ? knockoutInnerX - left : -1,
    knockoutYTopLocal: knockoutSide ? tabYTop - top : -1,
    knockoutYBotLocal: knockoutSide ? tabYBot - top : -1,
  };
}

/** 在裁切子图内做 L/门形 alpha 抠除 */
function applyTabKnockout(raw, w, h, channels, plan) {
  if (!plan.knockoutSide) return false;
  if (channels < 4) return false;
  const side = plan.knockoutSide;
  const innerLocal = plan.knockoutInnerXLocal;
  const yTop = plan.knockoutYTopLocal;
  const yBot = plan.knockoutYBotLocal;
  if (innerLocal <= 0 || innerLocal >= w - 1) return false;
  if (yTop < 0 || yBot < 0 || yBot <= yTop) return false;

  for (let y = 0; y < h; y++) {
    const insideTabBand = y >= yTop && y <= yBot;
    if (insideTabBand) continue;
    if (side === 'left') {
      for (let x = 0; x < innerLocal; x++) {
        const i = (y * w + x) * channels;
        raw[i + 3] = 0;
      }
    } else {
      for (let x = innerLocal + 1; x < w; x++) {
        const i = (y * w + x) * channels;
        raw[i + 3] = 0;
      }
    }
  }
  return true;
}

async function cropAnchorPageToPng(srcPath, destPngPath) {
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const geom = detectGeometry(data, info.width, info.height, info.channels);
  if (!geom) return null;
  const plan = computeCropPlan(geom, info.width, info.height);
  if (!plan) return null;

  const { data: raw, info: inf } = await sharp(srcPath)
    .extract(plan.extract)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const didKnockout = applyTabKnockout(raw, inf.width, inf.height, inf.channels, plan);

  await sharp(raw, {
    raw: { width: inf.width, height: inf.height, channels: inf.channels },
  })
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toFile(destPngPath);

  return {
    width: inf.width,
    height: inf.height,
    tabSide: geom.tabSide,
    knockout: didKnockout,
  };
}

function removeIfExists(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
}

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Source dir missing:', SRC_DIR);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const names = fs
    .readdirSync(SRC_DIR)
    .filter((n) => /^p\d+\.jpe?g$/i.test(n) && !n.startsWith('.'));
  names.sort((a, b) => {
    const na = parseInt(/^p(\d+)\./i.exec(a)?.[1] ?? '0', 10);
    const nb = parseInt(/^p(\d+)\./i.exec(b)?.[1] ?? '0', 10);
    return na - nb;
  });

  let cropped = 0;
  let copied = 0;
  let failAnchor = 0;

  for (const name of names) {
    const m = /^p(\d+)\.jpe?g$/i.exec(name);
    if (!m) continue;
    const pdfN = parseInt(m[1], 10);
    const src = path.join(SRC_DIR, name);
    const destJpg = path.join(OUT_DIR, `p${pdfN}.jpg`);
    const destPng = path.join(OUT_DIR, `p${pdfN}.png`);

    try {
      const r = await cropAnchorPageToPng(src, destPng);
      if (r) {
        removeIfExists(destJpg);
        const tag = r.knockout ? `${r.tabSide}+α` : 'rect';
        console.log(`CROP p${pdfN} → ${r.width}x${r.height} [${tag}]`);
        cropped++;
      } else {
        console.warn(`no guide frame, copy original: ${name}`);
        removeIfExists(destPng);
        fs.copyFileSync(src, destJpg);
        copied++;
      }
    } catch (e) {
      console.error(`FAIL p${pdfN}:`, e.message);
      removeIfExists(destPng);
      fs.copyFileSync(src, destJpg);
      failAnchor++;
    }
  }

  console.log(`Done. out=${OUT_DIR}`);
  console.log(`  cropped → PNG: ${cropped}, copied JPG (no-frame): ${copied}, error: ${failAnchor}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
