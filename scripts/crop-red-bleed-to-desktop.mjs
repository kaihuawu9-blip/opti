/**
 * 沿印刷出血红线（品红/红）检测矩形边界，裁剪内侧「成品」区域，输出到桌面。
 *
 * StandardEye：全册**不应**批量裁图；仅 **Physical Anchor Page**（`isHoyaPhysicalAnchorPdfPage` 等）
 * 需要高精度出血裁切时，用本脚本对白名单页执行。当前 `listTargetFilesInDir` 内 `want` 集合为手工示例。
 *
 * 仅处理 assets 下文件名含 `_images_p{数字}-` 的页图（与 Cursor 保存的命名一致）。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoAssets = path.join(__dirname, '..', 'assets');
const cursorAssets = path.join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'j-opti-ai3',
  'assets',
);
const DESKTOP = path.join(process.env.USERPROFILE || '', 'Desktop');

/** 品红/红出血线：偏红或偏品红；略放宽以覆盖偏粉/偏暗的印刷线 */
function isBleedRed(r, g, b) {
  if (r < 95) return false;
  // 鲜红 / 印刷红
  if (r > 155 && g < 145 && b < 145 && r - g > 28 && r - b > 18) return true;
  // 品红 / 洋红
  if (r > 125 && b > 55 && r > g + 10 && b > g + 5 && r + b > g + 95) return true;
  // 浅粉红线（部分导出）
  if (r > 180 && g > 80 && g < 160 && b > 100 && b < 200 && r > g && Math.abs(r - b) < 50) return true;
  return false;
}

function detectBounds(data, w, h, channels) {
  /** 横线检测：只统计中间水平带，避免左右竖出血线抬高每行计数 */
  const midX0 = Math.floor(w * 0.1);
  const midX1 = Math.floor(w * 0.9);
  const rowRed = new Uint32Array(h);
  const colRed = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isBleedRed(r, g, b)) continue;
      colRed[x]++;
      if (x >= midX0 && x <= midX1) rowRed[y]++;
    }
  }

  /** 竖线仍用较高阈值；横线在弱对比导出里较淡，顶/底分区用较低阈值 */
  const rowThreshStrong = Math.max(60, Math.floor(w * 0.18));
  const rowThreshH = Math.max(38, Math.floor(w * 0.055));
  const rowThreshWeak = Math.max(22, Math.floor(w * 0.038));
  const colThresh = Math.max(55, Math.floor(h * 0.12));

  const yTopBand = Math.floor(h * 0.32);
  const yBottomBand0 = Math.floor(h * 0.52);

  /** 顶横线：上 ~32% 内先强后弱 */
  let top = -1;
  for (let y = 0; y <= yTopBand; y++) {
    if (rowRed[y] >= rowThreshStrong) {
      top = y;
      break;
    }
  }
  if (top < 0) {
    for (let y = 0; y <= yTopBand; y++) {
      if (rowRed[y] >= rowThreshH) {
        top = y;
        break;
      }
    }
  }

  /** 底横线：下 ~48% 向上扫，先强后弱；再不行取底部弱峰值 */
  let bottom = -1;
  for (let y = h - 1; y >= yBottomBand0; y--) {
    if (rowRed[y] >= rowThreshStrong) {
      bottom = y;
      break;
    }
  }
  if (bottom < 0) {
    for (let y = h - 1; y >= yBottomBand0; y--) {
      if (rowRed[y] >= rowThreshH) {
        bottom = y;
        break;
      }
    }
  }
  if (bottom < 0 || (top >= 0 && bottom <= top + Math.floor(h * 0.12))) {
    const y0 = Math.floor(h * 0.7);
    let bestY = -1;
    let bestCnt = 0;
    for (let y = y0; y < h; y++) {
      if (rowRed[y] > bestCnt && rowRed[y] >= rowThreshWeak) {
        bestCnt = rowRed[y];
        bestY = y;
      }
    }
    if (bestY > (top >= 0 ? top : 0) + Math.floor(h * 0.15)) bottom = bestY;
  }

  let left = -1;
  for (let x = 0; x < w; x++) {
    if (colRed[x] >= colThresh) {
      left = x;
      break;
    }
  }
  let right = -1;
  for (let x = w - 1; x >= 0; x--) {
    if (colRed[x] >= colThresh) {
      right = x;
      break;
    }
  }

  if (left < 0 || right < 0 || right <= left + 8) {
    return null;
  }
  /** 个别页顶横线在中间带极淡：竖线已有时，顶边回退为极小安全边距 */
  if (top < 0) {
    top = Math.min(14, Math.floor(h * 0.018));
  }
  if (bottom < 0 || bottom <= top + Math.floor(h * 0.08)) {
    bottom = h - 1 - Math.min(14, Math.floor(h * 0.018));
  }

  // 向内收缩，去掉红线本身（约 2–4px）
  const inset = 3;
  const x0 = Math.max(0, left + inset);
  const y0 = Math.max(0, top + inset);
  const x1 = Math.min(w - 1, right - inset);
  const y1 = Math.min(h - 1, bottom - inset);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (cw < 100 || ch < 100) return null;
  if (ch < h * 0.42 || cw < w * 0.45) return null;
  return { left: x0, top: y0, width: cw, height: ch };
}

async function cropOne(srcPath, destPath) {
  const img = sharp(srcPath);
  const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = detectBounds(data, info.width, info.height, info.channels);
  if (!bounds) {
    console.error(`SKIP (no red frame): ${path.basename(srcPath)}`);
    return false;
  }
  await sharp(srcPath).extract(bounds).png().toFile(destPath);
  console.log(`OK ${path.basename(srcPath)} → ${bounds.width}x${bounds.height}`);
  return true;
}

function listTargetFilesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n));
  // 用户提供的 14 张：p11 p12 p15 p16 p23 p24 p39 p40 p43 p44 p47 p48 p51 p52
  const want = new Set([
    'p11',
    'p12',
    'p15',
    'p16',
    'p23',
    'p24',
    'p39',
    'p40',
    'p43',
    'p44',
    'p47',
    'p48',
    'p51',
    'p52',
  ]);
  return names.filter((n) => {
    const m = n.match(/_images_(p\d+)-/);
    return m && want.has(m[1]);
  });
}

async function main() {
  if (!fs.existsSync(DESKTOP)) {
    console.error('Desktop not found:', DESKTOP);
    process.exit(1);
  }

  let assetDir = null;
  for (const d of [cursorAssets, repoAssets]) {
    const f = listTargetFilesInDir(d);
    if (f.length > 0) {
      assetDir = d;
      break;
    }
  }
  if (!assetDir) {
    console.error('No matching pXX png in:', cursorAssets, 'or', repoAssets);
    process.exit(1);
  }

  const files = listTargetFilesInDir(assetDir);
  console.log('Source:', assetDir);
  console.log('Desktop:', DESKTOP);
  console.log('Files:', files.length);

  let ok = 0;
  for (const name of files.sort()) {
    const src = path.join(assetDir, name);
    const dest = path.join(DESKTOP, name);
    try {
      if (await cropOne(src, dest)) ok++;
    } catch (e) {
      console.error(`FAIL ${name}:`, e.message);
    }
  }
  console.log(`Done. ${ok}/${files.length} written with original filenames.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
