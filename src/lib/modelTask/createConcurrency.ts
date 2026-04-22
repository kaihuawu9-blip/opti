import 'server-only';

/** 同时允许的「创建 3D 任务」请求数上限（仅内存、单进程有效）。 */
const DEFAULT_MAX_CONCURRENT = 2;

function getMaxConcurrentCreates(): number {
  const raw = process.env.HUNYUAN3D_MAX_CONCURRENT_CREATE;
  const n =
    raw === undefined || String(raw).trim() === ''
      ? DEFAULT_MAX_CONCURRENT
      : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CONCURRENT;
  return Math.min(20, n);
}

export class CreateConcurrencyBusyError extends Error {
  constructor(message = '当前建模任务较多，请稍后再试') {
    super(message);
    this.name = 'CreateConcurrencyBusyError';
  }
}

let activeCreates = 0;

export async function withHunyuan3dCreateSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = getMaxConcurrentCreates();
  if (activeCreates >= max) {
    throw new CreateConcurrencyBusyError();
  }
  activeCreates += 1;
  try {
    return await fn();
  } finally {
    activeCreates -= 1;
  }
}
