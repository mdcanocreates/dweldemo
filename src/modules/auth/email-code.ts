import type { DbClient } from '../../db/pool.js';
import type { KmsProvider } from '../../infra/crypto/kms.js';
import { isEmailDeliveryEnabled } from '../../infra/email/transport.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveAuthSla } from '../config/index.js';
import { createPartyWithIdentity } from '../identity/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { insertUserSession } from './session.js';
import { platformEmailHmac } from './passwordless.js';
import {
  decideOtpVerification,
  generateNumericCode,
  hashOtpCode,
  safeEqualString,
  MAX_ISSUES_PER_ACCOUNT_PER_HOUR,
  MAX_ISSUES_PER_EMAIL_PER_HOUR,
  MAX_ISSUES_PER_IP_PER_HOUR,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
} from './rbit-auth/index.js';

const DEV_OTP_PEPPER = 'rbit-dev-auth-hmac-not-for-prod';

function otpPepper(): string {
  const pepper =
    process.env.AUTH_OTP_PEPPER?.trim() || process.env.RBIT_AUTH_HMAC_SECRET?.trim() || '';
  const node = (process.env.NODE_ENV ?? '').toLowerCase();
  const app = (process.env.APP_ENV ?? '').toLowerCase();
  const liveDelivery = isEmailDeliveryEnabled();
  if (!pepper || pepper === DEV_OTP_PEPPER) {
    if (liveDelivery || node === 'production' || app === 'production') {
      throw new AppError('sign-in is not configured', 'otp_not_configured', 503);
    }
    return DEV_OTP_PEPPER;
  }
  return pepper;
}

export type EmailCodeIssueResult = {
  ok: true;
  delivered: boolean;
  retryAfterSeconds: number;
  expiresInSeconds: number;
  /** Plaintext code for the mailer only. Never log. */
  code?: string;
  partyId: string | null;
};

async function findParty(client: DbClient, emailHmac: Buffer): Promise<string | null> {
  const { rows } = await client.query<{ party_id: string }>(
    `select party_id from external_identity_ref
     where vendor = 'email' and vendor_subject_id = $1`,
    [emailHmac.toString('hex')],
  );
  return rows[0]?.party_id ?? null;
}

