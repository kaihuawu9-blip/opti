/**
 * MATRIX_PROTOCOL_V1 — 手册翻页图像预读
 *
 * 目的：page-flip 把非当前页置为 display:none，原生 loading="lazy" 常永不触发请求，
 * 导致手动跳页或首次进入时前若干页空白。使用本工具在「当前物理页」半径 N 内主动触发图像解码，
 * 并做 URL 级去重，避免重复请求与内存撑爆。
 *
 * 跨品牌：完全基于图片 URL 数组，与品牌无关（任何品牌的 manifest 都可直接传入）。
 */

const decoded = new Set<string>();

export interface PreloadOptions {
  /** 半径：默认 ±5 张 */
  radius?: number;
  /** 跨会话允许重新解码（例如低内存设备） */
  forceReload?: boolean;
}

/** 触发浏览器对单张图片的异步解码（不会阻塞主线程） */
function decodeOne(url: string | null | undefined, force = false): void {
  if (!url) return;
  if (!force && decoded.has(url)) return;
  decoded.add(url);
  if (typeof window === 'undefined') return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {
        /* 忽略：大多为 CORS / 404；onError 也无需处理 */
      });
    }
  } catch {
    /* noop */
  }
}

/**
 * 以 `currentPage0` 为圆心，半径 `radius` 预读前后各 N 张。
 * @param urls         全部页面的图片 URL（按 pdfIndex 顺序）
 * @param currentPage0 当前 0-based 页索引
 */
export function preloadAround(
  urls: readonly (string | null | undefined)[],
  currentPage0: number,
  options: PreloadOptions = {},
): void {
  const radius = Math.max(0, options.radius ?? 5);
  const force = Boolean(options.forceReload);
  if (!urls.length) return;
  const lo = Math.max(0, currentPage0 - radius);
  const hi = Math.min(urls.length - 1, currentPage0 + radius);
  // 就近顺序：先解码当前页，再扩散
  const order: number[] = [];
  for (let d = 0; d <= radius; d++) {
    const a = currentPage0 - d;
    const b = currentPage0 + d;
    if (a >= lo && !order.includes(a)) order.push(a);
    if (b <= hi && !order.includes(b)) order.push(b);
  }
  for (const i of order) decodeOne(urls[i], force);
}

/** 初始化首屏（封面 + 前若干页） */
export function preloadHead(
  urls: readonly (string | null | undefined)[],
  count = 12,
): void {
  for (let i = 0; i < Math.min(count, urls.length); i++) decodeOne(urls[i]);
}

/** 重置去重缓存（仅用于测试或切换品牌时避免跨书混用） */
export function resetPreloadCache(): void {
  decoded.clear();
}
