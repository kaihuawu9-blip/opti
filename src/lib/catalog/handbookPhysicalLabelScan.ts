/**
 * 实体手册「物理凸起标签」— StandardEye 扫描管线辅助（**非**导航运行时依赖）
 *
 * ## 全域雷达模式（Full Canvas + 多品牌）
 * - **`full_radar`**：整页粗网格 + 连通域，标签可在**任意位置**（书脊/内侧/非右缘）。
 * - **`hoya_global_color`**：在全域基础上，优先锁定 **橙 / 蓝 / 紫** 品牌色块（内嵌色条），并与「墨/深灰」并集；
 *   **竖长条**仍用高宽比代理「垂直短文本」列，可再配合列方差 `verticalStrokeVariance` 加权。
 * - **`zeiss_edge_weighted`**：合并「全图 + 左/中/右三带」候选，对 **靠左右缘** 的命中施加 **更高权重**（蔡司凸标多贴边），中部略降权。
 * - **`legacy_perimeter`**（默认）：仅三带扫描，兼容旧脚本与单测。
 *
 * 输出统一为 **`PhysicalTabScanCandidate`**：`centerX/Y` → 页表 **`hOffsetPercent` / `vOffsetPercent`**（动态锚点，无需手填 v）。
 *
 * ## 蔡司历史裁切（仍导出）
 * - `PHYSICAL_LABEL_TOP_RIGHT_REGION` / `topRightRegionAsRelativeCrop`：`@deprecated`。
 *
 * - `detectZeissSeriesAliasFromCornerOrVerticalText`：离线 `seriesAliasKey` 提议；页表真值仍为
 *   `physicalTabVerified` + `physicalTabLabel`。
 */

/** 相对页面左上角：右上角锚定的裁剪宽、高（像素）— 蔡司旧管线；新扫描请用全域/三带 API */
export const PHYSICAL_LABEL_TOP_RIGHT_REGION = {
  anchor: 'top-right' as const,
  widthPx: 200,
  heightPx: 500,
};

/**
 * 将物理像素区域转为「相对整页」的百分比裁剪框（供 Canvas / 服务端裁图）。
 * @deprecated 新场景请使用 {@link perimeterBandRelativeCrop} 或 {@link scanPhysicalTabCandidatesFromImageData} 的 `preset`。
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

// ─── 全週邊：三关键带 + 全页伪带 `full`（用于类型标记）────────────────────────

/** 左缘 | 摺痕/书口 | 右缘 | 全图（全域雷达） */
export type PerimeterBand = 'left' | 'center' | 'right' | 'full';

/** 各带水平范围（归一化）；`full` 表示整宽 [0,1] */
export const PHYSICAL_TAB_PERIMETER_BAND_REL: Readonly<
  Record<Exclude<PerimeterBand, 'full'>, { x0: number; x1: number }>
> = Object.freeze({
  left: { x0: 0, x1: 0.2 },
  center: { x0: 0.38, x1: 0.62 },
  right: { x0: 0.78, x1: 1 },
});

export type RelativeCrop = { left: number; top: number; width: number; height: number };

export function perimeterBandRelativeCrop(
  band: Exclude<PerimeterBand, 'full'>,
  _imageWidthPx: number,
  _imageHeightPx: number,
): RelativeCrop {
  const { x0, x1 } = PHYSICAL_TAB_PERIMETER_BAND_REL[band];
  return { left: x0, top: 0, width: Math.max(0.01, x1 - x0), height: 1 };
}

export function allPerimeterBandRelativeCrops(
  imageWidthPx: number,
  imageHeightPx: number,
): ReadonlyArray<{ band: Exclude<PerimeterBand, 'full'>; crop: RelativeCrop }> {
  return (['left', 'center', 'right'] as const).map((band) => ({
    band,
    crop: perimeterBandRelativeCrop(band, imageWidthPx, imageHeightPx),
  }));
}

// ─── 扫描预设 & 候选类型 ─────────────────────────────────────────────────────

