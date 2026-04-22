'use client';

import { useMemo, useState } from 'react';
import { Bot, Send, Shield } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { getOptiAiApiOrigin } from '@/lib/optiAiPublic';

type ChatItem = {
  role: 'user' | 'assistant';
  content: string;
};
type ChatMode = 'free' | 'business';

export default function AiEntryPage() {
  const { profile, session } = useAuth();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('free');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([
    { role: 'assistant', content: '你好，我是 AI 助手。当前为自由模式，你可以直接问任何问题。' },
  ]);

  const userTag = useMemo(() => {
    if (profile?.full_name?.trim()) return profile.full_name.trim();
    if (session?.user?.email) return session.user.email;
    return 'desktop-user';
  }, [profile?.full_name, session?.user?.email]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const localApiKey = (process.env.NEXT_PUBLIC_OPENAI_API_KEY || '').trim();
    const localBaseUrl = (process.env.NEXT_PUBLIC_OPENAI_BASE_URL || '').trim();
    const localModel = (process.env.NEXT_PUBLIC_OPENAI_MODEL || '').trim();

    const nextMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      if (window.electronAI?.chatStream) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
        await new Promise<void>((resolve) => {
          window.electronAI?.chatStream(
            {
              message: text,
              userTag,
              apiKey: localApiKey,
              baseUrl: localBaseUrl,
              model: localModel,
              mode,
              history: nextMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
            },
            (evt) => {
              if (evt.error) {
                window.alert('AI 请求失败：' + toChineseErrorMessage(evt.error));
                setMessages((prev) => {
                  const cp = [...prev];
                  const idx = cp.length - 1;
                  if (idx >= 0 && cp[idx].role === 'assistant' && cp[idx].content === '') cp.pop();
                  return cp;
                });
                resolve();
                return;
              }
              if (evt.delta) {
                setMessages((prev) => {
                  const cp = [...prev];
                  const idx = cp.length - 1;
                  if (idx >= 0 && cp[idx].role === 'assistant') {
                    cp[idx] = { ...cp[idx], content: (cp[idx].content || '') + evt.delta };
                  }
                  return cp;
                });
              }
              if (evt.done) {
                setMessages((prev) => {
                  const cp = [...prev];
                  const idx = cp.length - 1;
                  if (idx >= 0 && cp[idx].role === 'assistant' && !cp[idx].content.trim()) {
                    cp[idx] = { ...cp[idx], content: '抱歉，我暂时无法回答。' };
                  }
                  return cp;
                });
                resolve();
              }
            },
          );
        });
        return;
      }
      if (window.electronAI?.chat) {
        const r = await window.electronAI.chat({
          message: text,
          userTag,
          apiKey: localApiKey,
          baseUrl: localBaseUrl,
          model: localModel,
          mode,
          history: nextMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        });
        if (!r.ok) {
          window.alert('AI 请求失败：' + toChineseErrorMessage(r.error || '未知错误'));
          return;
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: r.answer || '抱歉，我暂时无法回答。' }]);
        return;
      }

      const configuredApi = (process.env.NEXT_PUBLIC_AI_CHAT_API_URL || '').trim();
      const clientToken = process.env.NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN || '';
      if (!clientToken) {
        window.alert('未配置 AI 客户端令牌：请在项目根 .env 配置 NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN');
        return;
      }
      const apiUrl = configuredApi || `${getOptiAiApiOrigin()}/api/ai/chat`;
      const runningInElectron = typeof window !== 'undefined' && window.location.protocol === 'app:';
      if (runningInElectron && apiUrl.startsWith('/')) {
        window.alert(
          '当前为桌面离线包，内置 /api 接口不可用。请在项目根 .env 配置 NEXT_PUBLIC_AI_CHAT_API_URL 为可访问的线上接口地址。',
        );
        return;
      }

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
        },
        body: JSON.stringify({
          message: text,
          userTag,
          mode,
          history: nextMessages
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content }))
            .filter((m) => m.content.trim()),
        }),
      });

      const raw = await resp.text();
      let data: { answer?: string; error?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as { answer?: string; error?: string }) : {};
      } catch {
        window.alert(
          'AI 接口返回了非 JSON 内容。请检查 NEXT_PUBLIC_AI_CHAT_API_URL 是否配置正确，且接口可访问。',
        );
        return;
      }
      if (!resp.ok) {
        window.alert('AI 请求失败：' + toChineseErrorMessage(data.error || `HTTP ${resp.status}`));
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer || '抱歉，我暂时无法回答。' }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      window.alert('AI 请求失败：' + toChineseErrorMessage(msg));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bot className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">AI入口</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('free')}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              mode === 'free' ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            自由模式
          </button>
          <button
            type="button"
            onClick={() => setMode('business')}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              mode === 'business'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            门店模式
          </button>
          <span className="text-xs text-gray-500">当前：{mode === 'free' ? '自由模式' : '门店模式'}</span>
        </div>
        <div className="h-[420px] min-h-[260px] max-h-[75vh] resize-y overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
          {messages.map((m, idx) => (
            <div key={`${m.role}-${idx}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="text-xs text-gray-500 px-1">
              AI 正在生成中...
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg"
            placeholder="输入你的问题，按回车发送"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending}
            className="inline-flex items-center px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Send className="w-4 h-4 mr-1" />
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-600" />
          <span className="font-medium">AI 对话日志已自动记录，用于问题追踪与服务优化。</span>
        </div>
      </div>
    </div>
  );
}
