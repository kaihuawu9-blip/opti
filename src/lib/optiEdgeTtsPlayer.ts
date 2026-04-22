'use client';

import { resolveClientApiOriginForBrowser } from '@/lib/optiAiPublic';

/** 与 next.config 中 trailingSlash 一致 */
const TTS_PATH = '/api/tts/edge/';

export const OPTI_EDGE_TTS_VOICE = 'zh-CN-YunzeNeural';
const CHAT_CLIENT_TOKEN = (process.env.NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN || '').trim();

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function readAllBody(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concatChunks(parts);
}

function runLevelLoop(analyser: AnalyserNode, onLevel: (v: number) => void, isDone: () => boolean): () => void {
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    if (isDone()) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    const i0 = 2;
    const i1 = Math.min(56, data.length);
    for (let i = i0; i < i1; i++) sum += data[i] ?? 0;
    const n = (i1 - i0) * 255;
    onLevel(n > 0 ? Math.min(1, sum / n) : 0);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * 拉取 Edge TTS（服务端已流式转发），整段解码后播放，并用 Analyser 输出音量包络（0~1）供视觉律动。
 */
export async function playOptiEdgeTts(
  text: string,
  opts: {
    onLevel: (level01: number) => void;
    signal?: AbortSignal;
    voice?: string;
  },
): Promise<void> {
  const voice = (opts.voice || OPTI_EDGE_TTS_VOICE).trim();
  const ttsUrl = `${resolveClientApiOriginForBrowser()}${TTS_PATH}`;
  const res = await fetch(ttsUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'x-client-token': CHAT_CLIENT_TOKEN,
      'X-Requested-With': 'Opti-Bot',
    },
    body: JSON.stringify({ text, voice }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    try {
      const j = JSON.parse(raw) as { error?: string };
      throw new Error(j.error || raw || `HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.message) throw e;
      throw new Error(raw || `HTTP ${res.status}`);
    }
  }

  if (!res.body) throw new Error('无音频流');

  const buf = await readAllBody(res.body as ReadableStream<Uint8Array>, opts.signal);
  if (buf.length < 64) throw new Error('音频数据过短');

  const ctx = new AudioContext();
  await ctx.resume();

  let decoded: AudioBuffer;
  try {
    const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    decoded = await ctx.decodeAudioData(copy);
  } catch {
    await ctx.close();
    await playMp3BlobFallback(buf, opts.onLevel, opts.signal);
    return;
  }

  const src = ctx.createBufferSource();
  src.buffer = decoded;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  src.connect(gain);
  gain.connect(analyser);
  analyser.connect(ctx.destination);

  let ended = false;
  const stopLevel = runLevelLoop(
    analyser,
    (v) => opts.onLevel(v),
    () => ended,
  );

  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        src.onended = () => resolve();
        try {
          src.start(0);
        } catch (e) {
          reject(e);
        }
      }),
      new Promise<void>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(), { once: true });
      }),
    ]);
  } finally {
    ended = true;
    stopLevel();
    opts.onLevel(0);
    try {
      src.stop();
    } catch {
      // ignore
    }
    try {
      src.disconnect();
    } catch {
      // ignore
    }
    await ctx.close().catch(() => {});
  }
}

/**
 * 网络失败时的兜底：优先尝试浏览器可用的中文语音，并优先匹配 “Yunze” 命名。
 * 该路径不依赖后端，避免断网时再次触发请求失败。
 */
export async function speakWithBrowserFallback(text: string, signal?: AbortSignal): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const line = String(text || '').trim();
  if (!line) return;
  synth.cancel();

  const pickVoice = (): SpeechSynthesisVoice | null => {
    const voices = synth.getVoices();
    if (!voices.length) return null;
    const yunze = voices.find((v) => /yunze/iu.test(v.name));
    if (yunze) return yunze;
    const zh = voices.find((v) => /zh(-|_)?cn/iu.test(v.lang) || /中文|普通话/u.test(v.name));
    return zh || voices[0] || null;
  };

  await new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(line);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.lang = 'zh-CN';
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    if (signal) {
      const onAbort = () => {
        synth.cancel();
        resolve();
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    synth.speak(utter);
  });
}

/** decodeAudioData 失败时（少见编码）回退到 <audio> + Analyser */
async function playMp3BlobFallback(
  buf: Uint8Array,
  onLevel: (v: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = document.createElement('audio');
  audio.src = url;
  audio.playsInline = true;

  const ctx = new AudioContext();
  await ctx.resume();
  const ms = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  ms.connect(analyser);
  analyser.connect(ctx.destination);

  let ended = false;
  const stopLevel = runLevelLoop(analyser, onLevel, () => ended);

  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(audio.error || new Error('audio'));
      if (signal) {
        const onAbort = () => {
          audio.pause();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      void audio.play().catch(reject);
    });
  } finally {
    ended = true;
    stopLevel();
    onLevel(0);
    URL.revokeObjectURL(url);
    await ctx.close();
  }
}
