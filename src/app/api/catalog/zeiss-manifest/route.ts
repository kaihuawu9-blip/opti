import { NextResponse } from 'next/server';
import type { ZeissHandbookManifest } from '@/lib/catalog/zeissHandbookTypes';
import { manifestFromPublicFiles } from '@/lib/catalog/scanPublicZeissHandbook';

export const runtime = 'nodejs';

/** 无 public 资产且无 manifest 时的空壳（不再注入文字占位页） */
const EMPTY_FALLBACK: ZeissHandbookManifest = {
  title: '蔡司数字化价格手册',
  pageAspect: { w: 3, h: 4 },
  sections: [],
  pages: [],
};

export async function GET() {
  const warnings: string[] = [];
  try {
    const pub = manifestFromPublicFiles();
    warnings.push(...pub.warnings);

    if (pub.manifest && pub.manifest.pages.length > 0) {
      return NextResponse.json({
        ok: true,
        manifest: pub.manifest,
        source: 'public-scan',
        warnings,
      });
    }

    return NextResponse.json({
      ok: true,
      manifest: EMPTY_FALLBACK,
      source: 'empty',
      warnings: [
        '未找到 public/catalog/zeiss-handbook 内高清图资产（jpg/jpeg/png/webp/avif）。请将手册原图放入该目录后刷新。',
      ],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return NextResponse.json(
      { ok: false, error: message, manifest: EMPTY_FALLBACK, warnings },
      { status: 500 },
    );
  }
}
