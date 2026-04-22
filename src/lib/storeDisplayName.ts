import { DEFAULT_STORE_DISPLAY_FALLBACK } from '@/lib/constants';
import {
  STORE_CONFIG_PUBLIC_FALLBACK,
  type StoreConfigPublicPayload,
} from '@/lib/storeConfigPublic';

/** 自服务端配置同步前，或拉取失败时的兜底 */
let cachedDefaultStoreDisplayName: string = DEFAULT_STORE_DISPLAY_FALLBACK;
let cachedSupportHost = STORE_CONFIG_PUBLIC_FALLBACK.supportHost;

/** 与 /api/config/store 对齐的公开配置快照；不依赖云端 REST 直连 */
let cachedPublicConfig: StoreConfigPublicPayload = STORE_CONFIG_PUBLIC_FALLBACK;

const storePublicConfigListeners = new Set<() => void>();

/** 门店公开配置更新后触发（如 Opti-Bot 读取 agentCustomName） */
export function subscribeStorePublicConfig(listener: () => void): () => void {
  storePublicConfigListeners.add(listener);
  return () => storePublicConfigListeners.delete(listener);
}

function emitStorePublicConfig(): void {
  storePublicConfigListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // 绝不抛
    }
  });
}

export function setDefaultStoreDisplayNameFromConfig(name: string | null | undefined): void {
  const t = String(name ?? '').trim();
  if (t) cachedDefaultStoreDisplayName = t;
}

export function getDefaultStoreDisplayNameSync(): string {
  return cachedDefaultStoreDisplayName;
}

function normalizeSupportHost(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const noProtocol = s.replace(/^https?:\/\//iu, '').replace(/^\/\//u, '');
  const host = noProtocol.split('/')[0]?.trim();
  return host || '';
}

export function getPrintTechSupportLineSync(): string {
  return `技术支持: ${cachedSupportHost}`;
}

/** 优先具体门店 stores.name；空则使用 store_config.default_store_display_name */
export function resolveStoreDisplayName(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return s || cachedDefaultStoreDisplayName;
}

/** 应用 GET /api/config/store 返回体（或与之同构的对象） */
export function applyStorePublicConfig(cfg: StoreConfigPublicPayload): void {
  try {
    const merged: StoreConfigPublicPayload = {
      ...STORE_CONFIG_PUBLIC_FALLBACK,
      ...cfg,
      ok: true,
      ui: { ...STORE_CONFIG_PUBLIC_FALLBACK.ui, ...cfg.ui },
      calibration: { ...STORE_CONFIG_PUBLIC_FALLBACK.calibration, ...cfg.calibration },
    };

    setDefaultStoreDisplayNameFromConfig(merged.defaultStoreDisplayName);
    const host = normalizeSupportHost(merged.supportHost);
    if (host) cachedSupportHost = host;

    const { defaultPxPerMm, minPxPerMm, maxPxPerMm } = merged.calibration;
    merged.calibration = {
      defaultPxPerMm: Number.isFinite(defaultPxPerMm) ? defaultPxPerMm : STORE_CONFIG_PUBLIC_FALLBACK.calibration.defaultPxPerMm,
      minPxPerMm: Number.isFinite(minPxPerMm) ? minPxPerMm : STORE_CONFIG_PUBLIC_FALLBACK.calibration.minPxPerMm,
      maxPxPerMm: Number.isFinite(maxPxPerMm) ? maxPxPerMm : STORE_CONFIG_PUBLIC_FALLBACK.calibration.maxPxPerMm,
    };

    cachedPublicConfig = merged;
    emitStorePublicConfig();
  } catch {
    // 绝不抛：保持模块内已有兜底
  }
}

/** 当前内存中的门店公开配置（含 UI 路径与标定默认）；未拉取成功前为 STORE_CONFIG_PUBLIC_FALLBACK */
export function getStorePublicConfigSync(): StoreConfigPublicPayload {
  return cachedPublicConfig;
}

export function getStoreUiPathsSync(): StoreConfigPublicPayload['ui'] {
  return cachedPublicConfig.ui;
}

export function getStoreCalibrationDefaultsSync(): StoreConfigPublicPayload['calibration'] {
  return cachedPublicConfig.calibration;
}

/**
 * 通过内部 API 拉取 store_config（Prisma），不依赖云端 REST 连接。
 * 失败时静默保留 STORE_CONFIG_PUBLIC_FALLBACK。
 */
export async function hydrateStoreConfigFromApi(): Promise<void> {
  try {
    const res = await fetch('/api/config/store', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object') return;
    const rec = body as Record<string, unknown>;
    if (rec.ok !== true) return;
    applyStorePublicConfig(body as StoreConfigPublicPayload);
  } catch {
    // 网络/解析失败：使用已初始化的 FALLBACK
  }
}
