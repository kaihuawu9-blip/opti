/**
 * Paddle 会框到镜架刻字、背景广告等，与验光数字无关；送 AI 前应剔除，减少「有字但解不出度」的假象。
 */

const RX_LINE_KEYWORD =
  /球镜|柱镜|散光|轴位|轴向|轴线|近视|远视|ADD|瞳距|瞳|OD|OS|右眼|左眼|视力|矫正|SPH|CYL|AXIS|平光|验光|处方|远用|近用|R\s*[:：]|L\s*[:：]|\bVA\b|mm|D\s*S|D\s*C/i;

/** 行内出现阿拉伯/全角数字、或验光表头类词，才视为有效 */
export function ocrLineLooksPrescriptionRelated(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (/[0-9０-９]/.test(s)) return true;
  if (RX_LINE_KEYWORD.test(s)) return true;
  if (/[＋+－-]\s*[\d.．]/.test(s)) return true;
  if (/[.:：]\s*[-+＋-]?\s*[\d.．]/.test(s)) return true;
  return false;
}

export type PrescriptionOcrPick = {
  /** 给模型用的合并字串 */
  forModel: string;
  /** 与 forModel 同；用于回显 rawText，避免把镜架杂讯当「取字」 */
  forUserPreview: string;
  /** 被丢弃的碎片行数 */
  droppedCount: number;
  /** 原始合并（调试用，可不返回给前端） */
  joinedAll: string;
};

/**
 * 从 Paddle `data[]` 里筛出像验光的一行再合并；`joinedAll` 为未过滤前全文。
 */
export function pickPrescriptionOcrText(lines: { text: string }[]): PrescriptionOcrPick {
  const allParts: string[] = [];
  const kept: string[] = [];
  let dropped = 0;
  for (const li of lines) {
    const t = (li.text || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    allParts.push(t);
    if (ocrLineLooksPrescriptionRelated(t)) kept.push(t);
    else dropped += 1;
  }
  const joinedAll = allParts.join(' ').trim();
  const forModel = kept.join(' ').trim();
  return {
    forModel,
    forUserPreview: forModel,
    droppedCount: dropped,
    joinedAll,
  };
}
