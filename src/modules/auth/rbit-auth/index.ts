/**
 * RBIT authentication primitives shared by Lumis and Dwel.
 * No database, no network, no cookies with a Domain attribute.
 * Each application stores challenges and sessions in its own database.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_ISSUES_PER_EMAIL_PER_HOUR = 5;
export const MAX_ISSUES_PER_ACCOUNT_PER_HOUR = 5;
export const MAX_ISSUES_PER_IP_PER_HOUR = 20;
export const NORMAL_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const REMEMBER_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const CREDENTIAL_ROTATE_AFTER_MS = 12 * 60 * 60 * 1000;
export const PREVIOUS_CREDENTIAL_GRACE_MS = 10 * 60 * 1000;

export const GENERIC_CODE_SENT =
  'If that email can receive messages from us, a verification code is on the way.';

export type OtpFailureReason =
  | 'invalid_code'
  | 'expired'
  | 'consumed'
  | 'superseded'
  | 'too_many_attempts';

export type ChallengeView = {
  id: string;
  codeHash: string;
  expiresAtMs: number;
  consumedAtMs: number | null;
  supersededAtMs: number | null;
  attemptCount: number;
  maxAttempts: number;
};

export function generateNumericCode(digits = OTP_DIGITS): string {
  const span = 10 ** digits;
  return randomInt(0, span).toString().padStart(digits, '0');
}

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeOtpCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== OTP_DIGITS) return null;
  return digits;
}

/** Peppered HMAC. A database leak of code_hash is not a list of 6-digit codes. */
export function hashOtpCode(
  code: string,
  challengeId: string,
  pepper: string,
): string {
  return createHmac('sha256', pepper)
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

export function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Pure decision for one locked challenge row.
 * Callers must increment attempt_count only after a mismatch,
 * and must consume the row in the same critical section as this check.
 */
export function decideOtpVerification(input: {
  challenge: ChallengeView;
  presentedHash: string;
  nowMs: number;
}): { ok: true } | { ok: false; reason: OtpFailureReason } {
  const row = input.challenge;
  if (row.consumedAtMs != null) return { ok: false, reason: 'consumed' };
  if (row.supersededAtMs != null) return { ok: false, reason: 'superseded' };
  if (row.expiresAtMs <= input.nowMs) return { ok: false, reason: 'expired' };
  if (row.attemptCount >= row.maxAttempts) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (!safeEqualString(row.codeHash, input.presentedHash)) {
    return { ok: false, reason: 'invalid_code' };
  }
  return { ok: true };
}

export function sessionLifetimeMs(
  remember: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { idleMs: number; absoluteMs: number } {
  if (remember) {
    const days = positiveInt(env.SESSION_REMEMBER_ABSOLUTE_DAYS, 30);
    const idleHours = positiveInt(env.SESSION_REMEMBER_IDLE_HOURS, 24 * 30);
    const absoluteMs = days * 24 * 60 * 60 * 1000;
    const idleMs = Math.min(idleHours * 60 * 60 * 1000, absoluteMs);
    return { idleMs, absoluteMs };
  }
  const absoluteMs =
    positiveInt(env.SESSION_ABSOLUTE_TTL_HOURS, 24) * 60 * 60 * 1000;
  const idleMs = env.SESSION_IDLE_TTL_MINUTES?.trim()
    ? Math.min(
        positiveInt(env.SESSION_IDLE_TTL_MINUTES, 24 * 60) * 60 * 1000,
        absoluteMs,
      )
    : absoluteMs;
  return { idleMs, absoluteMs };
}

export function cookieMaxAgeSeconds(
  absoluteExpiresAtMs: number,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.floor((absoluteExpiresAtMs - nowMs) / 1000));
}

/**
 * Host-only cookie. Deliberately omits Domain so Lumis, Dwel, and Admin
 * do not share a session across subdomains.
 */
export function buildHostOnlyCookie(input: {
  name: string;
  value: string;
  maxAgeSec: number;
  secure: boolean;
  httpOnly?: boolean;
}): string {
  const parts = [
    `${input.name}=${encodeURIComponent(input.value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSec))}`,
  ];
  if (input.httpOnly !== false) parts.push('HttpOnly');
  if (input.secure) parts.push('Secure');
  return parts.join('; ');
}

export function shouldRotateCredential(input: {
  rotatedAtMs: number;
  nowMs: number;
  rotateAfterMs?: number;
}): boolean {
  const after = input.rotateAfterMs ?? CREDENTIAL_ROTATE_AFTER_MS;
  return input.nowMs - input.rotatedAtMs >= after;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export class SlidingRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): { allowed: boolean; retryAfterSec: number } {
    const recent = (this.buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      this.buckets.set(key, recent);
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      };
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}
