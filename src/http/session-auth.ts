import type { IncomingMessage } from 'node:http';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  loadSessionIdentity,
  type SessionIdentity,
} from '../modules/auth/session.js';
import { AppError } from '../modules/shared/errors.js';

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
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.rbit_session?.trim() || null;
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

export function sessionCookieHeader(sessionId: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'dev';
  return [
    `rbit_session=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookieHeader(): string {
  return 'rbit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
