import crypto from 'crypto';

type JwtPayload = Record<string, unknown> & {
  iat?: number;
  exp?: number;
};

export type MiniprogramAccessPayload = {
  sub: string;
  openid: string;
  role: string;
  status: string;
  iat: number;
  exp: number;
};

const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function getJwtSecret(): string {
  const secret =
    (process.env.MINIPROGRAM_JWT_SECRET || process.env.NEXT_PUBLIC_MINIPROGRAM_CHAT_TOKEN || '').trim();
  if (!secret) {
    throw new Error('服务端未配置 MINIPROGRAM_JWT_SECRET');
  }
  return secret;
}

function signHs256(message: string, secret: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(message).digest());
}

export function signMiniprogramToken(
  payload: Omit<MiniprogramAccessPayload, 'iat' | 'exp'>,
  expiresInSec = DEFAULT_EXPIRES_IN_SECONDS,
): string {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = signHs256(`${headerPart}.${payloadPart}`, secret);

  return `${headerPart}.${payloadPart}.${signature}`;
}

export function verifyMiniprogramToken(token: string): MiniprogramAccessPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Token 格式不正确');
  }

  const [headerPart, payloadPart, signature] = parts;
  const secret = getJwtSecret();
  const expected = signHs256(`${headerPart}.${payloadPart}`, secret);
  if (signature !== expected) {
    throw new Error('Token 签名无效');
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart)) as JwtPayload;
  if (!payload || typeof payload !== 'object') {
    throw new Error('Token payload 无效');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Token 已过期');
  }

  return payload as MiniprogramAccessPayload;
}

export function extractBearerToken(authHeader: string): string {
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
