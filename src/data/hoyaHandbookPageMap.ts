/**
 * 豪雅数字化手册 · 物理页映射（Matrix V1.3 · 真机锚点）
 *
 * **页数**：`hoyaHandbookPageCount.json` 的 `total` / `pages`（静态图在 `public/catalog/hoya/pages/p*.jpg`，URL `/catalog/hoya/pages/…`）。
 *
 * **硬编码锚点（2025 册观察校准）**
 * - p1–p6：品牌与产品简介（无矩阵 `productName`，避免与价目脱节）
 * - p7：目录 / 过渡
 * - **p8**：新乐学 MiyoSmart 价目主表（与矩阵 `catalog_page_reference` 对齐；册内常见含 3980 等价位）
 * - **p12 / p16 / p20**：Eyvia 1.74、Eynoa 1.67、Eyas 2.0 单光价目起始
 * - **p27**：豪雅智御 · 中近
 * - **p34**：膜层与技术说明起页
 * - **p42**：生活场景 / 功能性镜片导读
 * - 其余：无产品锚的内页（附录向），便于 OCR 后再精调区间
 *
 * **黄金索引**：`HANDBOOK_BRAND_REGISTRY.hoya`（`zeissHandbookPageMap.ts`）。
 */

import hoyaHandbookMeta from './hoyaHandbookPageCount.json';

type HoyaPageCountMeta = {
  pages?: number;
  total?: number;
  dir?: string;
  pdf?: string;
  generatedAt?: string;
};

const meta = hoyaHandbookMeta as HoyaPageCountMeta;

/** 与 `hoyaHandbookPageCount.json` 对齐的物理总页数（供外部自检） */
export const HOYA_HANDBOOK_PHYSICAL_TOTAL: number = Math.max(
  1,
  Math.floor(Number(meta.total ?? meta.pages ?? 1)),
);

export type HoyaHandbookPageEntry = {
  pdfPage: number;
  printedPage: number | null;
  section: string;
  productName?: string;
  title?: string;
  fingerprint?: readonly string[];
  imageUrl?: string;
};

/** 物理页 → 行数据（无 imageUrl，循环中拼接） */
type HoyaPageRow = Omit<HoyaHandbookPageEntry, 'imageUrl'>;

function row(
  pdfPage: number,
  section: string,
  title: string,
  opts?: { printedPage?: number | null; productName?: string; fingerprint?: readonly string[] },
): HoyaPageRow {
  return {
    pdfPage,
    printedPage: opts?.printedPage ?? null,
    section,
    title,
    productName: opts?.productName,
    fingerprint: opts?.fingerprint,
  };
}

/**
 * 真机锚点：按页生成；未列出的页在下方默认分支填充。
 * 若实册与下列页码不符，仅改本表 `pdfPage` 与 `ai-data/hoya_handbook/price_matrix.json` 的 `catalog_page_reference`。
 */
