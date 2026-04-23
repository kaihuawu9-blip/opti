import { NextResponse } from 'next/server';
import type { ZeissHandbookManifest } from '@/lib/catalog/zeissHandbookTypes';
import { getHandbookPageCount } from '@/data/zeissHandbookPageMap';

export const runtime = 'nodejs';

const EMPTY: ZeissHandbookManifest = {
  title: '依视路钻晶 · 数字化价目（V1.3）',
  pageAspect: { w: 3, h: 4 },
  sections: [],
  pages: [],
};

export async function GET() {
  try {
    const n = getHandbookPageCount('essilor');
    if (n <= 0) {
      return NextResponse.json({
        ok: true,
        manifest: EMPTY,
        source: 'no-pages',
        warnings: ['依视路手册页表未挂载'],
      });
    }
    const pages = Array.from({ length: n }, (_, i) => ({
      sectionId: 'essilor',
      title: `第 ${i + 1} 页`,
      imageUrl: null as string | null,
    }));
    return NextResponse.json({
      ok: true,
      manifest: {
        ...EMPTY,
        pages,
      },
      source: 'essilor-handbook-page-count',
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
