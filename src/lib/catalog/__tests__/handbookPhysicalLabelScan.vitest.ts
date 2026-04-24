import { describe, expect, it } from 'vitest';
import {
  allPerimeterBandRelativeCrops,
  detectZeissSeriesAliasFromCornerOrVerticalText,
  estimatePaperBackgroundLuma,
  extractDynamicTabAnchorPercents,
  HOYA_TOP_RIGHT_QUADRANT_REL,
  hoyaSeriesEntryFromColorBlockOcr,
  isHoyaPhysicalTabColorPixel,
  matchHoyaSeriesFromColorBlockText,
  perimeterBandRelativeCrop,
  PHYSICAL_LABEL_TOP_RIGHT_REGION,
  PHYSICAL_TAB_PERIMETER_BAND_REL,
  pickBestPhysicalTabScanCandidate,
  remapQuadrantCandidateToFullPage,
  scanHoyaTopRightQuadrantCandidates,
  scanPhysicalTabCandidatesFromImageData,
  topRightRegionAsRelativeCrop,
  type PhysicalTabScanCandidate,
} from '@/lib/catalog/handbookPhysicalLabelScan';
import { getPageData } from '@/data/zeissHandbookPageMap';
import { assessHandbookMarketingIndexMeta } from '@/lib/catalog/handbookMarketingPage';
import { HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID } from '@/lib/catalog/hoyaPhysicalTabScanParams';
import { buildZeissPhysicalTabNavItems } from '@/data/zeissHandbookPageMap';
import type { HandbookPageEntry } from '@/data/zeissHandbookPageMap';

