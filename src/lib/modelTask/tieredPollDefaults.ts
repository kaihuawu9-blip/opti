/**
 * 阶梯轮询与并发相关默认值（非敏感，客户端与 pollConfig 共用）。
 * 服务端实际间隔仍以环境变量为准，未设置时与此处一致。
 */
export const DEFAULT_POLL_FAST_MS = 1500;
export const DEFAULT_POLL_SLOW_MS = 3000;
export const DEFAULT_POLL_TIER_AFTER_MS = 10_000;
export const DEFAULT_MAX_POLL_ATTEMPTS = 36;

export function computeTieredPollDelayMsFromElapsed(
  elapsedMs: number,
  fastMs: number,
  slowMs: number,
  tierAfterMs: number,
): number {
  return elapsedMs < tierAfterMs ? fastMs : slowMs;
}
