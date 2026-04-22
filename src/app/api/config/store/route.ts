import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { STORE_CONFIG_PUBLIC_FALLBACK, type StoreConfigPublicPayload } from '@/lib/storeConfigPublic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeSupportHost(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const noProtocol = s.replace(/^https?:\/\//iu, '').replace(/^\/\//u, '');
  const host = noProtocol.split('/')[0]?.trim();
  return host || '';
}

function agentNameFromEnv(): string | null {
  const t = String(process.env.AGENT_CUSTOM_NAME ?? process.env.NEXT_PUBLIC_AGENT_CUSTOM_NAME ?? '').trim();
  return t || null;
}

export async function GET() {
  try {
    if (!process.env.DATABASE_URL?.trim()) {
      return NextResponse.json({ ...STORE_CONFIG_PUBLIC_FALLBACK, agentCustomName: agentNameFromEnv() });
    }

    let row: {
      app_name: string | null;
      default_store_display_name: string | null;
      agent_custom_name: string | null;
      support_url: string | null;
      domain: string | null;
    } | null = null;

    try {
      row = await prisma.store_config.findUnique({
        where: { id: 1 },
        select: {
          app_name: true,
          default_store_display_name: true,
          agent_custom_name: true,
          support_url: true,
          domain: true,
        },
      });
    } catch {
      row = null;
    }

    if (!row) {
      return NextResponse.json({ ...STORE_CONFIG_PUBLIC_FALLBACK, agentCustomName: agentNameFromEnv() });
    }

    const supportHost =
      normalizeSupportHost(row.support_url) ||
      normalizeSupportHost(row.domain) ||
      STORE_CONFIG_PUBLIC_FALLBACK.supportHost;

    const agentCustomNameRaw = String(row.agent_custom_name ?? '').trim();
    const agentCustomName =
      agentCustomNameRaw ||
      String(process.env.AGENT_CUSTOM_NAME ?? process.env.NEXT_PUBLIC_AGENT_CUSTOM_NAME ?? '').trim() ||
      null;

    const payload: StoreConfigPublicPayload = {
      ok: true,
      source: 'database',
      appName: String(row.app_name ?? '').trim() || STORE_CONFIG_PUBLIC_FALLBACK.appName,
      defaultStoreDisplayName:
        String(row.default_store_display_name ?? '').trim() ||
        STORE_CONFIG_PUBLIC_FALLBACK.defaultStoreDisplayName,
      agentCustomName,
      supportUrl: String(row.support_url ?? '').trim() || `https://${supportHost}`,
      domain: String(row.domain ?? '').trim() || supportHost,
      supportHost,
      ui: { ...STORE_CONFIG_PUBLIC_FALLBACK.ui },
      calibration: { ...STORE_CONFIG_PUBLIC_FALLBACK.calibration },
    };

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(STORE_CONFIG_PUBLIC_FALLBACK);
  }
}
