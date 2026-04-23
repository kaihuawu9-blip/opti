/**
 * 豪雅数字化手册 · 物理页映射（Matrix V1.3 · 资源自愈）
 *
 * **页数**：与 `public/catalog/hoya/p*.jpg` 一致，由 `npm run catalog:pdf-to-jpg-pages` 写入
 * `hoyaHandbookPageCount.json` 后自动驱动尾部「附录」占位行。
 *
 * **黄金索引**：`HANDBOOK_BRAND_REGISTRY.hoya`（`zeissHandbookPageMap.ts`）。
 */

import hoyaHandbookMeta from './hoyaHandbookPageCount.json';

/** 与 Essilor 侧一致的最小页行；`imageUrl` 供 3D 贴图（`/catalog/hoya/p{n}.jpg`） */
export type HoyaHandbookPageEntry = {
  pdfPage: number;
  printedPage: number | null;
  section: string;
  productName?: string;
  title?: string;
  fingerprint?: readonly string[];
  imageUrl?: string;
};

/** 价目矩阵已绑定的前 5 物理页（与 `price_matrix.json` 中 `catalog_page_reference` 一致） */
const HOYA_CORE_PAGES: readonly Omit<HoyaHandbookPageEntry, 'imageUrl'>[] = Object.freeze([
  {
    pdfPage: 1,
    printedPage: null,
    section: 'myopia-control-intro',
    title: '豪雅 · 新乐学与单光系列',
    fingerprint: ['HOYA', '豪雅', '价目册', 'Hoya'],
  },
  {
    pdfPage: 2,
    printedPage: 1,
    section: 'price',
    productName: '新乐学',
    title: '新乐学 MiyoSmart',
    fingerprint: ['新乐学', 'MiyoSmart', 'MiYOSMART', '青少年近视防控', '近视管理'],
  },
  {
    pdfPage: 3,
    printedPage: 2,
    section: 'price',
    productName: 'Eyvia单光',
    title: 'Eyvia 单光 1.74',
    fingerprint: ['Eyvia', 'EYVIA', '1.74', '单焦点', '单光'],
  },
  {
    pdfPage: 4,
    printedPage: 3,
    section: 'price',
    productName: 'Eynoa单光',
    title: 'Eynoa 单光 1.67',
    fingerprint: ['Eynoa', 'EYNOA', '1.67', '单焦点'],
  },
  {
    pdfPage: 5,
    printedPage: 4,
    section: 'price',
    productName: 'Eyas2单光',
    title: 'Eyas 2.0 单光 1.60',
    fingerprint: ['Eyas', 'EYAS', 'Eyas2', '1.60', '单焦点'],
  },
]);

function buildHoyaHandbookPageMap(): readonly HoyaHandbookPageEntry[] {
  const total = Math.max(
    1,
    Number.isFinite(Number(hoyaHandbookMeta.pages)) ? Math.floor(Number(hoyaHandbookMeta.pages)) : 1,
  );
  const out: HoyaHandbookPageEntry[] = [];
  for (let pdfPage = 1; pdfPage <= total; pdfPage++) {
    const imageUrl = `/catalog/hoya/p${pdfPage}.jpg`;
    const core = HOYA_CORE_PAGES.find((c) => c.pdfPage === pdfPage);
    if (core) {
      out.push({ ...core, imageUrl });
    } else {
      out.push({
        pdfPage,
        printedPage: null,
        section: 'appendix',
        title: `豪雅价目册 · 第 ${pdfPage} 页`,
        imageUrl,
      });
    }
  }
  return Object.freeze(out);
}

export const HOYA_HANDBOOK_PAGE_MAP: readonly HoyaHandbookPageEntry[] = buildHoyaHandbookPageMap();
