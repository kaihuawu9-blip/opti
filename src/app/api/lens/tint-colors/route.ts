import { NextResponse } from 'next/server';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';

type LensTintItem = {
  id: string;
  name: string;
  hex: string;
  opacity: number;
  surchargeYuan?: number;
  family?: string;
  materialSku?: string | null;
  defaultExposureLevel?: number | null;
};

type LensTintJson = {
  version?: string;
  updatedAt?: string;
  colors?: LensTintItem[];
};

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'src', 'data', 'lens-tints.json');
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as LensTintJson;
    const colors = Array.isArray(parsed.colors) ? parsed.colors : [];

    return NextResponse.json(
      {
        ok: true,
        version: parsed.version || 'v1',
        updatedAt: parsed.updatedAt || '',
        count: colors.length,
        colors,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取镜片颜色配置失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

