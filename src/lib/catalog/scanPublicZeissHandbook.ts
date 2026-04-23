import fs from 'node:fs';
import path from 'node:path';
import type { ZeissHandbookManifest, ZeissHandbookPage, ZeissHandbookSection } from '@/lib/catalog/zeissHandbookTypes';

/** 采集高清图：支持 JPG/JPEG/PNG/WEBP/AVIF（大小写不敏感） */
const HANDBOOK_IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i;

const PUBLIC_HANDROOT = path.join(process.cwd(), 'public', 'catalog', 'zeiss-handbook');

/** 单页视觉比例：宽:高 = 3:4（成长乐等竖版页） */
export const HANDBOOK_PAGE_ASPECT = { w: 3, h: 4 } as const;

const SECTION_META: Record<string, { labelZh: string; labelEn: string }> = {
  growthjoy: { labelZh: '成长乐', labelEn: '' },
  smartlife: { labelZh: '智锐', labelEn: 'SmartLife' },
  drivesafe: { labelZh: '驾驶型', labelEn: 'DriveSafe' },
  bosharp: { labelZh: '博锐/单光', labelEn: '' },
  office: { labelZh: '办公/功能', labelEn: '' },
  pricing: { labelZh: '价格总表', labelEn: '' },
  misc: { labelZh: '未分类', labelEn: '' },
};

export function classifyHandbookSeriesToken(raw: string): keyof typeof SECTION_META {
  const t = raw.toLowerCase();
  if (t.includes('成长乐') || t.includes('growthjoy') || t.includes('myovision') || t.includes('myokine')) {
    return 'growthjoy';
  }
  if (t.includes('smart') || t.includes('智锐') || t.includes('smartlife')) return 'smartlife';
  if (t.includes('drive') || t.includes('驾驶') || t.includes('drivesafe')) return 'drivesafe';
  if (t.includes('bosharp') || t.includes('博锐') || t.includes('单光')) return 'bosharp';
  if (t.includes('office') || t.includes('办公') || t.includes('数码')) return 'office';
  if (t.includes('pric') || t.includes('总表') || t.includes('价格')) return 'pricing';
  return 'misc';
}

function sectionIdForRelPath(rel: string): keyof typeof SECTION_META {
  const norm = rel.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts.length > 1) {
    const folder = classifyHandbookSeriesToken(parts[0]!);
    if (folder !== 'misc') return folder;
  }
  return classifyHandbookSeriesToken(path.basename(norm));
}

function humanTitle(rel: string): string {
  const base = path.basename(rel, path.extname(rel));
  return base.replace(/[_-]+/g, ' ').trim() || base;
}

function walkHandbookDir(absDir: string, relBase = ''): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, ent.name);
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push(...walkHandbookDir(abs, rel));
      continue;
    }
    if (!HANDBOOK_IMAGE_EXT.test(ent.name)) continue;
    out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}

const PAGE_STEM_RE = /^page_(\d+)/i;

/** 与 `zeissHandbookPageMap` 中物理页行数一致（缺图时 API 会打 warning） */
export const EXPECTED_ZEISS_HANDBOOK_IMAGE_COUNT = 82;

/**
 * 根目录 `1.jpg`…`N.jpg`（或 .jpeg/.png… 嗅探）与 PDF 物理页 1:1；仅当 1..EXPECTED 全存在时才启用，避免与零散单张混淆。
 * imageUrl 形如 `/catalog/zeiss-handbook/21.jpg`（以磁盘实际后缀为准）。
 */
function findRootHandbookFileForPage(n: number): string | null {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.avif']) {
    const rel = `${n}${ext}`;
    const abs = path.join(PUBLIC_HANDROOT, rel);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return rel.replace(/\\/g, '/');
    } catch {
      /* ignore */
    }
  }
  return null;
}

function collectFromRootStrictOneToN(): string[] | null {
  if (!fs.existsSync(PUBLIC_HANDROOT)) return null;
  if (!findRootHandbookFileForPage(1)) return null;
  const out: string[] = [];
  for (let n = 1; n <= EXPECTED_ZEISS_HANDBOOK_IMAGE_COUNT; n++) {
    const f = findRootHandbookFileForPage(n);
    if (!f) return null;
    out.push(f);
  }
  return out;
}

