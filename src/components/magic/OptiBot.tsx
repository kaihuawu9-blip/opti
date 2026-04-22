'use client';

import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { resolveClientApiOriginForBrowser } from '@/lib/optiAiPublic';
import { playOptiEdgeTts, speakWithBrowserFallback } from '@/lib/optiEdgeTtsPlayer';
import { getStorePublicConfigSync, subscribeStorePublicConfig } from '@/lib/storeDisplayName';
import { toChineseErrorMessage } from '@/lib/userMessages';

const LS_USER_NAME = 'opti-bot-user-display-name-v1';
const LS_ONBOARDING_DONE = 'opti-bot-onboarding-complete-v1';

type AgentPhase = 'idle' | 'thinking' | 'speaking';
const CHAT_TIMEOUT_MS = 35_000;

function readLs(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(key);
    return v != null && v !== '' ? v : null;
  } catch {
    return null;
  }
}

function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function resolveDisplayName(): string {
  const user = readLs(LS_USER_NAME)?.trim();
  if (user) return user;
  const fromCfg = getStorePublicConfigSync().agentCustomName?.trim();
  if (fromCfg) return fromCfg;
  return 'Opti-Bot';
}

async function sendOptiBotChat(args: {
  message: string;
  userTag: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const clientToken = (process.env.NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN || '').trim();
  if (!clientToken) {
    return { ok: false, error: '未配置 NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN，无法调用豆包链路' };
  }
  const apiUrl = `${resolveClientApiOriginForBrowser()}/api/ai/chat/`;
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), CHAT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken,
        'X-Requested-With': 'Opti-Bot',
      },
      body: JSON.stringify({
        message: args.message,
        userTag: args.userTag,
        mode: 'business' as const,
        history: args.history
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content }))
          .filter((m) => m.content.trim()),
      }),
      signal: timeout.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: '网络超时：我和云端握手 35 秒仍无回应' };
    }
    return { ok: false, error: '网络中断：我刚发出的电波被宇宙静电截胡了' };
  } finally {
    window.clearTimeout(timer);
  }
  const raw = await resp.text();
  let data: { answer?: string; error?: string } = {};
  try {
    data = raw ? (JSON.parse(raw) as { answer?: string; error?: string }) : {};
  } catch {
    return { ok: false, error: 'AI 接口返回非 JSON' };
  }
  if (!resp.ok) {
    return { ok: false, error: data.error || `HTTP ${resp.status}` };
  }
  const answer = (data.answer || '').trim();
  if (!answer) return { ok: false, error: 'AI 返回空内容' };
  return { ok: true, answer };
}

function buildHumorFallback(err: string): string {
  const msg = toChineseErrorMessage(err);
  if (/未登录|鉴权|401/u.test(msg)) {
    return `小插曲：我刚才去敲后端大门，结果门卫说“请先登录再通行”。先重新登录一下，我就能继续开讲了。`;
  }
  if (/网络|超时|断开|fetch|连接/u.test(msg)) {
    return `网络像去喝奶茶了，我喊了三遍“回来干活”还没回。先稍等几秒再试，我会继续用云泽声线营业。`;
  }
  return `我这边短暂打了个喷嚏：${msg}。别慌，我缓口气马上继续。`;
}

type OptiBotProps = {
  className?: string;
  userTag: string;
};

