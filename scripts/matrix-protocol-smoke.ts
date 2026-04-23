/**
 * Matrix Protocol V1.3 — HOYA 专项自检（Node）
 * 运行：npx tsx scripts/matrix-protocol-smoke.ts
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildHandbookSeriesNavItemsForBrand,
  getHandbookPageCount,
  getPageData,
} from '../src/data/zeissHandbookPageMap';
import { HOYA_PRICE_MATRIX } from '../src/data/hoyaPriceMatrix';
import { resolveActiveHandbookNavState } from '../src/lib/catalog/dataIntegrityValidator';

const hoyaDir = join(process.cwd(), 'public', 'catalog', 'hoya');
const allFiles = existsSync(hoyaDir) ? readdirSync(hoyaDir) : [];
const imageLike = allFiles.filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f));
console.log('[HOYA] public/catalog/hoya — first 5 image-like:', imageLike.slice(0, 5));
console.log('[HOYA] public/catalog/hoya — first 5 any:', allFiles.slice(0, 5));

const n = getHandbookPageCount('hoya');
if (n === 0) {
  console.error('FAIL: HOYA handbook adapter has 0 pages');
  process.exit(1);
}
console.log('[HOYA] handbook page count:', n);

const pd = getPageData(2, 'hoya');
if (!pd || pd.product?.productName !== '新乐学' || pd.imageUrl !== '/catalog/hoya/p2.jpg') {
  console.error('FAIL: getPageData(2, hoya) expected 新乐学 + imageUrl', pd);
  process.exit(1);
}

const nav = buildHandbookSeriesNavItemsForBrand('hoya');
const state = resolveActiveHandbookNavState(nav, 1, [], {
  matrixProducts: HOYA_PRICE_MATRIX,
});
if (state.dataStatus !== 'validated' || state.anchorId !== 'p:新乐学') {
  console.error('FAIL: activeNav on pdf page 2 (0-based index 1)', state);
  process.exit(1);
}

/** 蔡司侧 `runDataIntegrityValidator` 的 `pdfPage` 为蔡司手册物理页，与豪雅页码不可混比；豪雅 UI 已用空 gaps + HOYA_PRICE_MATRIX 走插件 B。 */

console.log('OK: HOYA Matrix Protocol smoke passed.');
