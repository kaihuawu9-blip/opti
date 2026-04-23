/**
 * Data-Integrity-Validator（插件 B）
 *
 * - 启动 / 进入手册时对比「侧栏导航 ↔ ZEISS_PRICE_MATRIX ↔ 手册页表」；
 * - 与 `runSchemaCompletenessScan()` 同源，额外提供 UI 用的 id 集合与弹窗版本号。
 */

import {
  runSchemaCompletenessScan,
  type SchemaGapItem,
  type SchemaGapKind,
} from '@/lib/catalog/indexAutoCalibrator';
import { ZEISS_PRICE_MATRIX } from '@/data/zeissPriceMatrix';
import {
  getActiveHandbookNavId,
  type HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';

/** 变更后 bump，已点「知道了」的用户会再次看到 Boss 提示 */
export const DATA_INTEGRITY_UI_ALERT_VERSION = '2026.04.24';

export const DATA_INTEGRITY_SESSION_KEY = 'opti.zeiss.handbook.dataIntegrity.dismissedVersion';

export function runDataIntegrityValidator(): readonly SchemaGapItem[] {
  return runSchemaCompletenessScan();
}

/** 侧栏 `p:产品名` 在矩阵中缺失 → 标红导航项 */
export function getNavIdsMissingMatrixJson(gaps: readonly SchemaGapItem[]): ReadonlySet<string> {
  const s = new Set<string>();
  for (const g of gaps) {
    if (g.kind === 'handbook_nav_product_missing_matrix' && g.productName) {
      s.add(`p:${g.productName}`);
    }
  }
  return s;
}

/** 当前物理页落在「有价目位/标题线索但无 JSON 矩阵」时顶栏飘红 */
export function getPdfPagesWithMissingMatrixData(gaps: readonly SchemaGapItem[]): ReadonlySet<number> {
  const s = new Set<number>();
  for (const g of gaps) {
    if (g.pdfPage == null) continue;
    if (
      g.kind === 'handbook_price_row_missing_product_anchor' ||
      g.kind === 'handbook_title_hint_without_matrix_anchor'
    ) {
      s.add(g.pdfPage);
    }
  }
  return s;
}

/** 侧栏 activeNav：经 AnchorID 反查 + 插件 B 可用性后的数据状态 */
export type HandbookNavDataStatus = 'validated' | 'warning' | 'pending';

export type HandbookActiveNavState = {
  /** 导航 AnchorID，如 `p:智锐单光` / `s:price` */
  anchorId: string;
  dataStatus: HandbookNavDataStatus;
  /** `dataStatus === 'warning'` 时供 UI 占位 */
  placeholderMessage?: string;
};

const PLACEHOLDER_DATA_PENDING = '数据待补全';

function matrixHasProductName(name: string): boolean {
  const t = name.trim();
  return ZEISS_PRICE_MATRIX.some((p) => p.productName.trim() === t);
}

/**
 * 状态自愈：先按物理页解析 AnchorID，再反查矩阵 / 插件 B 缺口。
 * - `p:` 必须在 `ZEISS_PRICE_MATRIX` 中存在且不在「导航缺矩阵」集合；
 * - `s:` 在当前物理页落在「价目/标题断层」页集合时标记 warning。
 */
export function resolveActiveHandbookNavState(
  items: readonly HandbookSeriesNavItem[],
  currentPage0: number,
  gaps: readonly SchemaGapItem[],
): HandbookActiveNavState {
  const anchorId = items.length === 0 ? '' : getActiveHandbookNavId(items, currentPage0);
  if (!anchorId) {
    return { anchorId: '', dataStatus: 'pending' };
  }

  const missingNav = getNavIdsMissingMatrixJson(gaps);
  const missingPages = getPdfPagesWithMissingMatrixData(gaps);
  const physicalPdf = currentPage0 + 1;

  if (anchorId.startsWith('p:')) {
    const productName = anchorId.slice(2).trim();
    if (!matrixHasProductName(productName) || missingNav.has(anchorId)) {
      return {
        anchorId,
        dataStatus: 'warning',
        placeholderMessage: PLACEHOLDER_DATA_PENDING,
      };
    }
    return { anchorId, dataStatus: 'validated' };
  }

  if (anchorId.startsWith('s:')) {
    if (missingPages.has(physicalPdf)) {
      return {
        anchorId,
        dataStatus: 'warning',
        placeholderMessage: PLACEHOLDER_DATA_PENDING,
      };
    }
    return { anchorId, dataStatus: 'validated' };
  }

  return { anchorId, dataStatus: 'pending' };
}

export function formatDataIntegrityBossSummary(gaps: readonly SchemaGapItem[]): string {
  if (gaps.length === 0) return '';
  const lines = gaps.slice(0, 12).map((g) => `· ${g.summary}`);
  const more = gaps.length > 12 ? `\n… 另有 ${gaps.length - 12} 条，详见控制台 Matrix Self-Check` : '';
  return `Boss，以下位置价目数据还没对齐或缺 JSON：\n${lines.join('\n')}${more}`;
}

export type { SchemaGapItem, SchemaGapKind };