export type PhysicalTabScanPreset =
  /** 仅左/中/右三带（旧行为） */
  | 'legacy_perimeter'
  /** 整页色块/墨块检索 */
  | 'full_radar'
  /** 豪雅：全域 + 橙/蓝/紫品牌色块优先（内嵌书脊标签） */
  | 'hoya_global_color'
  /** 蔡司：全图 + 三带合并，左右缘加权 */
  | 'zeiss_edge_weighted';

export type PhysicalTabScanOptions = {
  paperLumaEstimate?: number;
  darkDelta?: number;
  cellPx?: number;
  inkCellFrac?: number;
  minAreaFrac?: number;
  verticalAspectMin?: number;
  /**
   * 扫描策略；默认 `legacy_perimeter` 保持与既有单测一致。
   * 豪雅离线管线建议 **`hoya_global_color`**；蔡司建议 **`zeiss_edge_weighted`**。
   */
  preset?: PhysicalTabScanPreset;
};

export type PhysicalTabScanCandidate = {
  band: PerimeterBand;
  centerXPercent: number;
  centerYPercent: number;
  vOffsetPercent: number;
  hOffsetPercent: number;
  bboxNorm: { x: number; y: number; w: number; h: number };
  contrastScore: number;
  verticalTextBoost: number;
  /** 列方向灰度方差代理「竖排笔画」；越大越像有条状字 */
  verticalStrokeVariance: number;
  /** 豪雅色块饱和度累计（仅 hoya_global_color 有意义） */
  colorBlockScore: number;
  combinedScore: number;
  scanPreset?: PhysicalTabScanPreset;
};

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 从四边条带估计纸面背景亮度（中位数） */
export function estimatePaperBackgroundLuma(data: Uint8ClampedArray, W: number, H: number): number {
  const strip = Math.max(2, Math.min(24, Math.floor(Math.min(W, H) * 0.02)));
  const samples: number[] = [];
  const pushPx = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    samples.push(luma(data[i]!, data[i + 1]!, data[i + 2]!));
  };
  for (let x = 0; x < W; x += 4) {
    for (let t = 0; t < strip; t++) {
      pushPx(x, t);
      pushPx(x, H - 1 - t);
    }
  }
  for (let y = 0; y < H; y += 4) {
    for (let t = 0; t < strip; t++) {
      pushPx(t, y);
      pushPx(W - 1 - t, y);
    }
  }
  if (samples.length === 0) return 245;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function isInk(
  data: Uint8ClampedArray,
  W: number,
  x: number,
  y: number,
  paper: number,
  darkDelta: number,
): boolean {
  const i = (y * W + x) * 4;
  const L = luma(data[i]!, data[i + 1]!, data[i + 2]!);
  return L < paper - darkDelta || L < 212;
}

/**
 * 豪雅手册常见凸标底色：橙 / 蓝 / 紫（RGB 启发式，供全域色块并集使用）。
 * 与「白/浅灰纸面」形成高对比时，即使不在右缘也应被 `hoya_global_color` 捕获。
 */
export function isHoyaPhysicalTabColorPixel(r: number, g: number, b: number): boolean {
  const orange = r > 155 && g > 65 && g < 210 && b < 115;
  const blue = b > 115 && r < 125 && g > 55 && g < 205;
  const purple = r > 95 && b > 130 && g < 150;
  return orange || blue || purple;
}

function cellHoyaColorFrac(
  data: Uint8ClampedArray,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  let hit = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4;
      if (isHoyaPhysicalTabColorPixel(data[i]!, data[i + 1]!, data[i + 2]!)) hit++;
      total++;
    }
  }
  return total > 0 ? hit / total : 0;
}

type ResolvedScanOpts = {
  paper: number;
  darkDelta: number;
  cellPx: number;
  inkCellFrac: number;
  minAreaFrac: number;
  verticalAspectMin: number;
};

