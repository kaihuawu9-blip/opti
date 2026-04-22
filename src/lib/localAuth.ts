import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const LOCAL_AUTH_COOKIE = 'opti_local_session_v1';
export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type LocalAuthUser = {
  id: string;
  email: string | null;
  role: string;
  status: string;
};

function normalizeRole(raw: string | null | undefined): 'owner' | 'manager' | 'cashier' | 'inventory' {
  const role = String(raw || '').trim().toLowerCase();
  if (role === 'owner' || role === 'manager' || role === 'cashier' || role === 'inventory') return role;
  return 'cashier';
}

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

export function verifyPassword(plain: string, encoded: string): boolean {
  const parts = encoded.split(':');
  if (parts.length !== 2) return false;
  const [salt, storedDigestHex] = parts;
  const digest = scryptSync(plain, salt, 64);
  const storedDigest = Buffer.from(storedDigestHex, 'hex');
  if (storedDigest.length !== digest.length) return false;
  return timingSafeEqual(digest, storedDigest);
}

export function parseSessionCookie(raw: string | undefined): { id: string; secret: string } | null {
  const value = (raw || '').trim();
  if (!value) return null;
  const [id, secret] = value.split('.');
  if (!id || !secret) return null;
  return { id, secret };
}

export async function ensureLocalAuthSchema() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
  `);
}

export async function maybeBootstrapLocalAdmin(email: string, plainPassword: string): Promise<LocalAuthUser | null> {
  const bootstrapEmail = (process.env.LOCAL_AUTH_BOOTSTRAP_EMAIL || process.env.LOCAL_AUTH_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const bootstrapPassword = (process.env.LOCAL_AUTH_BOOTSTRAP_PASSWORD || process.env.LOCAL_AUTH_ADMIN_PASSWORD || '').trim();
  if (!bootstrapEmail || !bootstrapPassword) return null;
  if (email.toLowerCase() !== bootstrapEmail || plainPassword !== bootstrapPassword) return null;

  const existing = (await prisma.$queryRawUnsafe(
    `
      SELECT id, email, role, status
        FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1
    `,
    bootstrapEmail,
  )) as LocalAuthUser[];
  if (existing[0]) return existing[0];

  const id = randomUUID();
  const openid = `local:${bootstrapEmail}`;
  const passwordHash = hashPassword(bootstrapPassword);
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO users (id, openid, email, password_hash, role, status, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'owner', 'ACTIVE', NOW(), NOW())
    `,
    id,
    openid,
    bootstrapEmail,
    passwordHash,
  );
  return { id, email: bootstrapEmail, role: 'owner', status: 'ACTIVE' };
}

export async function resolveSessionFromRequest(req: NextRequest): Promise<{ user: LocalAuthUser; sessionId: string } | null> {
  /** 无会话 Cookie 时不触库：避免未登录用户每次打开应用都跑 DDL，DATABASE_URL 异常时整页永久「加载中」。 */
  const parsed = parseSessionCookie(req.cookies.get(LOCAL_AUTH_COOKIE)?.value);
  if (!parsed) return null;
  await ensureLocalAuthSchema();
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT u.id, u.email, u.role, u.status, s.id AS session_id, s.token_hash
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
       LIMIT 1
    `,
    parsed.id,
  )) as Array<LocalAuthUser & { session_id: string; token_hash: string }>;
  const row = rows[0];
  if (!row) return null;
  const incomingHash = hashToken(parsed.secret);
  if (!timingSafeEqual(Buffer.from(incomingHash, 'hex'), Buffer.from(row.token_hash, 'hex'))) return null;
  await prisma.$executeRawUnsafe(`UPDATE user_sessions SET user_agent = COALESCE($2, user_agent) WHERE id = $1`, parsed.id, req.headers.get('user-agent'));
  return {
    user: {
      id: row.id,
      email: row.email,
      role: normalizeRole(row.role),
      status: row.status,
    },
    sessionId: row.session_id,
  };
}

/** 浏览器到站点是否走 HTTPS（含反代终止 TLS 时的 x-forwarded-proto）。 */
export function requestIsHttps(req: NextRequest): boolean {
  try {
    if (req.nextUrl.protocol === 'https:') return true;
  } catch {
    // ignore
  }
  const forwarded = (req.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  return forwarded === 'https';
}

export type SessionCookieFlags = { secure: boolean };

export function setSessionCookie(
  res: NextResponse,
  sessionId: string,
  secret: string,
  maxAgeSeconds: number,
  flags: SessionCookieFlags,
) {
  const secure = flags.secure;
  const base = {
    name: LOCAL_AUTH_COOKIE,
    value: `${sessionId}.${secret}`,
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
  if (secure) {
    res.cookies.set({ ...base, partitioned: true });
  } else {
    res.cookies.set(base);
  }
}

export function clearSessionCookie(res: NextResponse, flags: SessionCookieFlags) {
  const secure = flags.secure;
  const base = {
    name: LOCAL_AUTH_COOKIE,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
  if (secure) {
    res.cookies.set({ ...base, partitioned: true });
  } else {
    res.cookies.set(base);
  }
}

export async function createSessionForUser(userId: string, userAgent: string | null): Promise<{ id: string; secret: string; expiresAtIso: string }> {
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const tokenHash = hashToken(secret);
  const expiresAt = new Date(Date.now() + ONE_YEAR_SECONDS * 1000);
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at, user_agent, created_at)
      VALUES ($1, $2, $3, $4::timestamptz, $5, NOW())
    `,
    sessionId,
    userId,
    tokenHash,
    expiresAt.toISOString(),
    userAgent,
  );
  return { id: sessionId, secret, expiresAtIso: expiresAt.toISOString() };
}