/**
 * 优先使用 `zeiss-handbook/pages/page_###.*`：与 PDF 物理页 1…N 强一致，避免与根目录杂图混排、locale 排序歧义。
 */
function collectFromPagesSubfolderNumeric(): string[] | null {
  const pagesDir = path.join(PUBLIC_HANDROOT, 'pages');
  if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) return null;
  const scored: { n: number; rel: string }[] = [];
  for (const ent of fs.readdirSync(pagesDir, { withFileTypes: true })) {
    if (!ent.isFile() || !HANDBOOK_IMAGE_EXT.test(ent.name)) continue;
    const m = PAGE_STEM_RE.exec(ent.name);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < 1) continue;
    scored.push({ n, rel: `pages/${ent.name}`.replace(/\\/g, '/') });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.n - b.n);
  return scored.map((s) => s.rel);
}

/** 递归收集 public/catalog/zeiss-handbook 下高清图资产 */
export function collectPublicHandbookRelPaths(): string[] {
  if (!fs.existsSync(PUBLIC_HANDROOT)) return [];
  const fromRoot = collectFromRootStrictOneToN();
  if (fromRoot) return fromRoot;
  const fromPages = collectFromPagesSubfolderNumeric();
  if (fromPages) return fromPages;
  const out = walkHandbookDir(PUBLIC_HANDROOT);
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }));
}

/** 由 public 扫描结果生成 manifest：每页 imageUrl 与磁盘文件 1:1 */
export function manifestFromPublicFiles(): {
  manifest: ZeissHandbookManifest | null;
  warnings: string[];
} {
  const rels = collectPublicHandbookRelPaths();
  const warnings: string[] = [];
  if (rels.length === 0) {
    return { manifest: null, warnings };
  }

  if (rels.length !== EXPECTED_ZEISS_HANDBOOK_IMAGE_COUNT) {
    warnings.push(
      `手册图共 ${rels.length} 张，预期 ${EXPECTED_ZEISS_HANDBOOK_IMAGE_COUNT} 张（与 2026 价目册 PDF 物理页一致）。请检查 public/catalog/zeiss-handbook/pages/ 下是否缺页或导出脚本是否只跑了一部分。`,
    );
  }

  const pages: ZeissHandbookPage[] = rels.map((rel) => {
    const sid = sectionIdForRelPath(rel);
    return {
      sectionId: sid,
      title: humanTitle(rel),
      imageUrl: `/catalog/zeiss-handbook/${rel}`,
    };
  });

  const sectionOrder: (keyof typeof SECTION_META)[] = [
    'growthjoy',
    'smartlife',
    'drivesafe',
    'bosharp',
    'office',
    'pricing',
    'misc',
  ];
  const sections: ZeissHandbookSection[] = [];
  for (const sid of sectionOrder) {
    const firstIdx = pages.findIndex((p) => p.sectionId === sid);
    if (firstIdx < 0) continue;
    const meta = SECTION_META[sid] ?? SECTION_META.misc;
    sections.push({
      id: sid,
      labelZh: meta.labelZh,
      labelEn: meta.labelEn,
      startPage: firstIdx,
    });
  }

  const unknown = pages.filter((p) => p.sectionId === 'misc').length;
  if (unknown > 0) {
    warnings.push(
      `有 ${unknown} 页未能从文件名/文件夹识别系列，已归入「未分类」；请在文件名或父文件夹中加入「成长乐」、smartlife、drivesafe 等关键词。`,
    );
  }

  const usedIds = new Set(pages.map((p) => p.sectionId));
  const sectionsFiltered = sections.filter((s) => usedIds.has(s.id));

  return {
    manifest: {
      title: '蔡司数字化价格手册',
      pageAspect: { w: HANDBOOK_PAGE_ASPECT.w, h: HANDBOOK_PAGE_ASPECT.h },
      sections: sectionsFiltered,
      pages,
    },
    warnings,
  };
}
