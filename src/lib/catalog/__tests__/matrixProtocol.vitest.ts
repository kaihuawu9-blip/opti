import { describe, expect, it } from 'vitest';
import { assertEssilorAliasMapsZeissSlots } from '@/data/essilorMatrixProtocolStub';
import {
  STRESS_FILENAME_CALIBRATION_SAMPLES,
  STRESS_TITLE_PRESET_SAMPLES,
} from '@/data/zeissMatrixProtocolStressSamples';
import { resolveActiveHandbookNavState } from '@/lib/catalog/dataIntegrityValidator';
import { pluginACalibrate } from '@/lib/catalog/indexAutoCalibrator';
import type { SchemaGapItem } from '@/lib/catalog/indexAutoCalibrator';
import type { HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import { MATRIX_BRAND_REGISTRY } from '@/data/matrixBrandRegistry';
import {
  buildHandbookSeriesNavItemsForBrand,
  getPageData,
  getHandbookPageCount,
} from '@/data/zeissHandbookPageMap';
import { ESSILOR_PRICE_MATRIX } from '@/data/essilorPriceMatrix';
import { HOYA_PRICE_MATRIX } from '@/data/hoyaPriceMatrix';
import hoyaHandbookMeta from '@/data/hoyaHandbookPageCount.json';
import { adaptOcrToOrderItemStrict } from '@/lib/api/dataAdapter';

describe('Matrix Protocol V1.1 — IndexAutoCalibrator (插件 A)', () => {
  it('L1：文件名 slug（含 A-Prog）锁定价目块', () => {
    for (const s of STRESS_FILENAME_CALIBRATION_SAMPLES) {
      const r = pluginACalibrate({
        pdfIndex1Based: s.pdfIndex1Based,
        pageTitle: null,
        ocrTextSnippet: null,
        assetFilename: s.assetFilename,
      });
      expect(r.matchScore.level, s.id).toBe(1);
      expect(r.correctedAnchor.productName, s.id).toBe(s.expectedProductName);
      expect(r.pdfIndex1Based, s.id).toBeGreaterThan(0);
    }
  });

  it('L2：标题预设（臻锐 / A 系列渐进）', () => {
    for (const s of STRESS_TITLE_PRESET_SAMPLES) {
      const r = pluginACalibrate({
        pdfIndex1Based: 1,
        pageTitle: s.pageTitle,
        ocrTextSnippet: null,
        assetFilename: null,
      });
      expect(r.matchScore.level, s.id).toBe(2);
      expect(r.correctedAnchor.productName ?? '', s.id).toContain(s.expectedProductContains);
      expect(r.pdfIndex1Based, s.id).toBeGreaterThan(0);
    }
  });
});

describe('Matrix Protocol V1.1 — 插件 B activeNav', () => {
  it('合成缺口 → warning + 数据待补全', () => {
    const syntheticNav: HandbookSeriesNavItem[] = [
      { id: 'p:PhantomLens', label: 'PhantomLens', section: 'price', startPage0: 5, printedPage: 1 },
      { id: 'p:智锐单光', label: '智锐单光', section: 'price', startPage0: 13, printedPage: 5 },
    ];
    const syntheticGaps: SchemaGapItem[] = [
      { kind: 'handbook_nav_product_missing_matrix', summary: 'smoke', productName: 'PhantomLens' },
    ];
    const navState = resolveActiveHandbookNavState(syntheticNav, 5, syntheticGaps);
    expect(navState.anchorId).toBe('p:PhantomLens');
    expect(navState.dataStatus).toBe('warning');
    expect(navState.placeholderMessage).toBe('数据待补全');
  });
});

describe('EssilorAliasMap ↔ 蔡司折射率槽位', () => {
  it('assertEssilorAliasMapsZeissSlots 不抛错', () => {
    expect(() => assertEssilorAliasMapsZeissSlots()).not.toThrow();
  });
});

describe('Matrix Protocol V1.2 — MATRIX_BRAND_REGISTRY', () => {
  it('登记蔡司、依视路、豪雅三条品牌链路', () => {
    const keys = MATRIX_BRAND_REGISTRY.map((b) => b.brandKey);
    expect(keys).toEqual(expect.arrayContaining(['ZEISS', 'ESSILOR', 'HOYA']));
  });
});

describe('Matrix Protocol V1.3 — Essilor 钻晶首批收割', () => {
  it('HANDBOOK 挂载后价目页与 JSON 品种一致', () => {
    expect(getHandbookPageCount('essilor')).toBeGreaterThan(0);
    const p2 = getPageData(2, 'essilor');
    expect(p2?.dataAnchor).toBe('钻晶A4单光');
    expect(p2?.product?.productName).toBe('钻晶A4单光');
    expect(ESSILOR_PRICE_MATRIX.some((p) => p.productName === '钻晶A4单光')).toBe(true);
  });

  it('数据海关 strict 命中依视路价目矩阵 SKU', () => {
    const r = adaptOcrToOrderItemStrict({
      ocr: {
        source: 'manual',
        fields: {
          BRAND: '依视路',
          SERIES: '钻晶A4单光',
          INDEX: 1.6,
          COATING: '钻晶A4膜',
          OD_SPH: -2,
          OD_CYL: 0,
          OD_AXIS: 90,
          OD_PD: 32,
          OS_SPH: -2,
          OS_CYL: 0,
          OS_AXIS: 90,
          OS_PD: 31,
        },
      },
    });
    expect(r.order.lens.brand).toBe('ESSILOR');
    expect(r.skuMatch?.retailYuan).toBe(988);
  });
});

describe('Matrix Protocol V1.3 — HOYA 豪雅专项', () => {
  it('页表 + 价目矩阵 + 插件 B（空蔡司 gaps）', () => {
    expect(getHandbookPageCount('hoya')).toBe(hoyaHandbookMeta.pages);
    const p2 = getPageData(2, 'hoya');
    expect(p2?.dataAnchor).toBeNull();
    expect(p2?.title).toMatch(/简介/);
    expect(p2?.imageUrl).toBe('/catalog/hoya/p2.jpg');
    const p8 = getPageData(8, 'hoya');
    expect(p8?.dataAnchor).toBe('新乐学');
    expect(p8?.product?.productName).toBe('新乐学');
    expect(p8?.imageUrl).toBe('/catalog/hoya/p8.jpg');
    const flat = p8?.product?.series?.flatMap((s) => s.rows) ?? [];
    expect(flat.some((r) => Number(r.retailYuan) === 3980)).toBe(true);
    expect(flat.some((r) => Number(r.retailYuan) === 4980)).toBe(true);
    expect(HOYA_PRICE_MATRIX.some((p) => p.productName === '新乐学')).toBe(true);
    const nav = buildHandbookSeriesNavItemsForBrand('hoya');
    for (const it of nav) {
      expect(it.label).not.toMatch(/智锐|睐光|蔡司镜架|智锐系列|单光延伸|内页 p/);
    }
    expect(nav.some((it) => it.id === 'p:豪雅智御中近')).toBe(true);
    const state = resolveActiveHandbookNavState(nav, 7, [], {
      matrixProducts: HOYA_PRICE_MATRIX,
    });
    expect(state.anchorId).toBe('p:新乐学');
    expect(state.dataStatus).toBe('validated');
    const stZ = resolveActiveHandbookNavState(nav, 26, [], {
      matrixProducts: HOYA_PRICE_MATRIX,
    });
    expect(stZ.anchorId).toBe('p:豪雅智御中近');
    expect(stZ.dataStatus).toBe('validated');
  });

  it('数据海关 strict 命中豪雅价目矩阵 SKU', () => {
    const r = adaptOcrToOrderItemStrict({
      ocr: {
        source: 'manual',
        fields: {
          BRAND: '豪雅',
          SERIES: '新乐学',
          INDEX: 1.6,
          COATING: '唯洁',
          OD_SPH: -2,
          OD_CYL: 0,
          OD_AXIS: 90,
          OD_PD: 32,
          OS_SPH: -2,
          OS_CYL: 0,
          OS_AXIS: 90,
          OS_PD: 31,
        },
      },
    });
    expect(r.order.lens.brand).toBe('HOYA');
    expect(r.skuMatch?.retailYuan).toBe(3980);
  });
});
