import { readFile } from 'fs/promises';
import { join } from 'path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_PATH = join(process.cwd(), 'src', 'matrix', 'matrix-intelligence-hub.json');
const DICT_PATH = join(process.cwd(), 'src', 'matrix', 'dictionary.json');

/**
 * 一次拉取：hub（百科）+ rules（validate 硬逻辑）+ dictionary（术语对齐），减少云端 AI 往返。
 * GET /api/matrix/all
 */
export async function GET() {
  try {
    const [hubRaw, dictRaw] = await Promise.all([readFile(HUB_PATH, 'utf8'), readFile(DICT_PATH, 'utf8')]);
    const hub = JSON.parse(hubRaw) as { meta?: { schema_id?: string; schema_version?: string }; validate?: unknown };
    const dictionary = JSON.parse(dictRaw) as unknown;
    const schemaId = hub?.meta?.schema_id ?? 'opti-matrix-intelligence-hub';
    const schemaVersion = hub?.meta?.schema_version ?? 'unknown';

    return NextResponse.json(
      {
        source: 'matrix-all-bundle',
        schema_id: schemaId,
        schema_version: schemaVersion,
        hub,
        rules: hub.validate ?? null,
        dictionary,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          'X-Matrix-Schema': `${schemaId}@${schemaVersion}`,
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return NextResponse.json(
      { ok: false, error: 'MATRIX_ALL_READ_FAILED', message },
      { status: 500 },
    );
  }
}
