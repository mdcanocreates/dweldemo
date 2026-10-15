import { createHmac, timingSafeEqual } from 'node:crypto';

/** Default replay window: 5 minutes. */
export const CHECKR_WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

/**
 * Verify Checkr Tenant `Tenant-Signature` header.
 * Format: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
 * Signed payload: `t.<raw_request_body>`
 */
export function verifyCheckrTenantSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
  opts?: {
    nowSeconds?: number;
    replayWindowSeconds?: number;
  },
): { valid: boolean; reason?: string; timestamp?: number } {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'missing_signature_or_secret' };
  }

  const parts = signatureHeader.split(',').map((p) => p.trim());
  let timestamp: number | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const [k, ...rest] = part.split('=');
    const v = rest.join('=');
    if (k === 't') timestamp = Number(v);
    if (k === 'v1') v1 = v;
  }

  if (!timestamp || !Number.isFinite(timestamp) || !v1) {
    return { valid: false, reason: 'malformed_signature_header' };
  }

  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const window = opts?.replayWindowSeconds ?? CHECKR_WEBHOOK_REPLAY_WINDOW_SECONDS;
  if (Math.abs(now - timestamp) > window) {
    return { valid: false, reason: 'timestamp_outside_replay_window', timestamp };
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1.toLowerCase(), 'utf8');
  if (a.length !== b.length) {
    return { valid: false, reason: 'signature_mismatch', timestamp };
  }
  if (!timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature_mismatch', timestamp };
  }
  return { valid: true, timestamp };
}

/** Test helper — produce a valid Tenant-Signature for a raw body. */
export function signCheckrTenantBody(
  rawBody: string,
  secret: string,
  timestampSeconds?: number,
): string {
  const t = timestampSeconds ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}