function resolveOpts(imageData: ImageData, options?: PhysicalTabScanOptions): ResolvedScanOpts {
  const { width: W, height: H, data } = imageData;
  const paper = options?.paperLumaEstimate ?? estimatePaperBackgroundLuma(data, W, H);
  const darkDelta = options?.darkDelta ?? 36;
  const cellPx = Math.max(4, Math.min(20, options?.cellPx ?? Math.round(Math.min(W, H) / 120)));
  const inkCellFrac = options?.inkCellFrac ?? 0.1;
  const minAreaFrac = options?.minAreaFrac ?? 0.00035;
  const verticalAspectMin = options?.verticalAspectMin ?? 1.75;
  return { paper, darkDelta, cellPx, inkCellFrac, minAreaFrac, verticalAspectMin };
}

function verticalStrokeVarianceInBox(
  data: Uint8ClampedArray,
  W: number,
  px0: number,
  px1: number,
  py0: number,
  py1: number,
  paper: number,
  darkDelta: number,
): number {
  const cols = 8;
  const cw = Math.max(1, Math.floor((px1 - px0) / cols));
  const counts: number[] = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    const cx0 = px0 + c * cw;
    const cx1 = c === cols - 1 ? px1 : Math.min(px1, cx0 + cw);
    for (let y = py0; y < py1; y += 2) {
      for (let x = cx0; x < cx1; x += 2) {
        if (isInk(data, W, x, y, paper, darkDelta)) counts[c]!++;
      }
    }
  }
  const mean = counts.reduce((a, b) => a + b, 0) / cols;
  let v = 0;
  for (const k of counts) v += (k - mean) ** 2;
  return v / cols;
}

