import 'server-only';

import {
  DEFAULT_MAX_POLL_ATTEMPTS,
  DEFAULT_POLL_FAST_MS,
  DEFAULT_POLL_SLOW_MS,
  DEFAULT_POLL_TIER_AFTER_MS,
  computeTieredPollDelayMsFromElapsed,
} from '@/lib/modelTask/tieredPollDefaults';

/** 将环境变量解析为正整数；空、NaN、非有限或小于 1 时使用默认值。 */
function parseEnvPositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** 阶梯轮询：前段间隔（毫秒），环境变量 `POLL_INTERVAL`，默认 1500。 */
export function getPollTierFastMs(): number {
  return parseEnvPositiveNumber(process.env.POLL_INTERVAL, DEFAULT_POLL_FAST_MS);
}

/** 阶梯轮询：后段间隔（毫秒），环境变量 `POLL_INTERVAL_SLOW`，默认 3000。 */
export function getPollTierSlowMs(): number {
  return parseEnvPositiveNumber(process.env.POLL_INTERVAL_SLOW, DEFAULT_POLL_SLOW_MS);
}

/** 阶梯切换点：自轮询开始累计毫秒数，环境变量 `POLL_TIER_AFTER_MS`，默认 10000。 */
export function getPollTierAfterMs(): number {
  return parseEnvPositiveNumber(process.env.POLL_TIER_AFTER_MS, DEFAULT_POLL_TIER_AFTER_MS);
}

/** 最大轮询次数，环境变量 `MAX_POLL_ATTEMPTS`。 */
export function getMaxPollAttempts(): number {
  return parseEnvPositiveNumber(process.env.MAX_POLL_ATTEMPTS, DEFAULT_MAX_POLL_ATTEMPTS);
}

/** 根据已耗时计算下一次 sleep 毫秒数（服务端 `pollUntilComplete`）。 */
export function computeTieredPollDelayMs(elapsedMs: number): number {
  return computeTieredPollDelayMsFromElapsed(
    elapsedMs,
    getPollTierFastMs(),
    getPollTierSlowMs(),
    getPollTierAfterMs(),
  );
}
