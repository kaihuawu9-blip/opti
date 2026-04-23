import type { ZeissProductMatrix } from '@/data/zeissPriceMatrix';
import { ZEISS_MATRIX_SEARCH_ALIAS_RULES } from '@/data/zeissMatrixSeriesAliasMap';

/**
 * 收银/手册侧品种搜索：先字面匹配 productName，再走 AliasMap 规则扩展，
 * 避免用户输入「A系列」等俗称时零命中。
 */
export function matrixProductMatchesFuzzySearch(
  product: ZeissProductMatrix,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const pn = product.productName.toLowerCase();
  if (pn.includes(q)) return true;

  for (const rule of ZEISS_MATRIX_SEARCH_ALIAS_RULES) {
    const aliasHit = rule.aliases.some(
      (a) => q.includes(a.toLowerCase()) || a.toLowerCase().includes(q),
    );
    if (!aliasHit) continue;
    if (rule.productNameIncludes.some((s) => pn.includes(s.toLowerCase()))) {
      return true;
    }
  }
  return false;
}
