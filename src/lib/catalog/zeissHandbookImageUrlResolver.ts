/**
 * MATRIX_PROTOCOL_V1 — 物理路径对齐 (Strict Path Mapping)
 *
 * pdfIndex 为 1-based 与 PDF/价目表一致。优先尝试与物理文件强绑定的根路径
 *   `/catalog/zeiss-handbook/{n}.jpg` / `.jpeg`
 * 再回退到 `pages/page_###.*` 及 manifest 返回的历史路径，避免单一后缀 404
 * 导致 3D 书页整页灰色占位。
 *
 * 所有候选 URL 均经 ZeissHandbookPage 的 <img> 按序 onError 嗅探，直到命中或全部失败。
 */

const BASE = '/catalog/zeiss-handbook';

function pushUnique(out: string[], u: string | null | undefined) {
  if (u && !out.includes(u)) out.push(u);
}

/**
 * 返回按优先级排序的候 URL 列表（可能 3～8 个）；首个为「黄金路径」`{n}.jpg` / `{n}.jpeg`。
 */
export function zeissHandbookImageCandidates(
  pdfIndex1: number,
  manifestImageUrl?: string | null,
): string[] {
  const n = Math.max(1, Math.floor(pdfIndex1));
  const pad3 = String(n).padStart(3, '0');
  const out: string[] = [];

  // 1) 根目录强绑定（与需求一致：/catalog/zeiss-handbook/21.jpg）
  pushUnique(out, `${BASE}/${n}.jpg`);
  pushUnique(out, `${BASE}/${n}.jpeg`);
  // 1b) 常见等价格式
  pushUnique(out, `${BASE}/${n}.png`);
  pushUnique(out, `${BASE}/${n}.webp`);
  // 2) 导出脚本常用 pages/ 下命名
  pushUnique(out, `${BASE}/pages/page_${pad3}.png`);
  pushUnique(out, `${BASE}/pages/page_${pad3}.jpg`);
  pushUnique(out, `${BASE}/pages/page_${pad3}.jpeg`);
  pushUnique(out, `${BASE}/pages/page_${n}.png`);
  pushUnique(out, `${BASE}/pages/page_${n}.jpg`);
  // 3) API manifest 中解析到的历史路径（最后兜底，不破坏已有部署）
  pushUnique(out, manifestImageUrl ?? null);

  return out.filter(Boolean);
}
