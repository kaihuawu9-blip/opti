import type { LensTintPreset } from '@/lib/fittingbox/lensTintPresets';

type FittingboxLensSimulator = {
  setLensMaterial?: (materialSku: string) => void;
  restoreLensDefaultMaterial?: () => void;
  setExposureLevel?: (level: number) => void;
};

function normalizeExposure(level: number | null | undefined): number {
  if (!Number.isFinite(level)) return 50;
  return Math.max(0, Math.min(100, Math.round(level as number)));
}

/**
 * Electron (Web) 与 H5 页面共用：
 * 按 tint 配置驱动 Fittingbox Lens Simulator 实例。
 */
export function applyTintToLensSimulator(simulator: FittingboxLensSimulator, tint: LensTintPreset): {
  ok: boolean;
  reason?: string;
} {
  if (!simulator || typeof simulator !== 'object') return { ok: false, reason: 'simulator-missing' };
  if (!tint.materialSku) return { ok: false, reason: 'material-sku-missing' };
  if (typeof simulator.setLensMaterial !== 'function') return { ok: false, reason: 'setLensMaterial-unavailable' };

  simulator.setLensMaterial(tint.materialSku);
  if (tint.family === 'photochromic' && typeof simulator.setExposureLevel === 'function') {
    simulator.setExposureLevel(normalizeExposure(tint.defaultExposureLevel));
  }
  return { ok: true };
}

export function clearTintFromLensSimulator(simulator: FittingboxLensSimulator): void {
  if (simulator && typeof simulator.restoreLensDefaultMaterial === 'function') {
    simulator.restoreLensDefaultMaterial();
  }
}

