import { DEFAULT_LENS_TINT_PRESETS, type LensTintPreset } from '@/lib/fittingbox/lensTintPresets';

export type LensTintConfigPayload = {
  version: string;
  updatedAt: string;
  colors: LensTintPreset[];
};

export type LensTintConfigResult = {
  source: 'cloud' | 'builtin';
  payload: LensTintConfigPayload;
};

type UnsafeColor = Partial<LensTintPreset> & {
  id?: unknown;
  name?: unknown;
  hex?: unknown;
  opacity?: unknown;
};

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function normalizeHex(value: unknown): string {
  if (typeof value !== 'string') return '#808080';
  const raw = value.trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : '#808080';
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);
  return [r, g, b];
}

function toRgba(hex: string, opacity: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
}

function normalizeColor(item: UnsafeColor): LensTintPreset | null {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null;
  const id = item.id.trim();
  const name = item.name.trim();
  if (!id || !name) return null;

  const hex = normalizeHex(item.hex);
  const opacity = clampOpacity(typeof item.opacity === 'number' ? item.opacity : Number(item.opacity));
  const family =
    item.family === 'solid' ||
    item.family === 'mirror' ||
    item.family === 'photochromic' ||
    item.family === 'gradient' ||
    item.family === 'polarized'
      ? item.family
      : 'solid';
  const materialSku = typeof item.materialSku === 'string' && item.materialSku.trim() ? item.materialSku.trim() : null;
  const exposure =
    typeof item.defaultExposureLevel === 'number' && Number.isFinite(item.defaultExposureLevel)
      ? Math.max(0, Math.min(100, Math.round(item.defaultExposureLevel)))
      : null;

  return {
    id,
    name,
    hex,
    opacity,
    rgba: toRgba(hex, opacity),
    family,
    materialSku,
    defaultExposureLevel: exposure,
    previewSupported: Boolean(materialSku),
  };
}

function normalizePayload(raw: unknown): LensTintConfigPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { version?: unknown; updatedAt?: unknown; colors?: unknown };
  if (!Array.isArray(data.colors) || data.colors.length === 0) return null;
  const colors = data.colors.map((x) => normalizeColor(x as UnsafeColor)).filter((x): x is LensTintPreset => Boolean(x));
  if (colors.length === 0) return null;
  return {
    version: typeof data.version === 'string' && data.version.trim() ? data.version.trim() : 'cloud',
    updatedAt: typeof data.updatedAt === 'string' && data.updatedAt.trim() ? data.updatedAt.trim() : new Date().toISOString(),
    colors,
  };
}

export async function fetchLensTintConfigFromCloud(timeoutMs = 5000): Promise<LensTintConfigResult> {
  const configUrl = (process.env.LENS_TINT_CONFIG_URL || '').trim();
  if (!configUrl) {
    return {
      source: 'builtin',
      payload: {
        version: 'builtin-v1',
        updatedAt: new Date().toISOString(),
        colors: DEFAULT_LENS_TINT_PRESETS,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(configUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`cloud config http ${res.status}`);
    const json = (await res.json()) as unknown;
    const normalized = normalizePayload(json);
    if (!normalized) throw new Error('cloud config invalid payload');
    return {
      source: 'cloud',
      payload: normalized,
    };
  } catch {
    return {
      source: 'builtin',
      payload: {
        version: 'builtin-v1',
        updatedAt: new Date().toISOString(),
        colors: DEFAULT_LENS_TINT_PRESETS,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

