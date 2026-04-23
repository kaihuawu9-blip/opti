/**
 * 豪雅侧栏系列导航（Matrix V1.3 · 品牌隔离 + 语义化）
 *
 * 与蔡司侧栏数据源完全分离；菜单项与 `hoyaHandbookPageMap` 真机锚点一致。
 */

import type { HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';

/** 与侧栏 `startPage0`（0-based）同步的静态菜单（改锚点时一并修改） */
export const HOYA_SERIES_MENU = Object.freeze([
  {
    kind: 'section' as const,
    id: 's:hoya-intro',
    label: '品牌与简介（p1–p6）',
    pdfPage: 1,
    section: 'myopia-control-intro' as const,
  },
  {
    kind: 'product' as const,
    id: 'p:新乐学',
    label: '青少年近视管理 · 新乐学（MiyoSmart）',
    pdfPage: 8,
    section: 'price' as const,
  },
  {
    kind: 'product' as const,
    id: 'p:Eyvia单光',
    label: '单焦点系列 · Eyvia 1.74',
    pdfPage: 12,
    section: 'price' as const,
  },
  {
    kind: 'product' as const,
    id: 'p:Eynoa单光',
    label: '单焦点系列 · Eynoa 1.67',
    pdfPage: 16,
    section: 'price' as const,
  },
  {
    kind: 'product' as const,
    id: 'p:Eyas2单光',
    label: '单焦点系列 · Eyas 2.0 / 1.60',
    pdfPage: 20,
    section: 'price' as const,
  },
  {
    kind: 'product' as const,
    id: 'p:豪雅智御中近',
    label: '功能性系列 · 豪雅智御中近',
    pdfPage: 27,
    section: 'price' as const,
  },
  {
    kind: 'section' as const,
    id: 's:hoya-coating',
    label: '膜层与技术说明',
    pdfPage: 34,
    section: 'coating' as const,
  },
  {
    kind: 'section' as const,
    id: 's:hoya-lifestyle',
    label: '生活场景与功能性镜片',
    pdfPage: 42,
    section: 'driving-intro' as const,
  },
] as const);

export function buildHoyaSeriesNavigationItems(): HandbookSeriesNavItem[] {
  return HOYA_SERIES_MENU.map((m) => ({
    id: m.id,
    label: m.label,
    section: m.section,
    startPage0: m.pdfPage - 1,
    printedPage: null,
  })).sort((a, b) => a.startPage0 - b.startPage0);
}
