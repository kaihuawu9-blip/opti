/**
 * 无效页 / 品牌宣傳页 — 自動索引與快速翻閱權重
 *
 * 與靜態 `HandbookPageEntry.quickNavWeight` 疊加使用：OCR 管線可將本函數結果寫回 runtime。
 */

const ANNIVERSARY_RE = /1846|成立180[週周]年|成立180周年/;

const PRICE_OR_INDEX_RE =
  /价格|价目|折射率|零售价|建议|¥|￥|RMB|1\.50|1\.56|1\.59|1\.60|1\.6(?![0-9])|1\.67|1\.71|1\.74|1\.8/;

const BRAND_BUZZ = [
  '全球',
  '领先',
  '创新',
  '解决方案',
  '愿景',
  '历史',
  '科技',
  '品牌',
  '信赖',
  '品质',
  '卓越',
  '始于',
  '周年',
] as const;

export type HandbookMarketingIndexMeta = {
  isMarketingPage: boolean;
  /** 快速翻閱模式權重：越小越容易被「跳過」或縮短停留 */
  quickNavWeight: number;
  reasons: string[];
};

/**
 * 合併標題 + OCR 片段；用於離線索引入庫或運行時補強。
 */
export function assessHandbookMarketingIndexMeta(combinedText: string): HandbookMarketingIndexMeta {
  const t = combinedText.replace(/\s+/g, ' ').trim();
  if (!t) {
    return { isMarketingPage: false, quickNavWeight: 1, reasons: [] };
  }
  const reasons: string[] = [];
  const hasAnniversary = ANNIVERSARY_RE.test(t);
  if (hasAnniversary) reasons.push('anniversary-or-180');

  const buzzHits = BRAND_BUZZ.filter((w) => t.includes(w)).length;
  if (buzzHits >= 3) reasons.push(`brand-buzz:${buzzHits}`);

  const hasPriceSignals = PRICE_OR_INDEX_RE.test(t);
  if (!hasPriceSignals) reasons.push('no-price-index-signals');

  const heavyBuzzNoPrice = buzzHits >= 4 && !hasPriceSignals;
  const isMarketingPage =
    hasAnniversary || heavyBuzzNoPrice || (buzzHits >= 5 && !hasPriceSignals);

  let quickNavWeight = 1;
  if (isMarketingPage) quickNavWeight = 0.22;
  else if (hasAnniversary && hasPriceSignals) quickNavWeight = 0.82;
  else if (!hasPriceSignals && buzzHits >= 3) quickNavWeight = 0.45;

  return { isMarketingPage, quickNavWeight, reasons };
}