/** Node 环境无 `ImageData` 时用于单测的轻量替身（与 Canvas ImageData 字段兼容） */
function createTestImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('handbookPhysicalLabelScan', () => {
  it('右上角区域常量 200×500', () => {
    expect(PHYSICAL_LABEL_TOP_RIGHT_REGION.widthPx).toBe(200);
    expect(PHYSICAL_LABEL_TOP_RIGHT_REGION.heightPx).toBe(500);
  });

  it('topRightRegionAsRelativeCrop 归一化', () => {
    const c = topRightRegionAsRelativeCrop(2000, 2800);
    expect(c.left).toBeCloseTo(0.9, 5);
    expect(c.top).toBe(0);
    expect(c.width).toBeCloseTo(0.1, 5);
    expect(c.height).toBeCloseTo(500 / 2800, 5);
  });

  it('detectZeissSeriesAliasFromCornerOrVerticalText：智锐系列', () => {
    const r = detectZeissSeriesAliasFromCornerOrVerticalText('智锐系列 单光');
    expect(r?.aliasKey).toBe('zeiss_smartlife');
  });

  it('PHYSICAL_TAB_PERIMETER_BAND_REL 左/中/右三带互不重叠（水平间隙）', () => {
    expect(PHYSICAL_TAB_PERIMETER_BAND_REL.left.x1).toBeLessThanOrEqual(PHYSICAL_TAB_PERIMETER_BAND_REL.center.x0);
    expect(PHYSICAL_TAB_PERIMETER_BAND_REL.center.x1).toBeLessThanOrEqual(PHYSICAL_TAB_PERIMETER_BAND_REL.right.x0);
  });

  it('perimeterBandRelativeCrop + allPerimeterBandRelativeCrops', () => {
    const c = perimeterBandRelativeCrop('center', 1000, 2000);
    expect(c.left).toBe(PHYSICAL_TAB_PERIMETER_BAND_REL.center.x0);
    expect(c.width).toBeCloseTo(
      PHYSICAL_TAB_PERIMETER_BAND_REL.center.x1 - PHYSICAL_TAB_PERIMETER_BAND_REL.center.x0,
      8,
    );
    expect(allPerimeterBandRelativeCrops(800, 600)).toHaveLength(3);
  });

  it('scanPhysicalTabCandidatesFromImageData：左带深色块 → 候选含 band=left 与 h/v', () => {
    const W = 160;
    const H = 200;
    const id = createTestImageData(W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = 252;
      id.data[i + 1] = 252;
      id.data[i + 2] = 250;
      id.data[i + 3] = 255;
    }
    const x0 = Math.floor(PHYSICAL_TAB_PERIMETER_BAND_REL.left.x0 * W) + 4;
    const x1 = Math.floor(PHYSICAL_TAB_PERIMETER_BAND_REL.left.x1 * W) - 4;
    for (let y = 70; y < 150; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        id.data[o] = 18;
        id.data[o + 1] = 18;
        id.data[o + 2] = 22;
        id.data[o + 3] = 255;
      }
    }
    expect(estimatePaperBackgroundLuma(id.data, W, H)).toBeGreaterThan(230);
    const hits = scanPhysicalTabCandidatesFromImageData(id, {
      cellPx: 6,
      minAreaFrac: 0.0002,
      preset: 'legacy_perimeter',
    });
    expect(hits.length).toBeGreaterThan(0);
    const best = hits[0]!;
    expect(best.band).toBe('left');
    expect(best.centerXPercent).toBeGreaterThan(0);
    expect(best.centerYPercent).toBeGreaterThan(10);
    expect(best.hOffsetPercent).toBe(best.centerXPercent);
    expect(best.vOffsetPercent).toBe(best.centerYPercent);
    const pick = pickBestPhysicalTabScanCandidate(id, {
      cellPx: 6,
      minAreaFrac: 0.0002,
      preset: 'legacy_perimeter',
    });
    expect(pick?.band).toBe('left');
  });

  it('scanPhysicalTabCandidatesFromImageData：中带竖长块 → center 带得分占优', () => {
    const W = 220;
    const H = 260;
    const id = createTestImageData(W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = 250;
      id.data[i + 1] = 250;
      id.data[i + 2] = 248;
      id.data[i + 3] = 255;
    }
    const cx0 = Math.floor(0.42 * W);
    const cx1 = Math.ceil(0.58 * W);
    for (let y = 40; y < 210; y++) {
      for (let x = cx0; x < cx1; x++) {
        const o = (y * W + x) * 4;
        id.data[o] = 30;
        id.data[o + 1] = 28;
        id.data[o + 2] = 32;
        id.data[o + 3] = 255;
      }
    }
    const best = pickBestPhysicalTabScanCandidate(id, {
      cellPx: 8,
      minAreaFrac: 0.00015,
      preset: 'legacy_perimeter',
    });
    expect(best?.band).toBe('center');
    expect(best!.centerXPercent).toBeGreaterThan(38);
    expect(best!.centerXPercent).toBeLessThan(62);
  });

  it('isHoyaPhysicalTabColorPixel：橙/蓝启发式', () => {
    expect(isHoyaPhysicalTabColorPixel(200, 100, 40)).toBe(true);
    expect(isHoyaPhysicalTabColorPixel(40, 90, 180)).toBe(true);
    expect(isHoyaPhysicalTabColorPixel(250, 250, 250)).toBe(false);
  });

  it('full_radar：整页中心深色块可被捕获（band=full）', () => {
    const W = 180;
    const H = 200;
    const id = createTestImageData(W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = 248;
      id.data[i + 1] = 248;
      id.data[i + 2] = 246;
      id.data[i + 3] = 255;
    }
    for (let y = 60; y < 140; y++) {
      for (let x = 70; x < 110; x++) {
        const o = (y * W + x) * 4;
        id.data[o] = 25;
        id.data[o + 1] = 25;
        id.data[o + 2] = 28;
        id.data[o + 3] = 255;
      }
    }
    const best = pickBestPhysicalTabScanCandidate(id, {
      preset: 'full_radar',
      cellPx: 6,
      minAreaFrac: 0.0002,
    });
    expect(best?.band).toBe('full');
    expect(best!.centerXPercent).toBeGreaterThan(40);
    expect(best!.centerXPercent).toBeLessThan(70);
  });

  it('hoya_global_color：书脊处橙色块 → 动态锚点接近画面中心', () => {
    const W = 200;
    const H = 220;
    const id = createTestImageData(W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = 252;
      id.data[i + 1] = 252;
      id.data[i + 2] = 250;
      id.data[i + 3] = 255;
    }
    for (let y = 50; y < 170; y++) {
      for (let x = 88; x < 112; x++) {
        const o = (y * W + x) * 4;
        id.data[o] = 200;
        id.data[o + 1] = 95;
        id.data[o + 2] = 35;
        id.data[o + 3] = 255;
      }
    }
    const anchor = extractDynamicTabAnchorPercents(id, {
      preset: 'hoya_global_color',
      cellPx: 6,
      minAreaFrac: 0.00015,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.hOffsetPercent).toBeGreaterThan(42);
    expect(anchor!.hOffsetPercent).toBeLessThan(58);
    expect(anchor!.vOffsetPercent).toBeGreaterThan(35);
    expect(anchor!.vOffsetPercent).toBeLessThan(65);
  });

  it('HOYA_TOP_RIGHT_QUADRANT_REL：限域为右上四分之一（0.5,0 起，宽高 0.5）', () => {
    expect(HOYA_TOP_RIGHT_QUADRANT_REL.left).toBe(0.5);
    expect(HOYA_TOP_RIGHT_QUADRANT_REL.top).toBe(0);
    expect(HOYA_TOP_RIGHT_QUADRANT_REL.width).toBe(0.5);
    expect(HOYA_TOP_RIGHT_QUADRANT_REL.height).toBe(0.5);
  });

  it('scanHoyaTopRightQuadrantCandidates + remap：子图蓝色块 → 整页坐标位于右上四分之一', () => {
    const qW = 120;
    const qH = 140;
    const quad = createTestImageData(qW, qH);
    for (let i = 0; i < quad.data.length; i += 4) {
      quad.data[i] = 252;
      quad.data[i + 1] = 252;
      quad.data[i + 2] = 250;
      quad.data[i + 3] = 255;
    }
    for (let y = 20; y < 90; y++) {
      for (let x = 60; x < 96; x++) {
        const o = (y * qW + x) * 4;
        quad.data[o] = 40;
        quad.data[o + 1] = 90;
        quad.data[o + 2] = 180;
        quad.data[o + 3] = 255;
      }
    }
    const [best] = scanHoyaTopRightQuadrantCandidates(quad, {
      cellPx: 4,
      minAreaFrac: 0.0005,
    });
    expect(best).toBeDefined();
    const full = remapQuadrantCandidateToFullPage(best as PhysicalTabScanCandidate);
    expect(full.hOffsetPercent).toBeGreaterThan(50);
    expect(full.hOffsetPercent).toBeLessThan(100);
    expect(full.vOffsetPercent).toBeGreaterThan(0);
    expect(full.vOffsetPercent).toBeLessThan(50);
    expect(full.bboxNorm.x).toBeGreaterThanOrEqual(0.5);
    expect(full.bboxNorm.y).toBeLessThan(0.5);
  });
});

