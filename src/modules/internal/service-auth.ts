/**
 * Control Center → Dwel service auth.
 * Bearer DWEL_INTERNAL_SERVICE_TOKEN (min 16 chars); timing-safe compare.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

/** Shared secret for Control Center → Dwel internal calls. */
export function configuredInternalToken(): string | null {
  const t = process.env.DWEL_INTERNAL_SERVICE_TOKEN?.trim();
  return t && t.length >= 16 ? t : null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type ServiceAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string; message?: string };

export function requireInternalService(req: IncomingMessage): ServiceAuthResult {
  const expected = configuredInternalToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: 'internal_auth_unconfigured',
      message: 'DWEL_INTERNAL_SERVICE_TOKEN is not set',
    };
  }
  const bearer = extractBearer(req);
  if (!bearer || !safeEqual(bearer, expected)) {
    return { ok: false, status: 401, error: 'unauthenticated' };
  }
  return { ok: true };
}