export async function issueEmailCode(
  client: DbClient,
  kms: KmsProvider,
  input: {
    email: string;
    purpose: string;
    ip?: string | null;
    remember?: boolean;
    clock?: Clock;
  },
): Promise<EmailCodeIssueResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const emailHmac = platformEmailHmac(input.email);
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await client.query<{ n: number }>(
    `select count(*)::int as n from auth_email_challenge
     where email_hmac = $1 and created_at > $2`,
    [emailHmac, since],
  );
  if (Number(recent.rows[0]?.n ?? 0) >= MAX_ISSUES_PER_EMAIL_PER_HOUR) {
    throw new AppError('rate limit exceeded', 'auth_rate_limited', 429);
  }
  if (input.ip) {
    const ipRecent = await client.query<{ n: number }>(
      `select count(*)::int as n from auth_email_challenge
       where request_ip = $1::inet and created_at > $2`,
      [input.ip, since],
    );
    if (Number(ipRecent.rows[0]?.n ?? 0) >= MAX_ISSUES_PER_IP_PER_HOUR) {
      throw new AppError('rate limit exceeded', 'auth_rate_limited', 429);
    }
  }

  const open = await client.query<{ id: string; created_at: Date; expires_at: Date }>(
    `select id, created_at, expires_at
     from auth_email_challenge
     where email_hmac = $1 and purpose = $2
       and consumed_at is null and superseded_at is null
     order by created_at desc
     limit 1`,
    [emailHmac, input.purpose],
  );
  const latest = open.rows[0];
  if (latest && now.getTime() - latest.created_at.getTime() < RESEND_COOLDOWN_MS) {
    return {
      ok: true,
      delivered: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((latest.created_at.getTime() + RESEND_COOLDOWN_MS - now.getTime()) / 1000),
      ),
      expiresInSeconds: Math.max(0, Math.ceil((latest.expires_at.getTime() - now.getTime()) / 1000)),
      partyId: null,
    };
  }

  let partyId = await findParty(client, emailHmac);
  if (!partyId) {
    const created = await createPartyWithIdentity(client, kms, {
      identity: { email: input.email },
    });
    partyId = created.partyId;
    await client.query(
      `insert into external_identity_ref (party_id, vendor, vendor_subject_id)
       values ($1, 'email', $2)
       on conflict (vendor, vendor_subject_id) do nothing`,
      [partyId, emailHmac.toString('hex')],
    );
  }

  const accountRecent = await client.query<{ n: number }>(
    `select count(*)::int as n from auth_email_challenge
     where party_id = $1 and created_at > $2`,
    [partyId, since],
  );
  if (Number(accountRecent.rows[0]?.n ?? 0) >= MAX_ISSUES_PER_ACCOUNT_PER_HOUR) {
    throw new AppError('rate limit exceeded', 'auth_rate_limited', 429);
  }

  await client.query(
    `update auth_email_challenge
     set superseded_at = $3
     where email_hmac = $1 and purpose = $2
       and consumed_at is null and superseded_at is null`,
    [emailHmac, input.purpose, now],
  );

  const code = generateNumericCode();
  const inserted = await client.query<{ id: string }>(
    `insert into auth_email_challenge (
       email_hmac, purpose, code_hash, party_id, expires_at, request_ip,
       max_attempts, remember_device
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      emailHmac,
      input.purpose,
      Buffer.alloc(0),
      partyId,
      new Date(now.getTime() + OTP_TTL_MS),
      input.ip ?? null,
      OTP_MAX_ATTEMPTS,
      Boolean(input.remember),
    ],
  );
  const id = inserted.rows[0]!.id;
  const codeHash = Buffer.from(hashOtpCode(code, id, otpPepper()), 'hex');
  await client.query(`update auth_email_challenge set code_hash = $2 where id = $1`, [
    id,
    codeHash,
  ]);

  return {
    ok: true,
    delivered: true,
    code,
    retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    expiresInSeconds: Math.ceil(OTP_TTL_MS / 1000),
    partyId,
  };
}

export async function verifyEmailCode(
  client: DbClient,
  input: {
    email: string;
    code: string;
    purpose: string;
    remember?: boolean;
    clock?: Clock;
  },
): Promise<{ sessionId: string; partyId: string; credential: string; absoluteExpiresAt: Date }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const emailHmac = platformEmailHmac(input.email);
  const { rows } = await client.query<{
    id: string;
    party_id: string | null;
    code_hash: Buffer;
    expires_at: Date;
    consumed_at: Date | null;
    superseded_at: Date | null;
    attempt_count: number;
    max_attempts: number;
    remember_device: boolean;
  }>(
    `select id, party_id, code_hash, expires_at, consumed_at, superseded_at,
            attempt_count, max_attempts, remember_device
     from auth_email_challenge
     where email_hmac = $1 and purpose = $2
     order by created_at desc
     limit 5
     for update`,
    [emailHmac, input.purpose],
  );
  const latest = rows[0];
  if (!latest) {
    throw new AppError('invalid code', 'auth_invalid_code', 401);
  }
  const matched = rows.find((candidate) =>
    safeEqualString(
      hashOtpCode(input.code, candidate.id, otpPepper()),
      Buffer.from(candidate.code_hash).toString('hex'),
    ),
  );
  const row = matched ?? latest;
  if (!row.party_id) {
    throw new AppError('invalid code', 'auth_invalid_code', 401);
  }
  const decision = decideOtpVerification({
    challenge: {
      id: row.id,
      codeHash: Buffer.from(row.code_hash).toString('hex'),
      expiresAtMs: row.expires_at.getTime(),
      consumedAtMs: row.consumed_at?.getTime() ?? null,
      supersededAtMs: row.superseded_at?.getTime() ?? null,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    },
    presentedHash: matched ? Buffer.from(row.code_hash).toString('hex') : 'mismatch',
    nowMs: now.getTime(),
  });
  if (!decision.ok) {
    if (decision.reason === 'invalid_code') {
      await client.query(
        `update auth_email_challenge set attempt_count = attempt_count + 1 where id = $1`,
        [row.id],
      );
    }
    const code =
      decision.reason === 'expired'
        ? 'auth_code_expired'
        : decision.reason === 'too_many_attempts'
          ? 'auth_code_attempts'
          : decision.reason === 'consumed' || decision.reason === 'superseded'
            ? 'auth_code_used'
            : 'auth_invalid_code';
    throw new AppError('invalid code', code, 401);
  }

  const consumed = await client.query(
    `update auth_email_challenge set consumed_at = $2
     where id = $1 and consumed_at is null
     returning id`,
    [row.id, now],
  );
  if ((consumed.rowCount ?? 0) === 0) {
    throw new AppError('invalid code', 'auth_code_used', 401);
  }

  await client.query(`select set_config('rbit.current_party_id', $1, true)`, [row.party_id]);
  const sla = await resolveAuthSla(client, now);
  const created = await insertUserSession(client, {
    partyId: row.party_id,
    remember: input.remember ?? row.remember_device,
    now,
    elevationTtlMs: sla.elevationTtlMs,
  });
  await emitDomainEvent(client, {
    aggregateType: 'session',
    aggregateId: created.sessionId,
    eventType: 'session.created',
    payload: { party_id: row.party_id },
    actorPartyId: row.party_id,
    actorKind: 'user',
    occurredAt: now,
  });
  return { ...created, partyId: row.party_id };
}
