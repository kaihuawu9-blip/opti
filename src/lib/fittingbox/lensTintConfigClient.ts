import { DEFAULT_LENS_TINT_PRESETS, type LensTintPreset } from '@/lib/fittingbox/lensTintPresets';

export type LensTintClientConfig = {
  source: 'cloud' | 'builtin';
  version: string;
  updatedAt: string;
  colors: LensTintPreset[];
};

type LensTintApiResponse = {
  ok?: boolean;
  source?: 'cloud' | 'builtin';
  version?: string;
  updatedAt?: string;
  colors?: Array<
    Partial<LensTintPreset> & {
      id?: unknown;
      name?: unknown;
      hex?: unknown;
      opacity?: unknown;
      family?: unknown;
      materialSku?: unknown;
      defaultExposureLevel?: unknown;
      surchargeYuan?: unknown;
    }
  >;
};

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function normalizeHex(input: unknown): string {
  if (typeof input !== 'string') return '#808080';
  const raw = input.trim();
  const hex = raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}`;
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : '#808080';
}

function toRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);
  return [r, g, b];
}

function normalizeColors(items: LensTintApiResponse['colors']): LensTintPreset[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      if (typeof item.id !== 'string' || typeof item.name !== 'string') return null;
      const id = item.id.trim();
      const name = item.name.trim();
      if (!id || !name) return null;
      const hex = normalizeHex(item.hex);
      const opacity = clampOpacity(Number(item.opacity));
      const [r, g, b] = toRgb(hex);
      const family =
        item.family === 'solid' ||
        item.family === 'mirror' ||
        item.family === 'photochromic' ||
        item.family === 'gradient' ||
        item.family === 'polarized'
          ? item.family
          : 'solid';
      const materialSku = typeof item.materialSku === 'string' && item.materialSku.trim() ? item.materialSku.trim() : null;
      const defaultExposureLevel =
        typeof item.defaultExposureLevel === 'number' && Number.isFinite(item.defaultExposureLevel)
          ? Math.max(0, Math.min(100, Math.round(item.defaultExposureLevel)))
          : null;
      const surchargeYuan =
        typeof item.surchargeYuan === 'number' && Number.isFinite(item.surchargeYuan)
          ? Math.max(0, Number(item.surchargeYuan))
          : 0;
      return {
        id,
        name,
        hex,
        opacity,
        surchargeYuan,
        rgba: `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`,
        family,
        materialSku,
        defaultExposureLevel,
        previewSupported: Boolean(materialSku),
      } satisfies LensTintPreset;
    })
    .filter((x): x is LensTintPreset => Boolean(x));
}

export async function fetchLensTintConfigClient(): Promise<LensTintClientConfig> {
  try {
    const res = await fetch('/api/lens/tint-colors/', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = (await res.json()) as LensTintApiResponse;
    const colors = normalizeColors(json.colors);
    if (!json.ok || colors.length === 0) {
      throw new Error('invalid payload');
    }
    return {
      source: json.source === 'cloud' ? 'cloud' : 'builtin',
      version: typeof json.version === 'string' && json.version ? json.version : 'unknown',
      updatedAt: typeof json.updatedAt === 'string' && json.updatedAt ? json.updatedAt : new Date().toISOString(),
      colors,
    };
  } catch {
    return {
      source: 'builtin',
      version: 'builtin-v1',
      updatedAt: new Date().toISOString(),
      colors: DEFAULT_LENS_TINT_PRESETS,
    };
  }
}

