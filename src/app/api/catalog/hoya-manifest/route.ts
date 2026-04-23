import { NextResponse } from 'next/server';
import type { ZeissHandbookManifest } from '@/lib/catalog/zeissHandbookTypes';
import { getHandbookPageCount } from '@/data/zeissHandbookPageMap';
import { HOYA_HANDBOOK_PAGE_MAP } from '@/data/hoyaHandbookPageMap';

export const runtime = 'nodejs';

const EMPTY: ZeissHandbookManifest = {
  title: '豪雅价目 · 数字化手册（V1.3）',
  pageAspect: { w: 3, h: 4 },
  sections: [],
  pages: [],
};

export async function GET() {
  try {
    const n = getHandbookPageCount('hoya');
    if (n <= 0) {
      return NextResponse.json({
        ok: true,
        manifest: EMPTY,
        source: 'no-pages',
        warnings: ['豪雅手册页表未挂载'],
      });
    }
    const pages = HOYA_HANDBOOK_PAGE_MAP.map((e, i) => ({
      sectionId: 'hoya',
      title: e.title ?? `第 ${i + 1} 页`,
      imageUrl: e.imageUrl ?? null,
    }));
    return NextResponse.json({
      ok: true,
      manifest: {
        ...EMPTY,
        pages,
      },
      source: 'hoya-handbook-page-map',
      warnings: [] as string[],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return NextResponse.json(
      { ok: false, error: message, manifest: EMPTY, warnings: [] },
      { status: 500 },
    );
  }
}
