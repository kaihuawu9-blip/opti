export type LensTintPreset = {
  id: string;
  name: string;
  hex: string;
  opacity: number;
  surchargeYuan: number;
  rgba: string;
  family: 'solid' | 'mirror' | 'photochromic' | 'gradient' | 'polarized';
  materialSku: string | null;
  defaultExposureLevel: number | null;
  previewSupported: boolean;
};

type RawTintPreset = Omit<LensTintPreset, 'rgba' | 'previewSupported'> & {
  surchargeYuan?: number;
};

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return [128, 128, 128];
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return [128, 128, 128];
  return [r, g, b];
}

function toPreset(raw: RawTintPreset): LensTintPreset {
  const opacity = clampOpacity(raw.opacity);
  const [r, g, b] = hexToRgb(raw.hex);
  return {
    ...raw,
    opacity,
    surchargeYuan:
      typeof raw.surchargeYuan === 'number' && Number.isFinite(raw.surchargeYuan)
        ? Math.max(0, raw.surchargeYuan)
        : 0,
    rgba: `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`,
    previewSupported: Boolean(raw.materialSku),
  };
}

const RAW_TINT_PRESETS: RawTintPreset[] = [
  { id: 'clear', name: '无色透明', family: 'solid', hex: '#F3F8FF', opacity: 0.04, materialSku: 'Sample_Clear', defaultExposureLevel: null },
  { id: 'smoke-gray', name: '烟灰', family: 'solid', hex: '#7A8088', opacity: 0.35, materialSku: 'Sample_Grey', defaultExposureLevel: null },
  { id: 'graphite-gray', name: '石墨灰', family: 'solid', hex: '#545A63', opacity: 0.42, materialSku: null, defaultExposureLevel: null },
  { id: 'charcoal-gray', name: '炭灰', family: 'solid', hex: '#34393F', opacity: 0.48, materialSku: null, defaultExposureLevel: null },
  { id: 'jet-black', name: '曜石黑', family: 'solid', hex: '#1C1E21', opacity: 0.58, materialSku: 'Sample_Black', defaultExposureLevel: null },
  { id: 'ocean-blue', name: '海洋蓝', family: 'solid', hex: '#2F6EA8', opacity: 0.38, materialSku: 'Sample_Blue', defaultExposureLevel: null },
  { id: 'cobalt-blue', name: '钴蓝', family: 'solid', hex: '#2D4E9A', opacity: 0.42, materialSku: null, defaultExposureLevel: null },
  { id: 'sapphire-blue', name: '宝石蓝', family: 'solid', hex: '#215E8A', opacity: 0.4, materialSku: null, defaultExposureLevel: null },
  { id: 'teal-green', name: '湖绿', family: 'solid', hex: '#2C8078', opacity: 0.36, materialSku: 'Sample_Green', defaultExposureLevel: null },
  { id: 'emerald-green', name: '祖母绿', family: 'solid', hex: '#2D8E63', opacity: 0.39, materialSku: null, defaultExposureLevel: null },
  { id: 'olive-green', name: '橄榄绿', family: 'solid', hex: '#707A3D', opacity: 0.34, materialSku: null, defaultExposureLevel: null },
  { id: 'amber-brown', name: '琥珀棕', family: 'solid', hex: '#966742', opacity: 0.36, materialSku: 'Sample_Brown', defaultExposureLevel: null },
  { id: 'cocoa-brown', name: '可可棕', family: 'solid', hex: '#6B4A34', opacity: 0.44, materialSku: null, defaultExposureLevel: null },
  { id: 'cognac-brown', name: '干邑棕', family: 'solid', hex: '#8A5A34', opacity: 0.41, materialSku: null, defaultExposureLevel: null },
  { id: 'rose-pink', name: '玫瑰粉', family: 'solid', hex: '#C88796', opacity: 0.28, materialSku: null, defaultExposureLevel: null },
  { id: 'violet-purple', name: '紫罗兰', family: 'solid', hex: '#715FA7', opacity: 0.34, materialSku: 'Sample_Purple', defaultExposureLevel: null },
  { id: 'burgundy', name: '酒红', family: 'solid', hex: '#7A3F4E', opacity: 0.38, materialSku: null, defaultExposureLevel: null },
  { id: 'sunset-orange', name: '晚霞橙', family: 'solid', hex: '#C27A3D', opacity: 0.3, materialSku: null, defaultExposureLevel: null },
  { id: 'honey-yellow', name: '蜜黄', family: 'solid', hex: '#D7B14A', opacity: 0.24, materialSku: null, defaultExposureLevel: null },
  { id: 'aqua-cyan', name: '水青', family: 'solid', hex: '#4A9CA4', opacity: 0.3, materialSku: null, defaultExposureLevel: null },
  { id: 'ice-blue', name: '冰蓝', family: 'solid', hex: '#9BBFD9', opacity: 0.22, materialSku: null, defaultExposureLevel: null },
  { id: 'steel-gray', name: '钢灰', family: 'solid', hex: '#737C88', opacity: 0.32, materialSku: null, defaultExposureLevel: null },
  { id: 'silver-haze', name: '银雾', family: 'solid', hex: '#9BA4AF', opacity: 0.26, materialSku: null, defaultExposureLevel: null },
  { id: 'bronze', name: '古铜', family: 'solid', hex: '#8B6A4C', opacity: 0.35, materialSku: null, defaultExposureLevel: null },
  { id: 'copper', name: '赤铜', family: 'solid', hex: '#A06549', opacity: 0.33, materialSku: null, defaultExposureLevel: null },
  { id: 'ruby-red', name: '宝石红', family: 'solid', hex: '#9A475A', opacity: 0.31, materialSku: null, defaultExposureLevel: null },
  { id: 'lavender', name: '薰衣草', family: 'solid', hex: '#9794C9', opacity: 0.24, materialSku: null, defaultExposureLevel: null },
  { id: 'forest-green', name: '森林绿', family: 'solid', hex: '#3A6A4A', opacity: 0.4, materialSku: null, defaultExposureLevel: null },
  { id: 'mint-green', name: '薄荷绿', family: 'solid', hex: '#88B9A8', opacity: 0.24, materialSku: null, defaultExposureLevel: null },
  { id: 'sky-light', name: '天青', family: 'solid', hex: '#7FA8D7', opacity: 0.27, materialSku: null, defaultExposureLevel: null },
  { id: 'photo-brown-light', name: '智能变色棕（浅）', family: 'photochromic', hex: '#B58A64', opacity: 0.28, materialSku: 'Sample_PhotochromaticBrown', defaultExposureLevel: 30 },
  { id: 'photo-brown-dark', name: '智能变色棕（深）', family: 'photochromic', hex: '#6D4C34', opacity: 0.52, materialSku: 'Sample_PhotochromaticBrown', defaultExposureLevel: 80 },
  { id: 'photo-green-light', name: '智能变色绿（浅）', family: 'photochromic', hex: '#77936E', opacity: 0.28, materialSku: 'Sample_PhotochromaticGreen', defaultExposureLevel: 30 },
  { id: 'photo-green-dark', name: '智能变色绿（深）', family: 'photochromic', hex: '#3F5E44', opacity: 0.5, materialSku: 'Sample_PhotochromaticGreen', defaultExposureLevel: 80 },
  { id: 'photo-gray-light', name: '智能变色灰（浅）', family: 'photochromic', hex: '#86909D', opacity: 0.3, materialSku: 'Sample_PhotochromaticGrey', defaultExposureLevel: 30 },
  { id: 'photo-gray-dark', name: '智能变色灰（深）', family: 'photochromic', hex: '#4A505B', opacity: 0.54, materialSku: 'Sample_PhotochromaticGrey', defaultExposureLevel: 80 },
  { id: 'mirror-black', name: '镜面黑', family: 'mirror', hex: '#2A2E35', opacity: 0.6, materialSku: 'Sample_MirrorBlack', defaultExposureLevel: null },
  { id: 'mirror-brown', name: '镜面棕', family: 'mirror', hex: '#70523E', opacity: 0.52, materialSku: 'Sample_MirrorBrown', defaultExposureLevel: null },
  { id: 'mirror-green', name: '镜面绿', family: 'mirror', hex: '#3A6B59', opacity: 0.52, materialSku: 'Sample_MirrorGreen', defaultExposureLevel: null },
  { id: 'mirror-gray', name: '镜面灰', family: 'mirror', hex: '#5E6673', opacity: 0.56, materialSku: 'Sample_MirrorGrey', defaultExposureLevel: null },
  { id: 'mirror-gray-brown', name: '镜面灰棕', family: 'mirror', hex: '#6C6259', opacity: 0.55, materialSku: 'Sample_MirrorGreyBrown', defaultExposureLevel: null },
  { id: 'mirror-purple', name: '镜面紫', family: 'mirror', hex: '#5E5476', opacity: 0.54, materialSku: 'Sample_MirrorPurple', defaultExposureLevel: null },
  { id: 'gradient-gray', name: '渐变灰', family: 'gradient', hex: '#606873', opacity: 0.34, materialSku: null, defaultExposureLevel: null },
  { id: 'gradient-brown', name: '渐变棕', family: 'gradient', hex: '#8A6347', opacity: 0.33, materialSku: null, defaultExposureLevel: null },
  { id: 'gradient-blue', name: '渐变蓝', family: 'gradient', hex: '#4E78A8', opacity: 0.31, materialSku: null, defaultExposureLevel: null },
  { id: 'gradient-green', name: '渐变绿', family: 'gradient', hex: '#4F7E67', opacity: 0.31, materialSku: null, defaultExposureLevel: null },
  { id: 'gradient-rose', name: '渐变玫瑰', family: 'gradient', hex: '#B98595', opacity: 0.28, materialSku: null, defaultExposureLevel: null },
  { id: 'gradient-purple', name: '渐变紫', family: 'gradient', hex: '#7E72A8', opacity: 0.3, materialSku: null, defaultExposureLevel: null },
  { id: 'polarized-slate', name: '偏光板岩灰', family: 'polarized', hex: '#55606E', opacity: 0.45, materialSku: null, defaultExposureLevel: null },
  { id: 'polarized-ocean', name: '偏光海蓝', family: 'polarized', hex: '#3E6F97', opacity: 0.43, materialSku: null, defaultExposureLevel: null },
];

export const DEFAULT_LENS_TINT_PRESETS: LensTintPreset[] = RAW_TINT_PRESETS.map(toPreset);

if (DEFAULT_LENS_TINT_PRESETS.length !== 50) {
  throw new Error(`Lens tint preset count mismatch: expected 50, got ${DEFAULT_LENS_TINT_PRESETS.length}`);
}