export default function OptiBot({ className = '', userTag }: OptiBotProps) {
  const filterUid = useId().replace(/:/g, '');
  const ttsAbortRef = useRef<AbortController | null>(null);
  /** 双眼整体缩放，1 为常态；朗读时随音量抬升 */
  const eyeEnergy = useMotionValue(1);
  const eyeScale = useSpring(eyeEnergy, { stiffness: 420, damping: 28, mass: 0.35 });

  const [mounted, setMounted] = useState(false);
  const [displayName, setDisplayName] = useState('Opti-Bot');
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingName, setOnboardingName] = useState('');
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [sending, setSending] = useState(false);

  const refreshName = useCallback(() => {
    setDisplayName(resolveDisplayName());
  }, []);

  useEffect(() => {
    setMounted(true);
    refreshName();
    const done = readLs(LS_ONBOARDING_DONE);
    if (!done) {
      const suggestion = getStorePublicConfigSync().agentCustomName?.trim() || 'Opti-Bot';
      setOnboardingName(suggestion);
      setOnboardingOpen(true);
    }
  }, [refreshName]);

  useEffect(() => {
    return subscribeStorePublicConfig(() => {
      refreshName();
    });
  }, [refreshName]);

  useEffect(() => {
    return () => {
      ttsAbortRef.current?.abort();
    };
  }, []);

  /** 收银台等内嵌页通过 `dispatchEvent(new CustomEvent('opti-bot:open'))` 唤起同一实例 */
  useEffect(() => {
    const onOpen = () => {
      setBubbleOpen((wasOpen) => {
        if (!wasOpen) {
          const greet = `你好，我是 ${resolveDisplayName()}。点下方输入问题，我会通过门店已配置的豆包 AI 链路为你解答（需环境令牌）。`;
          setMessages((prev) => (prev.length ? prev : [{ role: 'assistant', content: greet }]));
        }
        return true;
      });
    };
    window.addEventListener('opti-bot:open', onOpen as EventListener);
    return () => window.removeEventListener('opti-bot:open', onOpen as EventListener);
  }, []);

  useEffect(() => {
    if (!bubbleOpen) {
      ttsAbortRef.current?.abort();
      eyeEnergy.set(1);
    }
  }, [bubbleOpen, eyeEnergy]);

  const finishOnboarding = useCallback(() => {
    const name = onboardingName.trim() || resolveDisplayName();
    writeLs(LS_USER_NAME, name);
    writeLs(LS_ONBOARDING_DONE, '1');
    setOnboardingOpen(false);
    refreshName();
  }, [onboardingName, refreshName]);

  const toggleBubble = useCallback(() => {
    setBubbleOpen((open) => {
      const next = !open;
      if (next) {
        const greet = `你好，我是 ${resolveDisplayName()}。点下方输入问题，我会通过门店已配置的豆包 AI 链路为你解答（需环境令牌）。`;
        setMessages((prev) => (prev.length ? prev : [{ role: 'assistant', content: greet }]));
      }
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    let historySnapshot: { role: 'user' | 'assistant'; content: string }[] = [];
    setMessages((prev) => {
      historySnapshot = [...prev, { role: 'user', content: text }];
      return historySnapshot;
    });
    setInput('');
    setSending(true);
    setPhase('thinking');
    try {
      const r = await sendOptiBotChat({
        message: text,
        userTag,
        history: historySnapshot,
      });
      if (!r.ok) {
        setPhase('idle');
        const fallback = buildHumorFallback(r.error);
        setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
        try {
          await speakWithBrowserFallback(fallback);
        } catch {
          // no-op
        }
        return;
      }
      setPhase('speaking');
      setMessages((prev) => [...prev, { role: 'assistant', content: r.answer }]);

      ttsAbortRef.current?.abort();
      const ac = new AbortController();
      ttsAbortRef.current = ac;
      try {
        await playOptiEdgeTts(r.answer, {
          signal: ac.signal,
          onLevel: (v) => {
            eyeEnergy.set(1 + v * 0.62);
          },
        });
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          const fallback = '我本来想用云泽声线朗读，但麦克风刚好摸鱼了。你先看文字版，我马上修好它。';
          await speakWithBrowserFallback(fallback, ac.signal).catch(() => {});
        }
      } finally {
        eyeEnergy.set(1);
        ttsAbortRef.current = null;
        setPhase('idle');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase('idle');
      const fallback = buildHumorFallback(msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }]);
      await speakWithBrowserFallback(fallback).catch(() => {});
    } finally {
      setSending(false);
    }
  }, [eyeEnergy, input, sending, userTag]);

  if (!mounted) return null;

  const thinking = phase === 'thinking';
  const speaking = phase === 'speaking';

  return (
    <>
      {/* 全屏引导：z 低于 AppModal (z-[60]) */}
      <AnimatePresence>
        {onboardingOpen ? (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[58] flex items-center justify-center bg-black/55 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Opti-Bot 欢迎引导"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            >
              <div className="border-b border-gray-100 bg-gradient-to-br from-slate-50 to-white px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-900">欢迎加入镜售工作台</h2>
                <p className="mt-1 text-sm text-gray-600">
                  为你的全局 AI 助手取个名字吧。也可使用门店在 store_config 中配置的默认名称。
                </p>
              </div>
              <div className="space-y-4 px-5 py-5">
                <label className="block text-xs font-medium text-gray-500">助手显示名</label>
                <input
                  value={onboardingName}
                  onChange={(e) => setOnboardingName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm text-gray-900 outline-none ring-0 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="例如：小镜、Opti-Bot"
                  maxLength={32}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      writeLs(LS_ONBOARDING_DONE, '1');
                      setOnboardingOpen(false);
                    }}
                  >
                    稍后再说
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    onClick={() => finishOnboarding()}
                  >
                    完成
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={`pointer-events-none ${className}`}>
        <div className="pointer-events-auto relative z-[53]">
          <motion.div
            className="relative"
            animate={{
              y: [0, -10, 0],
              scale: [1, 1.04, 1],
            }}
            transition={{
              duration: 3.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <motion.div
              animate={
                speaking
                  ? { x: [0, -1.2, 1.2, -0.8, 0.8, 0] }
                  : { x: 0 }
              }
              transition={
                speaking
                  ? { duration: 0.32, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.2 }
              }
            >
              <button
                type="button"
                onClick={toggleBubble}
                className="relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400/80"
                style={{
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow:
                    '0 0 0 1px rgba(255,255,255,0.65), 0 12px 40px rgba(59,130,246,0.18), 0 4px 18px rgba(15,23,42,0.12)',
                }}
                aria-label={`打开 ${displayName} 助手`}
                title={displayName}
              >
                {/* 磨砂球体 */}
                <div
                  className="absolute inset-[2px] rounded-full bg-gradient-to-br from-slate-100 via-slate-200 to-slate-300"
                  style={{
                    boxShadow: 'inset 0 -8px 18px rgba(15,23,42,0.08), inset 0 4px 12px rgba(255,255,255,0.85)',
                  }}
                />
                {/* 面部深色半透明区 */}
                <div className="absolute inset-[18%] rounded-full bg-slate-900/55 backdrop-blur-[6px]" />
                {/* 发光眼镜框 */}
                <svg
                  className="relative z-[2] h-[38%] w-[62%]"
                  viewBox="0 0 120 48"
                  fill="none"
                  aria-hidden
                >
                  <defs>
                    <filter id={`opti-glow-${filterUid}`} x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.2" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <rect
                    x="4"
                    y="10"
                    width="48"
                    height="28"
                    rx="10"
                    stroke="rgba(56,189,248,0.95)"
                    strokeWidth="2.2"
                    filter={`url(#opti-glow-${filterUid})`}
                  />
                  <rect
                    x="68"
                    y="10"
                    width="48"
                    height="28"
                    rx="10"
                    stroke="rgba(56,189,248,0.95)"
                    strokeWidth="2.2"
                    filter={`url(#opti-glow-${filterUid})`}
                  />
                  <path
                    d="M52 24 H68"
                    stroke="rgba(125,211,252,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    filter={`url(#opti-glow-${filterUid})`}
                  />
                </svg>
                {/* 双眼粒子：思考时旋转；朗读时随 Edge TTS 音量缩放律动 */}
                <motion.div
                  className="pointer-events-none absolute inset-0 z-[3] flex origin-center items-center justify-center gap-[1.15rem] pt-[0.35rem]"
                  style={{ scale: eyeScale }}
                >
                  <motion.div
                    animate={thinking ? { rotate: 360 } : { rotate: 0 }}
                    transition={thinking ? { repeat: Infinity, duration: 1.05, ease: 'linear' } : { duration: 0.2 }}
                    className="flex items-center justify-center gap-[1.15rem]"
                  >
                    <div className="h-1.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.95)]" />
                    <div className="h-1.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.95)]" />
                  </motion.div>
                </motion.div>
              </button>

              <AnimatePresence>
                {bubbleOpen ? (
                  <motion.div
                    key="bubble"
                    initial={{ opacity: 0, scale: 0.92, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 4 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-[54] w-[min(18rem,calc(100vw-2rem))] max-h-[min(70vh,420px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                    role="dialog"
                    aria-label={`${displayName} 对话`}
                  >
                    <div className="border-b border-gray-100 bg-white/95 px-3 py-2 backdrop-blur-md">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{displayName}</div>
                          <div className="text-[10px] text-gray-500">
                            豆包对话 + Edge TTS（云泽）朗读；需已登录本机账号
                          </div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                          onClick={() => setBubbleOpen(false)}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[240px] min-h-[120px] space-y-2 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs leading-relaxed">
                      {messages.map((m, i) => (
                        <div
                          key={i}
                          className={`rounded-xl px-2.5 py-2 ${
                            m.role === 'user' ? 'ml-6 bg-blue-50 text-gray-900' : 'mr-4 bg-slate-50 text-gray-800'
                          }`}
                        >
                          {m.content}
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-gray-100 p-2 space-y-2">
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-xl border border-gray-200 px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        placeholder="输入问题…（预留：语音入口见下方按钮）"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled
                          className="flex-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-400"
                          title="语音输入（ASR）仍预留；AI 回复后会自动 Edge TTS 朗读"
                        >
                          语音输入（预留）
                        </button>
                        <button
                          type="button"
                          disabled={sending}
                          onClick={() => void handleSend()}
                          className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {sending ? '思考中…' : '发送'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