function hardcodedRowForPdf(pdfPage: number): HoyaPageRow | null {
  if (pdfPage >= 1 && pdfPage <= 6) {
    return row(pdfPage, 'myopia-control-intro', `品牌与产品简介 · 第 ${pdfPage} 页`, {
      fingerprint: ['HOYA', '豪雅', '简介', '2025'],
    });
  }
  if (pdfPage === 7) {
    return row(7, 'myopia-control-intro', '目录与过渡', {
      fingerprint: ['目录', '豪雅'],
    });
  }
  if (pdfPage === 8) {
    return row(8, 'price', '新乐学 MiyoSmart · 价目主表', {
      productName: '新乐学',
      fingerprint: ['新乐学', 'MiyoSmart', '3980', '3680', '3280', '青少年近视管理'],
    });
  }
  if (pdfPage >= 9 && pdfPage <= 11) {
    return row(pdfPage, 'price', `新乐学 · 相关内页（第 ${pdfPage} 页）`, {
      fingerprint: ['新乐学', '续页'],
    });
  }
  if (pdfPage === 12) {
    return row(12, 'price', 'Eyvia 单光 1.74 · 价目主表', {
      productName: 'Eyvia单光',
      fingerprint: ['Eyvia', '1.74', '单焦点'],
    });
  }
  if (pdfPage >= 13 && pdfPage <= 15) {
    return row(pdfPage, 'price', `Eyvia · 内页（第 ${pdfPage} 页）`, {
      fingerprint: ['Eyvia', '续页'],
    });
  }
  if (pdfPage === 16) {
    return row(16, 'price', 'Eynoa 单光 1.67 · 价目主表', {
      productName: 'Eynoa单光',
      fingerprint: ['Eynoa', '1.67', '单焦点'],
    });
  }
  if (pdfPage >= 17 && pdfPage <= 19) {
    return row(pdfPage, 'price', `Eynoa · 内页（第 ${pdfPage} 页）`, {
      fingerprint: ['Eynoa', '续页'],
    });
  }
  if (pdfPage === 20) {
    return row(20, 'price', 'Eyas 2.0 单光 1.60 · 价目主表', {
      productName: 'Eyas2单光',
      fingerprint: ['Eyas', 'Eyas2', '1.60', '单焦点'],
    });
  }
  if (pdfPage >= 21 && pdfPage <= 26) {
    return row(pdfPage, 'price', `单焦点 · 内页（第 ${pdfPage} 页）`, {
      fingerprint: ['单光', 'Eyas', 'Eyvia', 'Eynoa'],
    });
  }
  if (pdfPage === 27) {
    return row(27, 'price', '豪雅智御 · 中近渐进 · 价目主表', {
      productName: '豪雅智御中近',
      fingerprint: ['智御', '中近', '渐进', '豪雅'],
    });
  }
  if (pdfPage >= 28 && pdfPage <= 33) {
    return row(pdfPage, 'price', `功能性镜片 · 内页（第 ${pdfPage} 页）`, {
      fingerprint: ['智御', '功能性'],
    });
  }
  if (pdfPage === 34) {
    return row(34, 'coating', '膜层与技术说明 · 导读', {
      fingerprint: ['唯洁', '兰御', '膜层', 'Hi-Vision'],
    });
  }
  if (pdfPage >= 35 && pdfPage <= 41) {
    return row(pdfPage, 'coating', `膜层与技术 · 内页（第 ${pdfPage} 页）`, {
      fingerprint: ['膜层', '技术'],
    });
  }
  if (pdfPage === 42) {
    return row(42, 'driving-intro', '生活场景与功能性镜片 · 导读', {
      fingerprint: ['生活场景', '驾驶', '数码', '豪雅'],
    });
  }
  if (pdfPage >= 70) {
    return row(pdfPage, 'appendix', `附录与政策 · 第 ${pdfPage} 页`, {
      fingerprint: ['附录', '质保'],
    });
  }
  if (pdfPage >= 43) {
    return row(pdfPage, 'appendix', `豪雅价目册 · 第 ${pdfPage} 页`, {
      fingerprint: ['豪雅', '内页'],
    });
  }
  return null;
}

function buildHoyaHandbookPageMap(): readonly HoyaHandbookPageEntry[] {
  const total = HOYA_HANDBOOK_PHYSICAL_TOTAL;
  const out: HoyaHandbookPageEntry[] = [];
  for (let pdfPage = 1; pdfPage <= total; pdfPage++) {
    const imageUrl = `/catalog/hoya/pages/p${pdfPage}.jpg`;
    const fixed = hardcodedRowForPdf(pdfPage);
    if (fixed) {
      out.push({ ...fixed, imageUrl });
      continue;
    }
    out.push({
      pdfPage,
      printedPage: null,
      section: 'appendix',
      title: `豪雅价目册 · 第 ${pdfPage} 页`,
      imageUrl,
      fingerprint: ['豪雅'],
    });
  }
  return Object.freeze(out);
}

/** Markdown 对照表（与 `price_matrix.json` 的 `pdfIndex` 同步维护） */
export const HOYA_DIRECTORY_DRAFT_TEXT = [
  '| 物理页 | 矩阵锚点 / 说明 |',
  '| --- | --- |',
  '| p1–p6 | 品牌与产品简介（无 productName） |',
  '| p7 | 目录与过渡 |',
  '| **p8** | **新乐学**（价目主表，含 3980 等矩阵行） |',
  '| p9–p11 | 新乐学相关内页 |',
  '| **p12** | **Eyvia 单光 1.74** |',
  '| **p16** | **Eynoa 单光 1.67** |',
  '| **p20** | **Eyas2 单光 1.60** |',
  '| **p27** | **豪雅智御中近** |',
  '| **p34** | 膜层与技术说明（起） |',
  '| **p42** | 生活场景与功能性镜片（导读） |',
  '| p43–p74 | 附录 / 其它内页 |',
  '',
  `total = ${HOYA_HANDBOOK_PHYSICAL_TOTAL}`,
].join('\n');

export const HOYA_HANDBOOK_PAGE_MAP: readonly HoyaHandbookPageEntry[] = buildHoyaHandbookPageMap();
