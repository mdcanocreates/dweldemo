import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { activeSecrets } from './credentials.js';
import { AppError } from '../shared/errors.js';

/** In-memory nonce cache (Redis in prod). */
const nonceCache = new Map<string, number>();

export function resetPushNonces(): void {
  nonceCache.clear();
}

export type PushVerifyResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: string; status: number };

/**
 * POST /v1/ingest/{source_id}
 * X-RBIT-Signature: t=<unix_seconds>,v1=<hmac_sha256(secret, t + "." + rawBody)>
 */
export function verifyPushSignature(input: {
  rawBody: string | Buffer;
  signatureHeader: string | undefined;
  credentialRef: string;
  nonce?: string | null;
  clock?: Clock;
  maxSkewSeconds?: number;
}): PushVerifyResult {
  const clock = input.clock ?? systemClock;
  const maxSkew = input.maxSkewSeconds ?? 300;
  if (!input.signatureHeader) {
    return { ok: false, reason: 'missing_signature', status: 401 };
  }

  const parts = Object.fromEntries(
    input.signatureHeader.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k, rest.join('=')];
    }),
  ) as Record<string, string>;

  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) {
    return { ok: false, reason: 'malformed_signature', status: 401 };
  }

  const nowSec = Math.floor(clock.now().getTime() / 1000);
  if (Math.abs(nowSec - t) > maxSkew) {
    return { ok: false, reason: 'stale_timestamp', status: 401 };
  }

  if (input.nonce) {
    const key = `${input.credentialRef}:${input.nonce}`;
    const prev = nonceCache.get(key);
    if (prev != null) {
      return { ok: false, reason: 'replayed_nonce', status: 401 };
    }
    nonceCache.set(key, nowSec);
  }

  const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
  const secrets = activeSecrets(input.credentialRef);
  if (!secrets.length) {
    return { ok: false, reason: 'missing_credential', status: 401 };
  }

  const signed = `${t}.${raw}`;
  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(signed).digest('hex');
    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(v1, 'utf8');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        matched = true;
        break;
      }
    } catch {
      /* continue */
    }
  }
  if (!matched) {
    return { ok: false, reason: 'invalid_signature', status: 401 };
  }

  try {
    const body = JSON.parse(raw) as unknown;
    return { ok: true, body };
  } catch {
    return { ok: false, reason: 'malformed_body', status: 400 };
  }
}

export function signPushBody(
  secret: string,
  rawBody: string,
  timestampSec: number,
): string {
  const v1 = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `t=${timestampSec},v1=${v1}`;
}

export function mintPushSecret(): string {
  return randomBytes(32).toString('hex');
}

export function parsePushRecords(body: unknown): {
  records: Record<string, unknown>[];
  reason?: string;
} {
  if (body == null) return { records: [], reason: 'empty_body' };
  if (Array.isArray(body)) {
    return { records: body as Record<string, unknown>[] };
  }
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.records)) {
      return { records: o.records as Record<string, unknown>[] };
    }
    if (o.external_id || o.id) {
      return { records: [o] };
    }
  }
  return { records: [], reason: 'malformed_body' };
}

export function assertPushAccepted(result: PushVerifyResult): asserts result is { ok: true; body: unknown } {
  if (!result.ok) {
    throw new AppError(result.reason, result.reason, result.status);
  }
}