function collectBlobsInVerticalStrip(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  bx0: number,
  bx1: number,
  band: PerimeterBand,
  o: ResolvedScanOpts,
  inkMode: 'luma' | 'hoya_union',
  presetTag: PhysicalTabScanPreset | undefined,
): PhysicalTabScanCandidate[] {
  const { paper, darkDelta, cellPx, inkCellFrac, minAreaFrac, verticalAspectMin } = o;
  const pageArea = W * H;
  const minAreaPx = Math.max(80, minAreaFrac * pageArea);
  const bandW = Math.max(1, bx1 - bx0);
  const gw = Math.max(1, Math.ceil(bandW / cellPx));
  const gh = Math.max(1, Math.ceil(H / cellPx));
  const ink = new Uint8Array(gw * gh);

  const hoyaColorTh = inkMode === 'hoya_union' ? 0.055 : 0;

  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * cellPx;
    const y1 = Math.min(H, y0 + cellPx);
    for (let gx = 0; gx < gw; gx++) {
      const x0p = bx0 + gx * cellPx;
      const x1p = Math.min(bx1, x0p + cellPx);
      let dark = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0p; x < x1p; x += 2) {
          total++;
          if (isInk(data, W, x, y, paper, darkDelta)) dark++;
        }
      }
      const inkF = total > 0 ? dark / total : 0;
      const colorF = inkMode === 'hoya_union' ? cellHoyaColorFrac(data, W, x0p, x1p, y0, y1) : 0;
      const active =
        inkMode === 'luma'
          ? inkF >= inkCellFrac
          : inkF >= inkCellFrac * 0.65 || colorF >= hoyaColorTh;
      if (active) ink[gx + gy * gw] = 1;
    }
  }

  const candidates: PhysicalTabScanCandidate[] = [];
  const seen = new Uint8Array(gw * gh);
  const nb8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;

  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || seen[i]) continue;
    const q: number[] = [i];
    seen[i] = 1;
    let minGx = gw,
      maxGx = -1,
      minGy = gh,
      maxGy = -1;
    let cells = 0;

    while (q.length) {
      const cur = q.pop()!;
      cells++;
      const gix = cur % gw;
      const giy = (cur / gw) | 0;
      minGx = Math.min(minGx, gix);
      maxGx = Math.max(maxGx, gix);
      minGy = Math.min(minGy, giy);
      maxGy = Math.max(maxGy, giy);

      for (const [dx, dy] of nb8) {
        const nx = gix + dx;
        const ny = giy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = nx + ny * gw;
        if (!ink[n] || seen[n]) continue;
        seen[n] = 1;
        q.push(n);
      }
    }

    const px0 = bx0 + minGx * cellPx;
    const px1 = Math.min(W, bx0 + (maxGx + 1) * cellPx);
    const py0 = minGy * cellPx;
    const py1 = Math.min(H, (maxGy + 1) * cellPx);
    const bw = Math.max(1, px1 - px0);
    const bh = Math.max(1, py1 - py0);
    const areaPx = bw * bh;
    if (areaPx < minAreaPx) continue;

    let sumL = 0;
    let cnt = 0;
    let colorHits = 0;
    const step = Math.max(1, Math.floor(Math.min(bw, bh) / 24));
    for (let y = py0; y < py1; y += step) {
      for (let x = px0; x < px1; x += step) {
        const ii = (y * W + x) * 4;
        const r = data[ii]!,
          g = data[ii + 1]!,
          b = data[ii + 2]!;
        if (isInk(data, W, x, y, paper, darkDelta)) {
          sumL += luma(r, g, b);
          cnt++;
        }
        if (inkMode === 'hoya_union' && isHoyaPhysicalTabColorPixel(r, g, b)) colorHits++;
      }
    }
    const meanInkL = cnt > 0 ? sumL / cnt : paper;
    const contrastScore = Math.max(0, paper - meanInkL);
    const sampled = Math.max(1, Math.ceil((py1 - py0) / step) * Math.ceil((px1 - px0) / step));
    const colorBlockScore =
      inkMode === 'hoya_union' ? Math.min(1, colorHits / sampled) : 0;

    const aspect = bh / Math.max(1, bw);
    const verticalTextBoost = aspect >= verticalAspectMin ? 2 : 1;
    const varStroke = verticalStrokeVarianceInBox(data, W, px0, px1, py0, py1, paper, darkDelta);
    const varBoost = 1 + Math.min(1.2, varStroke / (500 + varStroke * 0.01));

    const areaNorm = areaPx / pageArea;
    let combinedScore =
      contrastScore * Math.sqrt(areaNorm) * verticalTextBoost * varBoost * (1 + cells * 0.01);
    if (inkMode === 'hoya_union') {
      combinedScore *= 1 + colorBlockScore * 2.2;
    }

    const cx = (px0 + px1) / 2;
    const cy = (py0 + py1) / 2;
    const centerXPercent = (cx / W) * 100;
    const centerYPercent = (cy / H) * 100;

    candidates.push({
      band,
      centerXPercent,
      centerYPercent,
      vOffsetPercent: centerYPercent,
      hOffsetPercent: centerXPercent,
      bboxNorm: {
        x: px0 / W,
        y: py0 / H,
        w: bw / W,
        h: bh / H,
      },
      contrastScore,
      verticalTextBoost,
      verticalStrokeVariance: varStroke,
      colorBlockScore,
      combinedScore,
      scanPreset: presetTag,
    });
  }

  return candidates;
}

function zeissEdgeMultiplier(centerXPercent: number): number {
  if (centerXPercent <= 22 || centerXPercent >= 78) return 1.48;
  if (centerXPercent >= 38 && centerXPercent <= 62) return 0.94;
  return 1.06;
}

/**
 * 物理标签候选扫描（多预设）。
 *
 * - `legacy_perimeter`：左/中/右三带，`luma` 墨块。
 * - `full_radar`：整页 `band: 'full'`，`luma`。
 * - `hoya_global_color`：整页 **`hoya_union`**（品牌色 ∪ 墨）。
 * - `zeiss_edge_weighted`：全图 + 三带合并，左右缘 **combinedScore** 乘权。
 */
