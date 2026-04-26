/**
 * StandardEye 4.0 — 蔡司价目矩阵完整重建脚本
 *
 * 作用：
 *  1. 清除旧产品数据，按 7 大物理标签页重新分组（大系列 seriesGroup）
 *  2. 为每条价目行生成归一化坐标 coord=[x,y,w,h]（0-1，单页）
 *  3. 补录缺失产品（防蓝光单光、A系列、室内型、数码型、驾驶型、户外镜片等）
 *  4. 保留原 handbookPageImageData（base64 图不重建）
 *
 * 运行：node scripts/zeiss-matrix-v4-rebuild.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const JSON_IN  = resolve(__dir, '../ai-data/zeiss_digital_handbook/2026_price_matrix.json');
const JSON_OUT = resolve(__dir, '../ai-data/zeiss_digital_handbook/2026_price_matrix.json');
const FLAT_OUT = resolve(__dir, '../ai-data/zeiss_digital_handbook/zeiss_cashier_flat_v4.json');

// ─── 坐标生成 ────────────────────────────────────────────────────────────────
// 采用自动推断：按子集内 index 排序确定列；按膜层出现顺序确定行。
// 标配类 → 上半页 (tableIdx=0)；焕色/偏光类 → 下半页 (tableIdx=1)

const TABLE_Y_START  = [0.265, 0.590];     // 上/下 price table 首行 Y
const ROW_H = 0.065;
const CELL_W = 0.155;
const CELL_H = 0.055;

const COL_X = {
  2: [0.380, 0.620],
  3: [0.310, 0.500, 0.700],
  4: [0.260, 0.410, 0.580, 0.740],
  5: [0.220, 0.340, 0.460, 0.600, 0.740],
  6: [0.190, 0.300, 0.405, 0.515, 0.618, 0.722],
};

function makeCoord(colIdx, rowIdx, tableIdx) {
  const xArr = COL_X[4];          // 默认 4 列，下面会动态替换
  return [xArr[colIdx] ?? 0.5, TABLE_Y_START[tableIdx] + rowIdx * ROW_H, CELL_W, CELL_H];
}

function attachCoords(series) {
  for (const subset of series) {
    const isLower = subset.colorFeature === 'photochromic' || subset.colorFeature === 'polarized';
    const tableIdx = isLower ? 1 : 0;

    const indices = [...new Set(subset.rows.map(r => Number(r.index)))].sort((a, b) => a - b);
    const coatings = [];
    for (const r of subset.rows) {
      const k = r.coatingCode || r.coating;
      if (!coatings.includes(k)) coatings.push(k);
    }

    const numCols = Math.min(6, indices.length);
    const cols = COL_X[numCols] || COL_X[4];

    for (const row of subset.rows) {
      const ci = indices.indexOf(Number(row.index));
      const ri = coatings.indexOf(row.coatingCode || row.coating);
      const x = cols[Math.max(0, ci)] ?? 0.5;
      const y = TABLE_Y_START[tableIdx] + Math.max(0, ri) * ROW_H;
      row.coord = [
        Math.round(x   * 1000) / 1000,
        Math.round(y   * 1000) / 1000,
        CELL_W,
        CELL_H,
      ];
    }
  }
}

// ─── 完整产品目录定义 ─────────────────────────────────────────────────────────
// 格式：每行 [index, coatingCode, coatingName, retailYuan, tintable]

// 常用膜层名
const C = {
  DP:    '钻立方铂金膜',
  BP:    '钻立方防蓝光膜',
  DVC:   '钻立方绿晶膜',
  DG:    '钻立方鎏金膜',
  BLDV:  '防蓝光Plus+钻立方铂金膜防卫版',
  BLDG:  '防蓝光Plus+钻立方鎏金膜',
  BLDP:  '防蓝光Plus+钻立方铂金膜',
  DVK:   '钻立方爱动膜',
  LT:    '蔡司莲花膜',
  DD:    '钻立方极光膜',
  DVJ:   '蔡司清晖膜',
  BLDVJ: '防蓝光Plus+清晖膜',
  CPJ:   '蔡司清晖膜',    // A系列渐进用同款
};

// 帮助：生成行
function r(index, code, retailYuan, tintable) {
  return { index, coatingCode: code, coating: C[code] ?? code, retailYuan, tintable };
}
// 标配 subset
function std(rows) {
  return { name: '标配', colorFeature: null, rows };
}
// 焕色 subset
function pc(rows) {
  return { name: '焕色视界X', colorFeature: 'photochromic', rows };
}
// 偏光 subset
function pol(rows, name = '偏光') {
  return { name, colorFeature: 'polarized', rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// 系列1：智锐系列  (physicalTabPdfPage: 10)
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    productName: '智锐单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 14, printedPage: 5 },
    series: [
      std([
        r(1.5,  'DP', 2680, true),  r(1.6,  'DP', 3480, true),  r(1.67, 'DP', 4580, true),  r(1.74, 'DP', 5980, false),
        r(1.5,  'BP', 2780, false), r(1.6,  'BP', 3580, false), r(1.67, 'BP', 4680, false), r(1.74, 'BP', 6080, false),
        r(1.5,  'BLDV', 2980, false),r(1.6, 'BLDV', 3780, false),r(1.67,'BLDV', 4880, false),r(1.74,'BLDV', 6280, false),
        r(1.5,  'DG', 3680, true),  r(1.6,  'DG', 4480, true),  r(1.67, 'DG', 5580, true),  r(1.74, 'DG', 6980, false),
      ]),
      pol([
        r(1.5,  'DP', 3080, false), r(1.6,  'DP', 4180, false), r(1.67, 'DP', 5480, false),
        r(1.5,  'DG', 4080, false), r(1.6,  'DG', 5180, false), r(1.67, 'DG', 6480, false),
      ], '偏光（灰/褐/绿）'),
      pc([
        r(1.5,  'DP', 3080, false), r(1.6,  'DP', 4180, false), r(1.67, 'DP', 5480, false), r(1.74, 'DP', 7180, false),
        r(1.5,  'DG', 4080, false), r(1.6,  'DG', 5180, false), r(1.67, 'DG', 6480, false), r(1.74, 'DG', 8180, false),
      ]),
    ],
  },
  {
    productName: '智锐臻选版单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 15, printedPage: 6 },
    series: [
      std([
        r(1.5,  'DP', 4480, true),   r(1.6,  'DP', 5880, true),  r(1.67, 'DP', 7980, true),   r(1.74, 'DP', 10580, false),
        r(1.5,  'BP', 4580, false),  r(1.6,  'BP', 5980, false), r(1.67, 'BP', 8080, false),  r(1.74, 'BP', 10680, false),
        r(1.5,  'BLDV', 4780, false),r(1.6,  'BLDV', 6180, false),r(1.67,'BLDV', 8280, false),r(1.74,'BLDV', 10880, false),
        r(1.5,  'DG', 5480, true),   r(1.6,  'DG', 6880, true),  r(1.67, 'DG', 8980, true),   r(1.74, 'DG', 11580, false),
      ]),
      pol([
        r(1.5,  'DP', 5580, false),  r(1.6,  'DP', 6980, false), r(1.67, 'DP', 9580, false),  r(1.74, 'DP', 12680, false),
        r(1.5,  'DG', 6580, false),  r(1.6,  'DG', 7980, false), r(1.67, 'DG', 10580, false), r(1.74, 'DG', 13680, false),
      ], '偏光（灰/褐/绿）'),
      pc([
        r(1.5,  'DP', 5580, false),  r(1.6,  'DP', 6980, false), r(1.67, 'DP', 9580, false),  r(1.74, 'DP', 12680, false),
        r(1.5,  'DG', 6580, false),  r(1.6,  'DG', 7980, false), r(1.67, 'DG', 10580, false), r(1.74, 'DG', 13680, false),
      ]),
    ],
  },
  {
    productName: '智锐个化版3.0单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 16, printedPage: 7 },
    series: [
      std([
        r(1.5,  'DP', 9480,  true),  r(1.6,  'DP', 14680, true),  r(1.67, 'DP', 17780, true),  r(1.74, 'DP', 23480, false),
        r(1.5,  'BP', 9580,  false), r(1.6,  'BP', 14780, false), r(1.67, 'BP', 17880, false), r(1.74, 'BP', 23580, false),
        r(1.5,  'BLDV', 9780, false),r(1.6, 'BLDV', 14980, false),r(1.67,'BLDV', 18080, false),r(1.74,'BLDV', 23780, false),
        r(1.5,  'DG', 10480, true),  r(1.6,  'DG', 15680, true),  r(1.67, 'DG', 18780, true),  r(1.74, 'DG', 24480, false),
      ]),
      pol([
        r(1.5,  'DP', 11380, false), r(1.6,  'DP', 18680, false), r(1.67, 'DP', 22880, false), r(1.74, 'DP', 28180, false),
        r(1.5,  'DG', 12380, false), r(1.6,  'DG', 19680, false), r(1.67, 'DG', 23880, false), r(1.74, 'DG', 29180, false),
      ], '偏光（灰/褐/绿）'),
      pc([
        r(1.5,  'DP', 11380, false), r(1.6,  'DP', 18680, false), r(1.67, 'DP', 22880, false), r(1.74, 'DP', 28180, false),
        r(1.5,  'DG', 12380, false), r(1.6,  'DG', 19680, false), r(1.67, 'DG', 23880, false), r(1.74, 'DG', 29180, false),
      ]),
    ],
  },
  {
    productName: '智锐数码型亚洲版',
    brand: 'ZEISS', lensType: 'Digital-PAL', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 18, printedPage: 9 },
    series: [
      std([
        r(1.5,  'DP', 2780, true),  r(1.6,  'DP', 3880, true),  r(1.67, 'DP', 5380, true),  r(1.74, 'DP', 6880, false),
        r(1.5,  'BP', 2880, false), r(1.6,  'BP', 3980, false), r(1.67, 'BP', 5480, false), r(1.74, 'BP', 6980, false),
        r(1.5, 'BLDV', 3080, false),r(1.6,'BLDV', 4180, false), r(1.67,'BLDV', 5680, false),r(1.74,'BLDV', 7180, false),
        r(1.5,  'DG', 3780, true),  r(1.6,  'DG', 4880, true),  r(1.67, 'DG', 6380, true),  r(1.74, 'DG', 7880, false),
      ]),
      pc([
        r(1.5,  'DP', 3480, false), r(1.6,  'DP', 4680, false), r(1.67, 'DP', 6480, false), r(1.74, 'DP', 8280, false),
        r(1.5,  'DG', 4480, false), r(1.6,  'DG', 5680, false), r(1.67, 'DG', 7480, false), r(1.74, 'DG', 9280, false),
      ]),
    ],
  },
  {
    productName: '智锐数码型个化版3.0',
    brand: 'ZEISS', lensType: 'Digital-PAL', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 19, printedPage: 10 },
    series: [
      std([
        r(1.5,  'DP', 5880,  true),  r(1.6,  'DP', 8580,  true),  r(1.67, 'DP', 12380, true),  r(1.74, 'DP', 16680, false),
        r(1.5,  'BP', 5980,  false), r(1.6,  'BP', 8680,  false), r(1.67, 'BP', 12480, false), r(1.74, 'BP', 16780, false),
        r(1.5, 'BLDV', 6180, false), r(1.6,'BLDV', 8880,  false), r(1.67,'BLDV', 12680, false),r(1.74,'BLDV', 16980, false),
        r(1.5,  'DG', 6880,  true),  r(1.6,  'DG', 9580,  true),  r(1.67, 'DG', 13380, true),  r(1.74, 'DG', 17680, false),
      ]),
      pc([
        r(1.5,  'DP', 7080,  false), r(1.6,  'DP', 10280, false), r(1.67, 'DP', 14880, false), r(1.74, 'DP', 20080, false),
        r(1.5,  'DG', 8080,  false), r(1.6,  'DG', 11280, false), r(1.67, 'DG', 15880, false), r(1.74, 'DG', 21080, false),
      ]),
    ],
  },
  {
    productName: '智锐经典版渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 21, printedPage: 12 },
    series: [
      std([
        r(1.5,  'DP', 3280, true),  r(1.6,  'DP', 4480, true),  r(1.67, 'DP', 6280, true),  r(1.74, 'DP', 9280,  false),
        r(1.5,  'BP', 3380, false), r(1.6,  'BP', 4580, false), r(1.67, 'BP', 6380, false), r(1.74, 'BP', 9380,  false),
        r(1.5, 'BLDV',3580, false), r(1.6,'BLDV', 4780, false), r(1.67,'BLDV', 6580, false),r(1.74,'BLDV', 9580,  false),
        r(1.5,  'DG', 4280, true),  r(1.6,  'DG', 5480, true),  r(1.67, 'DG', 7280, true),  r(1.74, 'DG', 10280, false),
      ]),
      pc([
        r(1.5,  'DP', 3980, false), r(1.6,  'DP', 5380, false), r(1.67, 'DP', 7580, false), r(1.74, 'DP', 11180, false),
        r(1.5,  'DG', 4980, false), r(1.6,  'DG', 6380, false), r(1.67, 'DG', 8580, false), r(1.74, 'DG', 12180, false),
      ]),
    ],
  },
  {
    productName: '智锐亚洲版渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 22, printedPage: 13 },
    series: [
      std([
        r(1.5,  'DP', 4680,  true),  r(1.6,  'DP', 6280,  true),  r(1.67, 'DP', 8380,  true),  r(1.74, 'DP', 12280, false),
        r(1.5,  'BP', 4780,  false), r(1.6,  'BP', 6380,  false), r(1.67, 'BP', 8480,  false), r(1.74, 'BP', 12380, false),
        r(1.5, 'BLDV', 4980, false), r(1.6,'BLDV', 6580,  false), r(1.67,'BLDV', 8680, false),  r(1.74,'BLDV',12580, false),
        r(1.5,  'DG', 5680,  true),  r(1.6,  'DG', 7280,  true),  r(1.67, 'DG', 9380,  true),  r(1.74, 'DG', 13280, false),
      ]),
      pc([
        r(1.5,  'DP', 5580,  false), r(1.6,  'DP', 7580,  false), r(1.67, 'DP', 9880,  false), r(1.74, 'DP', 14680, false),
        r(1.5,  'DG', 6580,  false), r(1.6,  'DG', 8580,  false), r(1.67, 'DG', 10880, false), r(1.74, 'DG', 15680, false),
      ]),
    ],
  },
  {
    productName: '智锐臻选版渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 23, printedPage: 14 },
    series: [
      std([
        r(1.5,  'DP', 8280,  true),  r(1.6,  'DP', 10680, true),  r(1.67, 'DP', 13480, true),  r(1.74, 'DP', 25980, false),
        r(1.5,  'BP', 8380,  false), r(1.6,  'BP', 10780, false), r(1.67, 'BP', 13580, false), r(1.74, 'BP', 26080, false),
        r(1.5, 'BLDV', 8580, false), r(1.6,'BLDV', 10980, false), r(1.67,'BLDV', 13780, false),r(1.74,'BLDV', 26280, false),
        r(1.5,  'DG', 9280,  true),  r(1.6,  'DG', 11680, true),  r(1.67, 'DG', 14480, true),  r(1.74, 'DG', 26980, false),
      ]),
      pc([
        r(1.5,  'DP', 9880,  false), r(1.6,  'DP', 12980, false), r(1.67, 'DP', 16180, false), r(1.74, 'DP', 31180, false),
        r(1.5,  'DG', 10880, false), r(1.6,  'DG', 13980, false), r(1.67, 'DG', 17180, false), r(1.74, 'DG', 32180, false),
      ]),
    ],
  },
  {
    productName: '智锐个化版3.0渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '智锐系列',
    catalog_page_reference: { pdfIndex: 24, printedPage: 15 },
    series: [
      std([
        r(1.5,  'DP', 17580, true),  r(1.6,  'DP', 31480, true),  r(1.67, 'DP', 40580, false), r(1.74, 'DP', 52480, false),
        r(1.5,  'BP', 17680, false), r(1.6,  'BP', 31580, false), r(1.67, 'BP', 40680, false), r(1.74, 'BP', 52580, false),
        r(1.5, 'BLDV',17880, false), r(1.6,'BLDV', 31780, false), r(1.67,'BLDV', 40880, false),r(1.74,'BLDV', 52780, false),
        r(1.5,  'DG', 18580, true),  r(1.6,  'DG', 32480, true),  r(1.67, 'DG', 41580, true),  r(1.74, 'DG', 53480, false),
      ]),
      pc([
        r(1.5,  'DP', 24980, false), r(1.6,  'DP', 39680, false), r(1.67, 'DP', 51180, false), r(1.74, 'DP', 62980, false),
        r(1.5,  'DG', 25980, false), r(1.6,  'DG', 40680, false), r(1.67, 'DG', 52180, false), r(1.74, 'DG', 63980, false),
      ]),
    ],
  },

  // ─── 系列2：青少年系列 ───────────────────────────────────────────────────────

  {
    productName: '小乐圆H版',
    brand: 'ZEISS', lensType: 'MyopiaControl', seriesGroup: '青少年系列',
    catalog_page_reference: { pdfIndex: 29, printedPage: 20 },
    series: [
      std([
        r(1.59, 'DP', 3280, false), // 1.59 PC 成品
        r(1.5,  'DP', 3680, false), r(1.59, 'DP', 3980, false), r(1.6, 'DP', 4580, false), r(1.67, 'DP', 5380, false),
        r(1.5,  'BP', 3780, false), r(1.59, 'BP', 4080, false), r(1.6,  'BP', 4680, false), r(1.67, 'BP', 5480, false),
      ]),
    ],
  },
  {
    productName: '小乐圆S版',
    brand: 'ZEISS', lensType: 'MyopiaControl', seriesGroup: '青少年系列',
    catalog_page_reference: { pdfIndex: 30, printedPage: 21 },
    series: [
      std([
        r(1.59, 'DVK', 2980, false), // 1.59 PC 成品
        r(1.5,  'DP', 3680, false),  r(1.59, 'DP', 3980, false),  r(1.6, 'DP', 4580, false),  r(1.67, 'DP', 5380, false),
        r(1.5,  'BP', 3780, false),  r(1.59, 'BP', 4080, false),  r(1.6,  'BP', 4680, false),  r(1.67, 'BP', 5480, false),
      ]),
    ],
  },
  {
    productName: '成长怡',
    brand: 'ZEISS', lensType: 'MyopiaControl', seriesGroup: '青少年系列',
    catalog_page_reference: { pdfIndex: 32, printedPage: 23 },
    series: [
      std([
        r(1.59, 'DVK', 2180, false), // 成品
        r(1.59, 'DVK', 2380, false), // 定制
      ]),
    ],
  },

  // ─── 系列3：单光系列 ────────────────────────────────────────────────────────

  {
    productName: '泽锐单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '单光系列',
    catalog_page_reference: { pdfIndex: 36, printedPage: 27 },
    series: [
      std([
        // 成品镜片（不可染色）
        r(1.56, 'DVC', 1480, false), r(1.56, 'DP', 1980, false), r(1.56, 'BP', 2080, false), r(1.56, 'BLDP', 2280, false), r(1.56, 'DG', 2980, false),
        r(1.59, 'DP', 2380, false),
        r(1.6,  'DP', 2580, false), r(1.6,  'BP', 2680, false), r(1.6,  'BLDP', 2880, false), r(1.6,  'DG', 3580, false), r(1.6,  'BLDG', 3880, false),
        r(1.67, 'DP', 3480, false), r(1.67, 'BP', 3580, false), r(1.67, 'BLDP', 3780, false), r(1.67, 'DG', 4480, false), r(1.67, 'BLDG', 4780, false),
        r(1.74, 'DP', 4480, false), r(1.74, 'BP', 4580, false), r(1.74, 'BLDP', 4780, false), r(1.74, 'DG', 5480, false), r(1.74, 'BLDG', 5780, false),
        // 定制镜片（可染色）
        r(1.6,  'DVC', 2280, true), r(1.67, 'DVC', 3180, true),
        r(1.6,  'DP',  2780, true), r(1.67, 'DP',  3680, true), r(1.74, 'DP', 4180, false),
      ]),
      pol([
        r(1.56, 'DVC', 1980, false), r(1.6, 'DVC', 2480, false),
        r(1.56, 'DP',  2480, false), r(1.6, 'DP',  2980, false),
      ], '偏光视界X'),
      pc([
        r(1.6,  'DVC', 3080, false), r(1.67, 'DVC', 3980, false),
        r(1.6,  'DP',  3580, false), r(1.67, 'DP',  4980, false), r(1.74, 'DP', 5380, false),
        r(1.6,  'DG',  4580, false), r(1.67, 'DG',  5980, false), r(1.74, 'DG', 6880, false),
      ]),
    ],
  },
  {
    productName: '新清锐非球面',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '单光系列',
    catalog_page_reference: { pdfIndex: 37, printedPage: 28 },
    series: [
      std([
        r(1.56, 'DP', 1580, false), r(1.6,  'DP', 2380, false), r(1.67, 'DP', 3280, false), r(1.74, 'DP', 4280, false),
        r(1.6,  'DP', 2980, true),  r(1.67, 'DP', 4080, true),   // 定制版
      ]),
      pc([
        r(1.6,  'DP', 3580, false), r(1.67, 'DP', 5880, false),
      ]),
    ],
  },
  {
    productName: '防蓝光单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '单光系列',
    catalog_page_reference: { pdfIndex: 38, printedPage: 29 },
    series: [
      std([
        r(1.5,  'BP', 1180, false), r(1.56, 'BP', 1480, false),
        r(1.6,  'BP', 2080, false), r(1.67, 'BP', 2980, false), r(1.74, 'BP', 3980, false),
      ]),
    ],
  },
  {
    productName: 'A系列2.0单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '单光系列',
    catalog_page_reference: { pdfIndex: 39, printedPage: 30 },
    series: [
      std([
        r(1.5,  'DVJ', 680,  false), r(1.56, 'DVJ', 980,  false),
        r(1.6,  'DVJ', 1380, false), r(1.67, 'DVJ', 1980, false), r(1.74, 'DVJ', 3280, false),
        r(1.6,  'BLDVJ', 1680, false), r(1.67, 'BLDVJ', 2380, false),
        // 定制版（可染色）
        r(1.6,  'DVJ', 1780, true),  r(1.67, 'DVJ', 2380, true),  r(1.74, 'DVJ', 3580, false),
      ]),
      pc([
        r(1.5,  'DVJ', 1580, false), r(1.6,  'DVJ', 2180, false),
        r(1.67, 'DVJ', 3580, false), r(1.74, 'DVJ', 4580, false),
      ]),
    ],
  },
  {
    productName: 'A系列时尚型单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '单光系列',
    catalog_page_reference: { pdfIndex: 40, printedPage: 31 },
    series: [
      std([
        r(1.6,  'LT', 1980, true), r(1.67, 'LT', 2680, true),
      ]),
    ],
  },

  // ─── 系列4：渐进系列 ────────────────────────────────────────────────────────

  {
    productName: '睐光2.0轻渐进专业版',
    brand: 'ZEISS', lensType: 'Light-Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 43, printedPage: 34 },
    series: [
      std([
        r(1.5,  'DVC', 1580, true),  r(1.6,  'DVC', 2580, true),  r(1.67, 'DVC', 3780, true),  r(1.74, 'DVC', 5080, false),
        r(1.5,  'DP',  2080, true),  r(1.6,  'DP',  3080, true),  r(1.67, 'DP',  4280, true),  r(1.74, 'DP',  5580, false),
        r(1.5,  'BP',  2180, false), r(1.6,  'BP',  3180, false), r(1.67, 'BP',  4380, false), r(1.74, 'BP',  5680, false),
        r(1.5, 'BLDV', 2380, false), r(1.6,'BLDV',  3380, false), r(1.67,'BLDV', 4580, false), r(1.74,'BLDV', 5880, false),
        r(1.5,  'DG',  3080, true),  r(1.6,  'DG',  4080, true),  r(1.67, 'DG',  5280, true),  r(1.74, 'DG',  6580, false),
      ]),
      pc([
        r(1.5,  'DVC', 2180, false), r(1.6,  'DVC', 3480, false), r(1.67, 'DVC', 4980, false),
        r(1.5,  'DP',  2680, false), r(1.6,  'DP',  3980, false), r(1.67, 'DP',  5480, false),
        r(1.5,  'DG',  3680, false), r(1.6,  'DG',  4980, false), r(1.67, 'DG',  6480, false),
      ]),
    ],
  },
  {
    productName: '睐光2.0轻渐进个化版',
    brand: 'ZEISS', lensType: 'Light-Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 44, printedPage: 35 },
    series: [
      std([
        r(1.5,  'DP',   3380, true),  r(1.6,  'DP',   4680, true),  r(1.67, 'DP',   6680, true),  r(1.74, 'DP',   8880, false),
        r(1.5,  'BP',   3480, false), r(1.6,  'BP',   4780, false), r(1.67, 'BP',   6780, false), r(1.74, 'BP',   8980, false),
        r(1.5, 'BLDV',  3680, false), r(1.6,'BLDV',   4980, false), r(1.67,'BLDV',  6980, false), r(1.74,'BLDV',  9180, false),
        r(1.5,  'DG',   4380, true),  r(1.6,  'DG',   5680, true),  r(1.67, 'DG',   7680, true),  r(1.74, 'DG',   9880, false),
      ]),
      pc([
        r(1.5,  'DP',   4280, false), r(1.6,  'DP',   5880, false), r(1.67, 'DP',   8680, false),
        r(1.5,  'DG',   5280, false), r(1.6,  'DG',   6880, false), r(1.67, 'DG',   9680, false),
      ]),
    ],
  },
  {
    productName: '睐光2.0 D渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 46, printedPage: 37 },
    series: [
      std([
        r(1.5,  'DVC', 1660, true),  r(1.6,  'DVC', 2660, true),  r(1.67, 'DVC', 3880, true),  r(1.74, 'DVC', 5180, false),
        r(1.5,  'DP',  2180, true),  r(1.6,  'DP',  3180, true),  r(1.67, 'DP',  4380, true),  r(1.74, 'DP',  5680, false),
        r(1.5,  'BP',  2280, false), r(1.6,  'BP',  3280, false), r(1.67, 'BP',  4480, false), r(1.74, 'BP',  5780, false),
        r(1.5, 'BLDV', 2480, false), r(1.6,'BLDV',  3480, false), r(1.67,'BLDV', 4680, false),
        r(1.5,  'DG',  3180, true),  r(1.6,  'DG',  4180, true),  r(1.67, 'DG',  5380, true),  r(1.74, 'DG',  6680, false),
      ]),
      pc([
        r(1.5,  'DVC', 2480, false), r(1.6,  'DVC', 3880, false), r(1.67, 'DVC', 5480, false), r(1.74, 'DVC', 6380, false),
        r(1.5,  'DP',  2980, false), r(1.6,  'DP',  4380, false), r(1.67, 'DP',  5980, false), r(1.74, 'DP',  6880, false),
        r(1.5,  'DG',  3980, false), r(1.6,  'DG',  5380, false), r(1.67, 'DG',  6980, false), r(1.74, 'DG',  7880, false),
      ]),
    ],
  },
  {
    productName: '睐光2.0 3D渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 47, printedPage: 38 },
    series: [
      std([
        r(1.5,  'DP',  2780, true),  r(1.6,  'DP',  4080, true),  r(1.67, 'DP',  5980, true),  r(1.74, 'DP',  7780, false),
        r(1.5,  'BP',  2880, false), r(1.6,  'BP',  4180, false), r(1.67, 'BP',  6080, false), r(1.74, 'BP',  7880, false),
        r(1.5, 'BLDV', 3080, false), r(1.6,'BLDV',  4380, false), r(1.67,'BLDV', 6280, false),
        r(1.5,  'DG',  3780, true),  r(1.6,  'DG',  5080, true),  r(1.67, 'DG',  6980, true),  r(1.74, 'DG',  8780, false),
      ]),
      pc([
        r(1.5,  'DP',  3780, false), r(1.6,  'DP',  5580, false), r(1.67, 'DP',  8280, false), r(1.74, 'DP',  9480, false),
        r(1.5,  'DG',  4780, false), r(1.6,  'DG',  6580, false), r(1.67, 'DG',  9280, false), r(1.74, 'DG', 10480, false),
      ]),
    ],
  },
  {
    productName: '室内型三维博锐2.0',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 49, printedPage: 40 },
    series: [
      std([
        r(1.5,  'DP',  3480, true),  r(1.6,  'DP',  4480, true),  r(1.67, 'DP',  5480, true),
        r(1.5,  'BP',  3580, false), r(1.6,  'BP',  4580, false), r(1.67, 'BP',  5580, false),
        r(1.5, 'BLDV', 3780, false), r(1.6,'BLDV',  4780, false), r(1.67,'BLDV', 5780, false),
      ]),
    ],
  },
  {
    productName: '室内型臻锐',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 50, printedPage: 41 },
    series: [
      std([
        r(1.5,  'DP',   5480,  true),  r(1.6,  'DP',   8480,  true),  r(1.67, 'DP',  11300, true),
        r(1.5,  'BP',   5580,  false), r(1.6,  'BP',   8580,  false), r(1.67, 'BP',  11400, false),
        r(1.5, 'BLDV',  5780,  false), r(1.6,'BLDV',   8780,  false), r(1.67,'BLDV', 11600, false),
      ]),
    ],
  },
  {
    productName: 'A系列2.0渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 51, printedPage: 42 },
    series: [
      std([
        r(1.5,  'CPJ', 1380, true),  r(1.6,  'CPJ', 1980, true),  r(1.67, 'CPJ', 2980, true),  r(1.74, 'CPJ', 3980, false),
      ]),
      pc([
        r(1.5,  'CPJ', 2180, false), r(1.6,  'CPJ', 2980, false), r(1.67, 'CPJ', 4480, false),
      ]),
    ],
  },
  {
    productName: 'A系列康乐型',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '渐进系列',
    catalog_page_reference: { pdfIndex: 52, printedPage: 43 },
    series: [
      std([
        r(1.5,  'LT', 1080, true), r(1.6,  'LT', 1680, true), r(1.67, 'LT', 2680, true),
      ]),
    ],
  },

  // ─── 系列5：数码型 ──────────────────────────────────────────────────────────

  {
    productName: '数码型(标准级)',
    brand: 'ZEISS', lensType: 'Digital-PAL', seriesGroup: '数码型',
    catalog_page_reference: { pdfIndex: 54, printedPage: 45 },
    series: [
      std([
        r(1.5,  'LT', 1180, true),  r(1.6,  'LT', 1880, true),
        r(1.5,  'BP', 1780, false), r(1.6,  'BP', 2480, false),
      ]),
    ],
  },
  {
    productName: '数码型',
    brand: 'ZEISS', lensType: 'Digital-PAL', seriesGroup: '数码型',
    catalog_page_reference: { pdfIndex: 55, printedPage: 46 },
    series: [
      std([
        r(1.5,  'DP',   1880, true),  r(1.6,  'DP',   2880, true),  r(1.67, 'DP',  4280, true),  r(1.74, 'DP',  5880, true),
        r(1.5,  'BP',   1980, false), r(1.6,  'BP',   2980, false), r(1.67, 'BP',  4380, false), r(1.74, 'BP',  5980, false),
        r(1.5, 'BLDV',  2180, false), r(1.6,'BLDV',   3180, false), r(1.67,'BLDV', 4580, false),
      ]),
      pc([
        r(1.5,  'DP',   3480, false), r(1.6,  'DP',   4480, false), r(1.67, 'DP',  6080, false),
      ]),
    ],
  },

  // ─── 系列6：驾驶型 ──────────────────────────────────────────────────────────

  {
    productName: '驾驶型单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '驾驶型',
    catalog_page_reference: { pdfIndex: 58, printedPage: 49 },
    series: [
      std([
        r(1.5,  'DD', 2980, false), r(1.6,  'DD', 4380, false), r(1.67, 'DD', 5680, false), r(1.74, 'DD', 7680, false),
      ]),
      pc([
        r(1.5,  'DD', 4380, false), r(1.6,  'DD', 6580, false), r(1.67, 'DD', 8580, false),
      ]),
    ],
  },
  {
    productName: '驾驶型渐进',
    brand: 'ZEISS', lensType: 'Progressive', seriesGroup: '驾驶型',
    catalog_page_reference: { pdfIndex: 59, printedPage: 50 },
    series: [
      std([
        r(1.5,  'DD', 5580,  false), r(1.6,  'DD', 6780,  false), r(1.67, 'DD', 7580,  false), r(1.74, 'DD', 12880, false),
      ]),
      pc([
        r(1.5,  'DD', 8380,  false), r(1.6,  'DD', 10180, false), r(1.67, 'DD', 11380, false),
      ]),
    ],
  },

  // ─── 系列7：户外镜片 ────────────────────────────────────────────────────────

  {
    productName: '悦慕偏光单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '户外镜片',
    catalog_page_reference: { pdfIndex: 62, printedPage: 53 },
    series: [
      pol([
        r(1.5,  'DP', 1680, false), r(1.6,  'DP', 2680, false), r(1.67, 'DP', 3680, false),
      ], '偏光视界X'),
    ],
  },
  {
    productName: '悦慕偏光变色单光',
    brand: 'ZEISS', lensType: 'SingleVision', seriesGroup: '户外镜片',
    catalog_page_reference: { pdfIndex: 63, printedPage: 54 },
    series: [
      pol([
        r(1.5,  'DP', 3680, false), r(1.6,  'DP', 4680, false),
      ], '偏光变色'),
    ],
  },
];

// ─── 主函数 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('📖 读取现有 JSON（保留 handbookPageImageData）...');
  const raw = JSON.parse(await readFile(JSON_IN, 'utf8'));

  // 为所有产品附加坐标
  console.log('📐 生成价目坐标...');
  for (const p of PRODUCTS) {
    attachCoords(p.series);
  }

  // 输出：保留元数据 + 图片数据，替换 products
  const out = {
    _description: '蔡司 2026 价目矩阵 · StandardEye 4.0 · 七大物理标签系列重建（含 coord 坐标映射）',
    _source:       raw._source,
    _effective:    raw._effective,
    _currency:     raw._currency,
    _unit:         raw._unit,
    _extractedAt:  new Date().toISOString().slice(0, 10),
    _notes: [
      '物理侧栏 7 大系列：智锐系列/青少年系列/单光系列/渐进系列/数码型/驾驶型/户外镜片',
      'coord=[centerX, centerY, width, height]，归一化 0-1，单页宽高基准',
      'tintable=true 时可染色，收银台显示层加 "(可染色)" 后缀',
      '第 8 系列（镜架/配件/附录）不含价目行，跳过',
    ],
    handbookPageImageData: raw.handbookPageImageData ?? {},
    products: PRODUCTS,
  };

  console.log(`✅ 共 ${PRODUCTS.length} 个产品，开始写入...`);
  await writeFile(JSON_OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`💾 已写入 ${JSON_OUT}`);

  // ─── 输出扁平 JSON 数组（供用户验证，膜层含可染色后缀）─────────────────────

  const flat = [];
  for (const p of PRODUCTS) {
    for (const subset of p.series) {
      for (const row of subset.rows) {
        const coatingLabel = row.tintable
          ? `${row.coating} (可染色)`
          : row.coating;
        flat.push({
          id: `zeiss:${p.seriesGroup}:${p.productName}:${subset.name}:${row.index}:${row.coatingCode}`,
          seriesGroup:   p.seriesGroup,
          productName:   p.productName,
          subsetName:    subset.name,
          index:         row.index,
          coating:       coatingLabel,
          coatingCode:   row.coatingCode,
          tintable:      row.tintable,
          retailYuan:    row.retailYuan,
          pdfPage:       p.catalog_page_reference?.pdfIndex ?? null,
          coord:         row.coord ?? null,
        });
      }
    }
  }

  await writeFile(FLAT_OUT, JSON.stringify(flat, null, 2), 'utf8');
  console.log(`📋 扁平数组已写入 ${FLAT_OUT}（共 ${flat.length} 条价目行）`);
  console.log('');
  console.log('  大系列分布:');
  const grouped = {};
  flat.forEach(f => { grouped[f.seriesGroup] = (grouped[f.seriesGroup] || 0) + 1; });
  Object.entries(grouped).forEach(([g, n]) => console.log(`    ${g}: ${n} 行`));
}

main().catch(e => { console.error(e); process.exit(1); });
