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