export function scanPhysicalTabCandidatesFromImageData(
  imageData: ImageData,
  options?: PhysicalTabScanOptions,
): PhysicalTabScanCandidate[] {
  const { width: W, height: H, data } = imageData;
  if (W < 32 || H < 32) return [];

  const preset: PhysicalTabScanPreset = options?.preset ?? 'legacy_perimeter';
  const o = resolveOpts(imageData, options);

  const runStrip = (
    bx0: number,
    bx1: number,
    band: PerimeterBand,
    ink: 'luma' | 'hoya_union',
    tag: PhysicalTabScanPreset,
  ) => collectBlobsInVerticalStrip(data, W, H, bx0, bx1, band, o, ink, tag);

  let out: PhysicalTabScanCandidate[] = [];

  if (preset === 'legacy_perimeter') {
    for (const b of ['left', 'center', 'right'] as const) {
      const { x0, x1 } = PHYSICAL_TAB_PERIMETER_BAND_REL[b];
      out = out.concat(runStrip(Math.floor(x0 * W), Math.ceil(x1 * W), b, 'luma', preset));
    }
    out.sort((a, b) => b.combinedScore - a.combinedScore);
    return out;
  }

  if (preset === 'full_radar') {
    out = runStrip(0, W, 'full', 'luma', preset);
    out.sort((a, b) => b.combinedScore - a.combinedScore);
    return out;
  }

  if (preset === 'hoya_global_color') {
    out = runStrip(0, W, 'full', 'hoya_union', preset);
    out.sort((a, b) => b.combinedScore - a.combinedScore);
    return out;
  }

  // zeiss_edge_weighted
  const full = runStrip(0, W, 'full', 'luma', preset);
  const strips: PhysicalTabScanCandidate[] = [];
  for (const b of ['left', 'center', 'right'] as const) {
    const { x0, x1 } = PHYSICAL_TAB_PERIMETER_BAND_REL[b];
    strips.push(...runStrip(Math.floor(x0 * W), Math.ceil(x1 * W), b, 'luma', preset));
  }
  const merged = [...full, ...strips];
  for (const c of merged) {
    const wmul = zeissEdgeMultiplier(c.centerXPercent);
    c.combinedScore *= wmul;
    c.scanPreset = preset;
  }
  merged.sort((a, b) => b.combinedScore - a.combinedScore);
  return merged;
}

/** 取扫描得分最高的一条；无合格候选时返回 null */
export function pickBestPhysicalTabScanCandidate(
  imageData: ImageData,
  options?: PhysicalTabScanOptions,
): PhysicalTabScanCandidate | null {
  const all = scanPhysicalTabCandidatesFromImageData(imageData, options);
  return all[0] ?? null;
}

/**
 * 动态锚点：直接把页表 `vOffsetPercent` / `hOffsetPercent` 写成算法输出的中心（0–100），
 * 无需手填 v；热区覆盖在检测到的色块中心（见 `ZeissHandbookPage`）。
 */
export function extractDynamicTabAnchorPercents(
  imageData: ImageData,
  options?: PhysicalTabScanOptions,
): {
  vOffsetPercent: number;
  hOffsetPercent: number;
  centerXPercent: number;
  centerYPercent: number;
  bboxNorm: PhysicalTabScanCandidate['bboxNorm'];
} | null {
  const p = pickBestPhysicalTabScanCandidate(imageData, options);
  if (!p) return null;
  return {
    vOffsetPercent: p.vOffsetPercent,
    hOffsetPercent: p.hOffsetPercent,
    centerXPercent: p.centerXPercent,
    centerYPercent: p.centerYPercent,
    bboxNorm: p.bboxNorm,
  };
}

/** 蔡司离线索引：推荐 `preset: 'zeiss_edge_weighted'` */
export function scanZeissPhysicalTabCandidatesFromImageData(
  imageData: ImageData,
  options?: Omit<PhysicalTabScanOptions, 'preset'>,
): PhysicalTabScanCandidate[] {
  return scanPhysicalTabCandidatesFromImageData(imageData, { ...options, preset: 'zeiss_edge_weighted' });
}

