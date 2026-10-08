/**
 * Optional Control Center service assertion (JWT).
 * When DWEL_CC_ASSERTION_HMAC_SECRET or DWEL_CC_ASSERTION_PUBLIC_KEY is set,
 * mutating/sensitive internal routes verify the signed assertion.
 *
 * Claims follow the CC contract: iss/aud/sub/scp/product/jti/iat/exp.
 */

import { createHmac, createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.js';

export const CC_ASSERTION_HEADER = 'x-rbit-service-assertion';
export const SCREENING_VIEW_SCOPE = 'dwel.screening.view';

export type ServiceAssertionClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  scp: string[];
  product: string;
  request_id?: string;
  jti: string;
  iat: number;
  exp: number;
};

export type AssertionConfig =
  | { mode: 'hmac'; secret: string }
  | { mode: 'rsa'; publicKeyPem: string }
  | null;

export function configuredAssertion(): AssertionConfig {
  const hmac = process.env.DWEL_CC_ASSERTION_HMAC_SECRET?.trim();
  if (hmac && hmac.length >= 16) return { mode: 'hmac', secret: hmac };
  const pem = process.env.DWEL_CC_ASSERTION_PUBLIC_KEY?.trim();
  if (pem && pem.includes('BEGIN')) return { mode: 'rsa', publicKeyPem: pem };
  return null;
}

export function assertionRequired(): boolean {
  return configuredAssertion() != null;
}

function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function parseAud(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((x): x is string => typeof x === 'string');
  return [];
}

function parseScp(scp: unknown): string[] {
  if (Array.isArray(scp)) return scp.filter((x): x is string => typeof x === 'string');
  if (typeof scp === 'string') {
    return scp
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractAssertionToken(req: IncomingMessage): string | null {
  const h = req.headers[CC_ASSERTION_HEADER];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]?.trim()) return h[0].trim();
  return null;
}

function verifyHs256(signingInput: string, signatureB64url: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = b64urlToBuf(signatureB64url);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function verifyRs256(signingInput: string, signatureB64url: string, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(key, b64urlToBuf(signatureB64url));
}

export function verifyAssertionJwt(
  token: string,
  config: NonNullable<AssertionConfig>,
  opts?: { nowSec?: number; maxSkewSec?: number },
): ServiceAssertionClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('invalid service assertion', 'assertion_invalid', 401);
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString('utf8')) as {
      alg?: string;
      typ?: string;
    };
  } catch {
    throw new AppError('invalid service assertion header', 'assertion_invalid', 401);
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  let ok = false;
  if (config.mode === 'hmac') {
    if (header.alg !== 'HS256') {
      throw new AppError('assertion alg must be HS256', 'assertion_invalid', 401);
    }
    ok = verifyHs256(signingInput, sigB64, config.secret);
  } else {
    if (header.alg !== 'RS256') {
      throw new AppError('assertion alg must be RS256', 'assertion_invalid', 401);
    }
    ok = verifyRs256(signingInput, sigB64, config.publicKeyPem);
  }
  if (!ok) {
    throw new AppError('service assertion signature invalid', 'assertion_invalid', 401);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(b64urlToBuf(payloadB64).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new AppError('invalid service assertion payload', 'assertion_invalid', 401);
  }

  const now = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = opts?.maxSkewSec ?? 30;
  const exp = typeof raw.exp === 'number' ? raw.exp : NaN;
  const iat = typeof raw.iat === 'number' ? raw.iat : NaN;
  if (!Number.isFinite(exp) || exp < now - skew) {
    throw new AppError('service assertion expired', 'assertion_expired', 401);
  }
  if (!Number.isFinite(iat) || iat > now + skew) {
    throw new AppError('service assertion iat invalid', 'assertion_invalid', 401);
  }

  const iss = typeof raw.iss === 'string' ? raw.iss : '';
  if (iss !== 'rbit-control-center') {
    throw new AppError('service assertion iss invalid', 'assertion_invalid', 401);
  }

  const aud = parseAud(raw.aud);
  if (!aud.includes('dwel-internal')) {
    throw new AppError('service assertion aud invalid', 'assertion_invalid', 401);
  }

  const product = typeof raw.product === 'string' ? raw.product : '';
  if (product !== 'dwel') {
    throw new AppError('service assertion product invalid', 'assertion_invalid', 401);
  }

  const sub = typeof raw.sub === 'string' ? raw.sub.trim() : '';
  const jti = typeof raw.jti === 'string' ? raw.jti.trim() : '';
  if (!sub || !jti) {
    throw new AppError('service assertion missing sub/jti', 'assertion_invalid', 401);
  }

  return {
    iss,
    aud,
    sub,
    scp: parseScp(raw.scp),
    product,
    request_id: typeof raw.request_id === 'string' ? raw.request_id : undefined,
    jti,
    iat,
    exp,
  };
}

export function hasScope(claims: ServiceAssertionClaims | null | undefined, scope: string): boolean {
  return Boolean(claims?.scp?.includes(scope));
}
