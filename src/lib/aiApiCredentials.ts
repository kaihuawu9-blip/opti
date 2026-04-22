const DEFAULT_OPENAI_V1 = 'https://api.openai.com/v1';

/**
 * OpenAI 兼容网关：服务端统一读取密钥。优先 `OPENAI_API_KEY`，未设置时回退 `AI_API_KEY`。
 */
export function getOpenAiCompatibleApiKey(): string {
  return (process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim();
}

/**
 * 服务端基址：优先 `OPENAI_BASE_URL`，未设置时回退 `AI_BASE_URL`，并去掉尾部 `/`。
 * 与密钥优先级一致，避免两套环境变量各读一半。
 */
export function getOpenAiCompatibleBaseUrl(): string {
  const raw = (process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || DEFAULT_OPENAI_V1).trim();
  return raw.replace(/\/$/, '') || DEFAULT_OPENAI_V1;
}

/**
 * 仅用于客户端 / Electron 打包时注入的公钥名（会进入前端包，请勿填高敏感主密钥 unless 接受暴露）。
 * 优先 `NEXT_PUBLIC_OPENAI_API_KEY`，回退 `NEXT_PUBLIC_AI_API_KEY`。
 */
export function getNextPublicOpenAiCompatibleApiKey(): string {
  return (process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.NEXT_PUBLIC_AI_API_KEY || '').trim();
}

/**
 * 客户端可选基址；优先 `NEXT_PUBLIC_OPENAI_BASE_URL`，回退 `NEXT_PUBLIC_AI_BASE_URL`。
 */
export function getNextPublicOpenAiCompatibleBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_OPENAI_BASE_URL || process.env.NEXT_PUBLIC_AI_BASE_URL || '').trim();
}
