'use client';

let lastRustleAt = 0;

/**
 * 极短「纸张摩擦」感（Web Audio），失败时静默；连续翻页防抖。
 */
export function playHandbookPaperRustle(): void {
  if (typeof window === 'undefined') return;
  const now = performance.now();
  if (now - lastRustleAt < 160) return;
  lastRustleAt = now;

  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;

  try {
    const ctx = new AC();
    const dur = 0.055;
    const sampleRate = ctx.sampleRate;
    const n = Math.floor(sampleRate * dur);
    const buf = ctx.createBuffer(1, n, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = (1 - t) ** 2.2;
      ch[i] = (Math.random() * 2 - 1) * 0.12 * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    bp.gain.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 400);
  } catch {
    /* ignore */
  }
}