/** 豪雅离线索引：推荐 `preset: 'hoya_global_color'`（全域 + 橙/蓝/紫） */
export function scanHoyaPhysicalTabCandidatesFromImageData(
  imageData: ImageData,
  options?: Omit<PhysicalTabScanOptions, 'preset'>,
): PhysicalTabScanCandidate[] {
  return scanPhysicalTabCandidatesFromImageData(imageData, { ...options, preset: 'hoya_global_color' });
}

// ─── 右上四分之一限域裁切 + HOYA 色块模糊匹配 ───────────────────────────────

/** 右上四分之一区域归一化裁切（供「全域雷达」在此限域内进一步精搜） */
export const HOYA_TOP_RIGHT_QUADRANT_REL: Readonly<RelativeCrop> = Object.freeze({
  left: 0.5,
  top: 0,
  width: 0.5,
  height: 0.5,
});

/**
 * 在右上四分之一区域内运行 `hoya_global_color` 扫描。
 *
 * 离线脚本使用：先用 Canvas 把 `HOYA_TOP_RIGHT_QUADRANT_REL` 区域裁出得到 `quadrantImageData`，
 * 再调用本函数；返回的候选 `bboxNorm / centerX/Y` 是相对**子图**的，需用 `remapQuadrantCandidateToFullPage`
 * 映回整页坐标（避免把子图比例当成整页比例）。
 */
export function scanHoyaTopRightQuadrantCandidates(
  quadrantImageData: ImageData,
  options?: Omit<PhysicalTabScanOptions, 'preset'>,
): PhysicalTabScanCandidate[] {
  return scanPhysicalTabCandidatesFromImageData(quadrantImageData, {
    ...options,
    preset: 'hoya_global_color',
  });
}

/** 把子图（任意 `RelativeCrop`）里的候选坐标映射回整页（0–100 百分比） */
export function remapQuadrantCandidateToFullPage(
  cand: PhysicalTabScanCandidate,
  quadrant: RelativeCrop = HOYA_TOP_RIGHT_QUADRANT_REL,
): PhysicalTabScanCandidate {
  const bx = quadrant.left + cand.bboxNorm.x * quadrant.width;
  const by = quadrant.top + cand.bboxNorm.y * quadrant.height;
  const bw = cand.bboxNorm.w * quadrant.width;
  const bh = cand.bboxNorm.h * quadrant.height;
  const cxPct = (bx + bw / 2) * 100;
  const cyPct = (by + bh / 2) * 100;
  return {
    ...cand,
    centerXPercent: cxPct,
    centerYPercent: cyPct,
    vOffsetPercent: cyPct,
    hOffsetPercent: cxPct,
    bboxNorm: { x: bx, y: by, w: bw, h: bh },
  };
}

/** HOYA 系列规范机器键（与 `HOYA_SERIES_MENU.id` 松耦合：`fromMenuId` 方便写回页表） */
export type HoyaSeriesAliasKey =
  | 'hoya_xinmingrui'
  | 'hoya_xinleuxue'
  | 'hoya_eyvia'
  | 'hoya_eynoa'
  | 'hoya_eyas2'
  | 'hoya_zhiyu'
  | 'hoya_coating'
  | 'hoya_lifestyle';

/**
 * HOYA 模糊文案 → 规范标签。
 * 重点：`新明銳 N3 / N5 / Pro / …` 统一吃成 `新明锐`；不要求后缀对齐即可命中 `series_entry`。
 */
