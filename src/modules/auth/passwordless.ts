import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import type { KmsProvider } from '../../infra/crypto/kms.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveAuthSla } from '../config/index.js';
import { createPartyWithIdentity } from '../identity/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

const MAX_ISSUES_PER_EMAIL_PER_HOUR = 5;
const MAX_ISSUES_PER_IP_PER_HOUR = 20;

/** Platform HMAC for email lookup (auth). Not logged. */
const PLATFORM_HMAC_SECRET =
  process.env.RBIT_AUTH_HMAC_SECRET ?? 'rbit-dev-auth-hmac-not-for-prod';

export type MagicTokenIssueResult = {
  /** Always identical shape — never reveals whether email existed. */
  ok: true;
  /** Present only in non-production test hooks when explicitly requested. */
  debugToken?: string;
};

const rateBuckets = new Map<string, number[]>();

function pruneAndCount(key: string, windowMs: number, now: number): number {
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  rateBuckets.set(key, arr);
  return arr.length;
}

function hitRate(key: string, now: number): void {
  const arr = rateBuckets.get(key) ?? [];
  arr.push(now);
  rateBuckets.set(key, arr);
}

export function resetAuthRateLimits(): void {
  rateBuckets.clear();
}

export function platformEmailHmac(email: string): Buffer {
  return createHmac('sha256', PLATFORM_HMAC_SECRET)
    .update(email.normalize('NFKC').toLowerCase())
    .digest();
}

function hashToken(token: Buffer): Buffer {
  return createHash('sha256').update(token).digest();
}

async function findPartyByEmailRef(
  client: DbClient,
  emailHmac: Buffer,
): Promise<string | null> {
  const { rows } = await client.query<{ party_id: string }>(
    `select party_id from external_identity_ref
     where vendor = 'email' and vendor_subject_id = $1`,
    [emailHmac.toString('hex')],
  );
  return rows[0]?.party_id ?? null;
}

async function linkEmailRef(
  client: DbClient,
  partyId: string,
  emailHmac: Buffer,
): Promise<void> {
  await client.query(
    `insert into external_identity_ref (party_id, vendor, vendor_subject_id)
     values ($1, 'email', $2)
     on conflict (vendor, vendor_subject_id) do nothing`,
    [partyId, emailHmac.toString('hex')],
  );
}

/**
 * Issue a passwordless magic token.
 * Enumeration-resistant: response is identical whether or not the email exists.
 * Rate limited per email_hmac and per IP.
 */
export async function issueMagicToken(
  client: DbClient,
  kms: KmsProvider,
  input: {
    email: string;
    purpose: string;
    ip?: string | null;
    createPartyIfMissing?: boolean;
    /** Test-only: return plaintext token. Never log. */
    returnTokenForTest?: boolean;
    clock?: Clock;
  },
): Promise<MagicTokenIssueResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const nowMs = now.getTime();
  const emailHmac = platformEmailHmac(input.email);

  const emailCount = pruneAndCount(
    `email:${emailHmac.toString('hex')}`,
    60 * 60 * 1000,
    nowMs,
  );
  if (emailCount >= MAX_ISSUES_PER_EMAIL_PER_HOUR) {
    throw new AppError('rate limit exceeded', 'auth_rate_limited', 429);
  }
  if (input.ip) {
    const ipCount = pruneAndCount(`ip:${input.ip}`, 60 * 60 * 1000, nowMs);
    if (ipCount >= MAX_ISSUES_PER_IP_PER_HOUR) {
      throw new AppError('rate limit exceeded', 'auth_rate_limited', 429);
    }
    hitRate(`ip:${input.ip}`, nowMs);
  }
  hitRate(`email:${emailHmac.toString('hex')}`, nowMs);

  let partyId = await findPartyByEmailRef(client, emailHmac);
  if (!partyId && (input.createPartyIfMissing ?? true)) {
    const created = await createPartyWithIdentity(client, kms, {
      identity: { email: input.email },
    });
    partyId = created.partyId;
    await linkEmailRef(client, partyId, emailHmac);
  }

  // Invalidate prior outstanding tokens for this email+purpose.
  await client.query(
    `update auth_magic_token
     set invalidated_at = $3
     where email_hmac = $1 and purpose = $2
       and redeemed_at is null and invalidated_at is null`,
    [emailHmac, input.purpose, now],
  );

  const sla = await resolveAuthSla(client, now);
  const token = randomBytes(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(nowMs + sla.magicTokenTtlMs);

  await client.query(
    `insert into auth_magic_token (
       email_hmac, purpose, token_hash, party_id, expires_at, request_ip
     ) values ($1,$2,$3,$4,$5,$6)`,
    [emailHmac, input.purpose, tokenHash, partyId, expiresAt, input.ip ?? null],
  );

  await emitDomainEvent(client, {
    aggregateType: 'auth_magic_token',
    aggregateId: partyId ?? '00000000-0000-0000-0000-000000000000',
    eventType: 'auth.magic_token_issued',
    payload: { purpose: input.purpose, has_party: Boolean(partyId) },
    actorKind: 'system',
    occurredAt: now,
  });

  const result: MagicTokenIssueResult = { ok: true };
  if (input.returnTokenForTest) {
    result.debugToken = token.toString('base64url');
  }
  return result;
}

