/**
 * 实体手册「物理凸起标签」— StandardEye V1.3 扫描管线辅助（**非**导航运行时依赖）
 *
 * - 裁切：右缘参考区见 `PHYSICAL_LABEL_TOP_RIGHT_REGION` / `topRightRegionAsRelativeCrop`。
 * - `detectZeissSeriesAliasFromCornerOrVerticalText`：仅离线写回 `seriesAliasKey` 提议；**侧栏唯一真值**仍为
 *   `physicalTabVerified` + `physicalTabLabel`（见 `zeissHandbookPageMap.ts` 文件头法案）。
 */

/** 相对页面左上角：右上角锚定的裁剪宽、高（像素） */
export const PHYSICAL_LABEL_TOP_RIGHT_REGION = {
  anchor: 'top-right' as const,
  widthPx: 200,
  heightPx: 500,
};

/**
 * 将物理像素区域转为「相对整页」的百分比裁剪框（供 Canvas / 服务端裁图）。
 */
export function topRightRegionAsRelativeCrop(imageWidthPx: number, imageHeightPx: number) {
  const w = Math.min(1, PHYSICAL_LABEL_TOP_RIGHT_REGION.widthPx / Math.max(1, imageWidthPx));
  const h = Math.min(1, PHYSICAL_LABEL_TOP_RIGHT_REGION.heightPx / Math.max(1, imageHeightPx));
  return {
    left: 1 - w,
    top: 0,
    width: w,
    height: h,
  };
}

/** 与页表 `seriesAliasKey` 对齐的可选机器键（pipeline 输出） */
export type ZeissHandbookSeriesAliasKey =
  | 'zeiss_smartlife'
  | 'zeiss_durasv'
  | 'zeiss_clearview'
  | 'zeiss_a_series'
  | 'zeiss_myopia'
  | 'zeiss_sv_ladder'
  | 'zeiss_light'
  | 'zeiss_drive'
  | 'zeiss_outdoor'
  | 'zeiss_office';

const ZEISS_CORNER_SERIES_RULES: readonly Readonly<{
  re: RegExp;
  aliasKey: ZeissHandbookSeriesAliasKey;
  label: string;
}>[] = [
  { re: /智[銳锐]\s*系列|智[銳锐]系列|SmartLife/i, aliasKey: 'zeiss_smartlife', label: '智锐系列' },
  { re: /新[清清]銳|新清锐|新明銳|新明锐/i, aliasKey: 'zeiss_clearview', label: '新清锐/新明锐' },
  { re: /澤銳|泽锐/i, aliasKey: 'zeiss_durasv', label: '泽锐' },
  { re: /A\s*系列|A系列/i, aliasKey: 'zeiss_a_series', label: 'A系列' },
  { re: /睐光|睞光/i, aliasKey: 'zeiss_light', label: '睐光' },
  { re: /小乐圆|成[長长]怡|近视管理|青少年/i, aliasKey: 'zeiss_myopia', label: '青少年/小乐圆' },
  { re: /单光家族|清晰视界|P24|P25|P26/i, aliasKey: 'zeiss_sv_ladder', label: '单光家族' },
  { re: /驾驶/i, aliasKey: 'zeiss_drive', label: '驾驶型' },
  { re: /户外/i, aliasKey: 'zeiss_outdoor', label: '户外' },
  { re: /办公|數碼|数码型/i, aliasKey: 'zeiss_office', label: '办公/数码' },
];

/**
 * 对「右缘 / 裁切区 OCR 合并文本」调用：供离线索引脚本写入页表，**不**参与运行时导航跳转。
 */
export function detectZeissSeriesAliasFromCornerOrVerticalText(text: string): {
  aliasKey: ZeissHandbookSeriesAliasKey;
  matchedLabel: string;
} | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const rule of ZEISS_CORNER_SERIES_RULES) {
    if (rule.re.test(t)) {
      return { aliasKey: rule.aliasKey, matchedLabel: rule.label };
    }
  }
  return null;
}