describe('HOYA 模糊文案对齐', () => {
  it('新明锐 N3 / N5 / 带括号英文：均规范化为「新明锐」', () => {
    expect(matchHoyaSeriesFromColorBlockText('新明锐 N3')?.canonicalLabel).toBe('新明锐');
    expect(matchHoyaSeriesFromColorBlockText('新明銳 N5')?.canonicalLabel).toBe('新明锐');
    expect(matchHoyaSeriesFromColorBlockText('新明锐 (MiyoHD Pro)')?.canonicalLabel).toBe('新明锐');
    expect(matchHoyaSeriesFromColorBlockText('新明 锐 Pro')?.canonicalLabel).toBe('新明锐');
  });

  it('新乐学 / Eyvia / Eyas2 / 智御 匹配 fromMenuId', () => {
    expect(matchHoyaSeriesFromColorBlockText('新乐学')?.fromMenuId).toBe('p:新乐学');
    expect(matchHoyaSeriesFromColorBlockText('Eyvia 单光')?.fromMenuId).toBe('p:Eyvia单光');
    expect(matchHoyaSeriesFromColorBlockText('Eyas II')?.fromMenuId).toBe('p:Eyas2单光');
    expect(matchHoyaSeriesFromColorBlockText('智 御 中近')?.fromMenuId).toBe('p:豪雅智御中近');
  });

  it('hoyaSeriesEntryFromColorBlockOcr：吐出动态 v/h + physicalTabLabel=新明锐', () => {
    const cand: PhysicalTabScanCandidate = {
      band: 'full',
      centerXPercent: 73,
      centerYPercent: 18,
      vOffsetPercent: 18,
      hOffsetPercent: 73,
      bboxNorm: { x: 0.68, y: 0.14, w: 0.1, h: 0.08 },
      contrastScore: 120,
      verticalTextBoost: 1,
      verticalStrokeVariance: 600,
      colorBlockScore: 0.42,
      combinedScore: 12.3,
    };
    const entry = hoyaSeriesEntryFromColorBlockOcr({
      pdfPage: 9,
      ocrText: '新明锐 N3',
      candidate: cand,
    });
    expect(entry).not.toBeNull();
    expect(entry!.physicalTabLabel).toBe('新明锐');
    expect(entry!.pageKind).toBe('series_entry');
    expect(entry!.physicalTabVerified).toBe(true);
    expect(entry!.vOffsetPercent).toBe(18);
    expect(entry!.hOffsetPercent).toBe(73);
    expect(entry!.aliasKey).toBe('hoya_xinmingrui');
  });
});