export async function redeemMagicToken(
  client: DbClient,
  input: {
    token: string;
    purpose: string;
    deviceFingerprint?: string | null;
    clock?: Clock;
  },
): Promise<{ sessionId: string; partyId: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const tokenBuf = Buffer.from(input.token, 'base64url');
  if (tokenBuf.length !== 32) {
    throw new AppError('invalid token', 'auth_invalid_token', 401);
  }
  const tokenHash = hashToken(tokenBuf);

  const { rows } = await client.query<{
    id: string;
    party_id: string | null;
    expires_at: Date;
    redeemed_at: Date | null;
    invalidated_at: Date | null;
    purpose: string;
    token_hash: Buffer;
  }>(
    `select id, party_id, expires_at, redeemed_at, invalidated_at, purpose, token_hash
     from auth_magic_token
     where token_hash = $1
     for update`,
    [tokenHash],
  );
  const row = rows[0];
  if (
    !row ||
    row.purpose !== input.purpose ||
    row.redeemed_at ||
    row.invalidated_at ||
    row.expires_at.getTime() < now.getTime() ||
    !row.party_id
  ) {
    throw new AppError('invalid token', 'auth_invalid_token', 401);
  }

  // timing-safe compare already via unique hash lookup; keep compare for defense
  if (!timingSafeEqual(Buffer.from(row.token_hash), tokenHash)) {
    throw new AppError('invalid token', 'auth_invalid_token', 401);
  }

  await client.query(
    `update auth_magic_token set redeemed_at = $2 where id = $1`,
    [row.id, now],
  );

  // Session is PARTY-RLS; redeem has no prior context — bind party before insert.
  await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
    row.party_id,
  ]);

  const sla = await resolveAuthSla(client, now);
  const sessionId = (await client.query<{ id: string }>(
    `insert into session (party_id, device_fingerprint, expires_at, elevated_until)
     values ($1,$2,$3,$4)
     returning id`,
    [
      row.party_id,
      input.deviceFingerprint ?? null,
      new Date(now.getTime() + sla.sessionTtlMs),
      new Date(now.getTime() + sla.elevationTtlMs),
    ],
  )).rows[0]!.id;

  await emitDomainEvent(client, {
    aggregateType: 'session',
    aggregateId: sessionId,
    eventType: 'session.created',
    payload: { party_id: row.party_id },
    actorPartyId: row.party_id,
    actorKind: 'user',
    occurredAt: now,
  });

  return { sessionId, partyId: row.party_id };
}
