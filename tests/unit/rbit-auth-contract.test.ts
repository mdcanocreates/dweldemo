import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  buildHostOnlyCookie,
  decideOtpVerification,
  generateNumericCode,
  hashOtpCode,
  sessionLifetimeMs,
} from '../../src/modules/auth/rbit-auth/index.js';

describe('rbit auth contract', () => {
  it('generates a 6-digit code and stores only a keyed hash', () => {
    const code = generateNumericCode();
    expect(code).toMatch(/^\d{6}$/);
    const hash = hashOtpCode(code, 'challenge-1', 'pepper');
    expect(hash).not.toContain(code);
    expect(hashOtpCode(code, 'challenge-1', 'pepper')).toBe(hash);
    expect(hashOtpCode(code, 'challenge-2', 'pepper')).not.toBe(hash);
  });

  it('rejects expired, reused, superseded, and over-attempted codes', () => {
    const challenge = {
      id: 'c',
      codeHash: hashOtpCode('123456', 'c', 'pepper'),
      expiresAtMs: 1_000 + OTP_TTL_MS,
      consumedAtMs: null,
      supersededAtMs: null,
      attemptCount: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
    };
    expect(
      decideOtpVerification({
        challenge,
        presentedHash: challenge.codeHash,
        nowMs: 1_000,
      }).ok,
    ).toBe(true);
    expect(
      decideOtpVerification({
        challenge,
        presentedHash: 'nope',
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: 'invalid_code' });
    expect(
      decideOtpVerification({
        challenge,
        presentedHash: challenge.codeHash,
        nowMs: challenge.expiresAtMs,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      decideOtpVerification({
        challenge: { ...challenge, consumedAtMs: 1 },
        presentedHash: challenge.codeHash,
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: 'consumed' });
    expect(
      decideOtpVerification({
        challenge: { ...challenge, supersededAtMs: 1 },
        presentedHash: challenge.codeHash,
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: 'superseded' });
    expect(
      decideOtpVerification({
        challenge: { ...challenge, attemptCount: OTP_MAX_ATTEMPTS },
        presentedHash: challenge.codeHash,
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('uses a 24 hour session unless the device is remembered for 30 days', () => {
    const normal = sessionLifetimeMs(false, {});
    const remembered = sessionLifetimeMs(true, {});
    expect(normal.absoluteMs).toBe(24 * 60 * 60 * 1000);
    expect(normal.idleMs).toBe(normal.absoluteMs);
    expect(remembered.absoluteMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('builds a host-only HttpOnly cookie', () => {
    const cookie = buildHostOnlyCookie({
      name: 'rbit_session',
      value: 'secret',
      maxAgeSec: 60,
      secure: true,
    });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });
});
