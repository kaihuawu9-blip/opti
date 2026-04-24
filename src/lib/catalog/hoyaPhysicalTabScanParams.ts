/**
 * HOYA 豪雅手册 · 物理凸标扫描管线参数（StandardEye 预备）
 *
 * - 供未来 CV/OCR / 离线索引脚本读取；**不得**用于运行时自动导航（侧栏仍以页表
 *   `physicalTabVerified` + `physicalTabLabel` 为准，与蔡司同法案）。
 * - 豪雅凸标常见视觉：圆角矩形色块 + 系列色切换；此处给出归一化超参与与侧栏一致的色键。
 */

import { HOYA_SERIES_MENU } from '@/data/hoyaSeriesNav';

/** 右缘检测参考区（像素，相对整页左上角；与蔡司可独立调参） */
export const HOYA_PHYSICAL_TAB_EDGE_REGION = {
  anchor: 'top-right' as const,
  widthPx: 240,
  heightPx: 520,
};

/** 形态学/轮廓：凸标近似圆角矩形时的圆角半径提示（相对短边 0–1） */
export const HOYA_PHYSICAL_TAB_SHAPE_HINT = {
  cornerRadiusNormMin: 0.04,
  cornerRadiusNormMax: 0.14,
  /** 默认期望（花哨版式可略提高） */
  cornerRadiusNormDefault: 0.08,
} as const;

export type HoyaPhysicalTabColorKey = 'orange' | 'blue' | 'purple';

/**
 * 与 `HOYA_SERIES_MENU.tabAccent` / 侧栏 `navTabTone` 一致：检测管线可用作 HSV 先验或后验分类键。
 * key = 菜单 `id`（如 `p:新乐学`）。
 */
export const HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID: Readonly<Record<string, HoyaPhysicalTabColorKey>> = Object.freeze(
  Object.fromEntries(HOYA_SERIES_MENU.map((m) => [m.id, m.tabAccent])) as Record<string, HoyaPhysicalTabColorKey>,
);

/** 右缘裁切归一化（0–1），与蔡司 `topRightRegionAsRelativeCrop` 用法相同 */
export function hoyaTopRightTabStripAsRelativeCrop(imageWidthPx: number, imageHeightPx: number) {
  const w = Math.min(1, HOYA_PHYSICAL_TAB_EDGE_REGION.widthPx / Math.max(1, imageWidthPx));
  const h = Math.min(1, HOYA_PHYSICAL_TAB_EDGE_REGION.heightPx / Math.max(1, imageHeightPx));
  return { left: 1 - w, top: 0, width: w, height: h };
}

/**
 * 若未来在 `HOYA_SERIES_MENU` 增加「新明锐」等条目，凸标色常见为蓝系，请设 `tabAccent: 'blue'`
 * 以保持与检测管线色先验一致。
 */
