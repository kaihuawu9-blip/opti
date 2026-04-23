import { readFile } from 'fs/promises';
import { join } from 'path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_PATH = join(process.cwd(), 'src', 'matrix', 'matrix-intelligence-hub.json');

/**
 * 知识提取：返回 hub 中的 validate 层（与 MatrixValidator / 云端 AI 同源）。
 * 单一事实来源：仅维护 matrix-intelligence-hub.json。
 * GET /api/matrix/rules
 */
export async function GET() {
  try {
    const raw = await readFile(HUB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      meta?: { schema_id?: string; schema_version?: string };
      validate?: unknown;
    };
    const schemaId = parsed?.meta?.schema_id ?? 'opti-matrix-intelligence-hub';
    const schemaVersion = parsed?.meta?.schema_version ?? 'unknown';

    return NextResponse.json(
      {
        source: 'matrix-intelligence-hub',
        schema_id: schemaId,
        schema_version: schemaVersion,
        validate: parsed.validate ?? null,
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
      { ok: false, error: 'MATRIX_RULES_READ_FAILED', message },
      { status: 500 },
    );
  }
}