const HOYA_FUZZY_SERIES_RULES: readonly Readonly<{
  re: RegExp;
  aliasKey: HoyaSeriesAliasKey;
  canonicalLabel: string;
  fromMenuId?: string;
}>[] = [
  {
    re: /(新\s*[明眀]\s*[銳锐])(?:\s*(?:N\d+|Pro|S|M)?)/i,
    aliasKey: 'hoya_xinmingrui',
    canonicalLabel: '新明锐',
  },
  {
    re: /新\s*乐\s*学|MiyoSmart/i,
    aliasKey: 'hoya_xinleuxue',
    canonicalLabel: '新乐学',
    fromMenuId: 'p:新乐学',
  },
  { re: /Eyvia/i, aliasKey: 'hoya_eyvia', canonicalLabel: 'Eyvia', fromMenuId: 'p:Eyvia单光' },
  { re: /Eynoa/i, aliasKey: 'hoya_eynoa', canonicalLabel: 'Eynoa', fromMenuId: 'p:Eynoa单光' },
  { re: /Eyas\s*2|Eyas2|Eyas\s*II/i, aliasKey: 'hoya_eyas2', canonicalLabel: 'Eyas2', fromMenuId: 'p:Eyas2单光' },
  { re: /智\s*御/i, aliasKey: 'hoya_zhiyu', canonicalLabel: '智御', fromMenuId: 'p:豪雅智御中近' },
  { re: /膜\s*层|VP\s*膜|超韧膜|EXT/i, aliasKey: 'hoya_coating', canonicalLabel: '膜层', fromMenuId: 's:hoya-coating' },
  { re: /场\s*景|驾驶|户外|办公/i, aliasKey: 'hoya_lifestyle', canonicalLabel: '场景', fromMenuId: 's:hoya-lifestyle' },
];

export type HoyaSeriesFuzzyMatch = {
  aliasKey: HoyaSeriesAliasKey;
  canonicalLabel: string;
  fromMenuId?: string;
  matchedText: string;
  /** `New Minru N3` / `新明銳 N5` / `新明锐` 都会被规范化为 `canonicalLabel` */
  normalizedInput: string;
};

/**
 * 供离线管线使用：把色块内 OCR 文本（含 `N3/N5` 等后缀）模糊映射到规范系列名。
 * 即使文本是噪声较大的单行也能容忍；**无**命中时返回 null。
 */
export function matchHoyaSeriesFromColorBlockText(text: string): HoyaSeriesFuzzyMatch | null {
  const normalized = (text ?? '')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[（(].*?[）)]/g, ' ')
    .trim();
  if (!normalized) return null;
  for (const rule of HOYA_FUZZY_SERIES_RULES) {
    const m = rule.re.exec(normalized);
    if (m) {
      return {
        aliasKey: rule.aliasKey,
        canonicalLabel: rule.canonicalLabel,
        fromMenuId: rule.fromMenuId,
        matchedText: m[0],
        normalizedInput: normalized,
      };
    }
  }
  return null;
}

/**
 * 融合产物：色块候选 + OCR 文本 → 可直接写回 `HOYA_SERIES_MENU` 或 `zeissHandbookPageMap` 的 `series_entry` 片段。
 *
 * 返回对象已经包含 **动态** `vOffsetPercent / hOffsetPercent`（来自扫描），**不读任何旧缓存**。
 */
export function hoyaSeriesEntryFromColorBlockOcr(input: {
  pdfPage: number;
  ocrText: string;
  candidate: PhysicalTabScanCandidate;
}): {
  pdfPage: number;
  pageKind: 'series_entry';
  physicalTabVerified: true;
  physicalTabLabel: string;
  vOffsetPercent: number;
  hOffsetPercent: number;
  bboxNorm: PhysicalTabScanCandidate['bboxNorm'];
  aliasKey: HoyaSeriesAliasKey;
  fromMenuId?: string;
} | null {
  const m = matchHoyaSeriesFromColorBlockText(input.ocrText);
  if (!m) return null;
  return {
    pdfPage: input.pdfPage,
    pageKind: 'series_entry',
    physicalTabVerified: true,
    physicalTabLabel: m.canonicalLabel,
    vOffsetPercent: input.candidate.vOffsetPercent,
    hOffsetPercent: input.candidate.hOffsetPercent,
    bboxNorm: input.candidate.bboxNorm,
    aliasKey: m.aliasKey,
    fromMenuId: m.fromMenuId,
  };
}

// ─── 蔡司系列别名（OCR 文本规则，与几何扫描独立）────────────────────────────

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
