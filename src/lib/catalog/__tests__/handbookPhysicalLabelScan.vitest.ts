import { describe, expect, it } from 'vitest';
import {
  detectZeissSeriesAliasFromCornerOrVerticalText,
  PHYSICAL_LABEL_TOP_RIGHT_REGION,
  topRightRegionAsRelativeCrop,
} from '@/lib/catalog/handbookPhysicalLabelScan';
import { assessHandbookMarketingIndexMeta } from '@/lib/catalog/handbookMarketingPage';
import { HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID } from '@/lib/catalog/hoyaPhysicalTabScanParams';
import { buildZeissPhysicalTabNavItems } from '@/data/zeissHandbookPageMap';
import type { HandbookPageEntry } from '@/data/zeissHandbookPageMap';

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
    expect(HOYA_PHYSICAL_TAB_COLOR_BY_MENU_ID['p:Eyvia单光']).toBe('blue');
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
