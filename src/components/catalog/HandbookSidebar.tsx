'use client';

/**
 * 数字化手册 · 右侧系列导航（Matrix V1.3 · 品牌隔离）
 *
 * 数据源必须由 `buildHandbookSeriesNavItemsForBrand(currentBrand)` 提供；
 * 豪雅等已注册 `HandbookBrandAdapter.buildSeriesNavigation` 的品牌禁止与其它品牌共用蔡司派生菜单。
 */
export { ZeissSeriesNavList as HandbookSidebar } from '@/components/catalog/ZeissSeriesNavList';
