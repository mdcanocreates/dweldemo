/**
 * Control Center → Dwel service auth.
 * Bearer DWEL_INTERNAL_SERVICE_TOKEN (min 16 chars); timing-safe compare.
 * Optional CC service assertion (JWT/HMAC) when configured.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  assertionRequired,
  configuredAssertion,
  extractAssertionToken,
  verifyAssertionJwt,
  type ServiceAssertionClaims,
} from './assertion.js';

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
  | { ok: true; assertion: ServiceAssertionClaims | null }
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

  const assertCfg = configuredAssertion();
  if (!assertCfg) {
    return { ok: true, assertion: null };
  }

  const token = extractAssertionToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'assertion_required',
      message: 'X-RBIT-Service-Assertion required when assertion verification is configured',
    };
  }

  try {
    const assertion = verifyAssertionJwt(token, assertCfg);
    return { ok: true, assertion };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'assertion invalid';
    const error =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'assertion_invalid';
    return { ok: false, status: 401, error, message };
  }
}

export { assertionRequired, type ServiceAssertionClaims };