describe('getPageData：无缓存（每次重算 → 引用不复用）', () => {
  it('同一 pdfPage 两次调用应返回**新**对象（无 identity 复用）', () => {
    const a = getPageData(8, 'hoya');
    const b = getPageData(8, 'hoya');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    expect(a?.vOffsetPercent).toBe(b?.vOffsetPercent);
    expect(a?.hOffsetPercent).toBe(b?.hOffsetPercent);
  });
});

describe('buildZeissPhysicalTabNavItems', () => {
  it('仅 physicalTabVerified 的 series_entry 入栏，startPage0 与 pdf 绝对一致', () => {
    const pages = [
      {
        pdfPage: 10,
        printedPage: null,
        section: 'smartlife-series-opening',
        title: '智锐系列扉页',
        pageKind: 'series_entry',
        physicalTabVerified: true,
        physicalTabLabel: '智锐',
        vOffsetPercent: 33,
        hOffsetPercent: 91,
        seriesAliasKey: 'zeiss_smartlife',
      },
      {
        pdfPage: 11,
        printedPage: null,
        section: 'smartlife-series-opening',
        title: '未验证不得入栏',
        pageKind: 'series_entry',
        physicalTabVerified: false,
        physicalTabLabel: '假',
      },
    ] as const satisfies readonly HandbookPageEntry[];
    const nav = buildZeissPhysicalTabNavItems([...pages]);
    expect(nav).toHaveLength(1);
    expect(nav[0]!.id).toBe('tab:10');
    expect(nav[0]!.label).toBe('智锐');
    expect(nav[0]!.startPage0).toBe(9);
    expect(nav[0]!.physicalTabVerified).toBe(true);
    expect(nav[0]!.physicalTabLabel).toBe('智锐');
    expect(nav[0]!.vOffsetPercent).toBe(33);
    expect(nav[0]!.hOffsetPercent).toBe(91);
  });

  it('已验证但缺少 physicalTabLabel 的 series_entry 不得入栏', () => {
    const pages = [
      {
        pdfPage: 7,
        printedPage: null,
        section: 'coating',
        title: '某页',
        pageKind: 'series_entry',
        physicalTabVerified: true,
      },
    ] as const satisfies readonly HandbookPageEntry[];
    expect(buildZeissPhysicalTabNavItems([...pages])).toHaveLength(0);
  });
});

describe('hoyaPhysicalTabScanParams', () => {
  it('HOYA 菜单 id 与系列色先验表一致', () => {
    expect(HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID['p:新乐学']).toBe('orange');
    expect(HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID['p:新明锐']).toBe('blue');
  });
});

describe('handbookMarketingPage', () => {
  it('成立180周年且无价目信号 → MarketingPage', () => {
    const m = assessHandbookMarketingIndexMeta('蔡司成立180周年 全球领先 创新 愿景 历史');
    expect(m.isMarketingPage).toBe(true);
    expect(m.quickNavWeight).toBeLessThan(0.5);
  });

  it('含折射率与价格 → 非宣傳主导', () => {
    const m = assessHandbookMarketingIndexMeta('智锐单光 折射率 1.67 价格 ￥2880');
    expect(m.isMarketingPage).toBe(false);
    expect(m.quickNavWeight).toBe(1);
  });
});
