import { readFile } from 'fs/promises';
import { join } from 'path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_PATH = join(process.cwd(), 'src', 'matrix', 'matrix-intelligence-hub.json');

/**
 * 知识提取（百科全书）：返回视光矩阵·智能中枢 JSON（含 validate / suggest / predict 三层与几何光学公式）。
 * GET /api/matrix/context
 * 响应头 X-Matrix-Schema 便于云端 AI 做版本校验。
 */
export async function GET() {
  try {
    const raw = await readFile(HUB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { meta?: { schema_version?: string; schema_id?: string } };
    const schemaVersion = parsed?.meta?.schema_version ?? 'unknown';
    const schemaId = parsed?.meta?.schema_id ?? 'opti-matrix-intelligence-hub';

    return NextResponse.json(parsed, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'X-Matrix-Schema': `${schemaId}@${schemaVersion}`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'read failed';
    return NextResponse.json(
      { ok: false, error: 'MATRIX_CONTEXT_READ_FAILED', message },
      { status: 500 },
    );
  }
}
