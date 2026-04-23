import { readFile } from 'fs/promises';
import { join } from 'path';

import { NextRequest, NextResponse } from 'next/server';

import { buildCashierRefractiveIndexHintsFromHub } from '@/matrix/suggest-runtime';
import type { MatrixIntelligenceHubFile } from '@/matrix/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_PATH = join(process.cwd(), 'src', 'matrix', 'matrix-intelligence-hub.json');

/**
 * 销售环节：收银台/云端根据录入球柱返回 suggest 层折射率话术（读磁盘 hub，与 /api/matrix/context 同步）。
 * POST /api/matrix/suggest-hints
 * body: { od_ds, od_dc, os_ds, os_dc }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const od_ds = String(body.od_ds ?? '');
    const od_dc = String(body.od_dc ?? '');
    const os_ds = String(body.os_ds ?? '');
    const os_dc = String(body.os_dc ?? '');

    const raw = await readFile(HUB_PATH, 'utf8');
    const hub = JSON.parse(raw) as MatrixIntelligenceHubFile;
    const schemaId = hub?.meta?.schema_id ?? 'opti-matrix-intelligence-hub';
    const schemaVersion = hub?.meta?.schema_version ?? 'unknown';

    const out = buildCashierRefractiveIndexHintsFromHub(hub, { od_ds, od_dc, os_ds, os_dc });

    return NextResponse.json(
      {
        ok: true,
        se_abs: out.se_abs,
        recommend_index: out.recommend_index,
        hints: out.hints,
      },
      {
        status: 200,
        headers: { 'X-Matrix-Schema': `${schemaId}@${schemaVersion}` },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, error: 'MATRIX_SUGGEST_HINTS_FAILED', message }, { status: 500 });
  }
}
