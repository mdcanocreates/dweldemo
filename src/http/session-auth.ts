import type { IncomingMessage } from 'node:http';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  loadSessionIdentity,
  type SessionIdentity,
} from '../modules/auth/session.js';
import { AppError } from '../modules/shared/errors.js';
import { buildHostOnlyCookie } from '../modules/auth/rbit-auth/index.js';

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function extractSessionId(req: IncomingMessage): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies.rbit_session?.trim();
  if (cookie) return cookie;
  if (process.env.AUTH_LEGACY_SESSION_BEARER === '0') return null;
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return null;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'dev';
}

export async function requireSession(
  pool: DbPool,
  req: IncomingMessage,
): Promise<SessionIdentity> {
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    throw new AppError('authentication required', 'auth_required', 401);
  }
  return withSystemBypass(pool, (client) => loadSessionIdentity(client, sessionId));
}

export function sessionCookieHeader(credential: string, maxAgeSec: number): string {
  return buildHostOnlyCookie({
    name: 'rbit_session',
    value: credential,
    maxAgeSec,
    secure: cookieSecure(),
  });
}

export function clearSessionCookieHeader(): string {
  return buildHostOnlyCookie({
    name: 'rbit_session',
    value: '',
    maxAgeSec: 0,
    secure: cookieSecure(),
  });
}
