import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

const MAX_FAILED_ATTEMPTS_PER_IP_PER_HOUR = 30;

const failedAttemptBuckets = new Map<string, number[]>();

export function resetApplicationAccessRateLimits(): void {
  failedAttemptBuckets.clear();
}

function hashToken(token: Buffer): Buffer {
  return createHash('sha256').update(token).digest();
}

function pruneAndCount(key: string, windowMs: number, now: number): number {
  const arr = (failedAttemptBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  failedAttemptBuckets.set(key, arr);
  return arr.length;
}

function recordFailedAttempt(key: string, now: number): void {
  const arr = failedAttemptBuckets.get(key) ?? [];
  arr.push(now);
  failedAttemptBuckets.set(key, arr);
}

export async function resolveApplicationAccessTtlMs(
  client: DbClient,
  asOf: Date,
): Promise<number> {
  const cfg = await resolveConfig(client, 'application_access', asOf);
  const ms = Number(cfg?.token_ttl_ms);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new AppError(
      'application_access.token_ttl_ms missing from approved config',
      'config_required',
      500,
    );
  }
  return ms;
}

export type IssueApplicationAccessTokenInput = {
  applicationId: string;
  ip?: string | null;
  clock?: Clock;
};

export type IssueApplicationAccessTokenResult = {
  tokenId: string;
  expiresAt: Date;
  /** Plaintext token — deliver once to the client. Never log or persist. */
  token: string;
};

export async function issueApplicationAccessToken(
  client: DbClient,
  input: IssueApplicationAccessTokenInput,
): Promise<IssueApplicationAccessTokenResult> {
  const clock = input.clock ?? systemClock;
  const ttlMs = await resolveApplicationAccessTtlMs(client, clock.now());
  const expiresAt = new Date(clock.now().getTime() + ttlMs);
  const tokenBytes = randomBytes(32);
  const tokenHash = hashToken(tokenBytes);
  const tokenId = randomUUID();

  await client.query(
    `insert into application_access_token (
       id, application_id, token_hash, expires_at, request_ip
     ) values ($1::uuid, $2, $3, $4, $5::inet)`,
    [tokenId, input.applicationId, tokenHash, expiresAt, input.ip ?? null],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'application.access_token_issued',
    payload: { token_id: tokenId, expires_at: expiresAt.toISOString() },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  return {
    tokenId,
    expiresAt,
    token: tokenBytes.toString('base64url'),
  };
}

export type ValidateApplicationAccessInput = {
  applicationId: string;
  token: string;
  ip?: string | null;
  clock?: Clock;
};

export async function validateApplicationAccessToken(
  client: DbClient,
  input: ValidateApplicationAccessInput,
): Promise<{ tokenId: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const nowMs = now.getTime();

  if (input.ip) {
    const failures = pruneAndCount(`ip:${input.ip}`, 60 * 60 * 1000, nowMs);
    if (failures >= MAX_FAILED_ATTEMPTS_PER_IP_PER_HOUR) {
      throw new AppError('rate limit exceeded', 'application_access_rate_limited', 429);
    }
  }

  let tokenBytes: Buffer;
  try {
    tokenBytes = Buffer.from(input.token, 'base64url');
  } catch {
    if (input.ip) recordFailedAttempt(`ip:${input.ip}`, nowMs);
    throw new AppError('invalid application access token', 'application_access_invalid', 401);
  }

  if (tokenBytes.length < 32) {
    if (input.ip) recordFailedAttempt(`ip:${input.ip}`, nowMs);
    throw new AppError('invalid application access token', 'application_access_invalid', 401);
  }

  const tokenHash = hashToken(tokenBytes);
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `select id, application_id, expires_at, revoked_at
     from application_access_token
     where token_hash = $1`,
    [tokenHash],
  );

  const matched = rows.find((row) => row.application_id === input.applicationId);

  if (!matched) {
    if (input.ip) recordFailedAttempt(`ip:${input.ip}`, nowMs);
    throw new AppError('invalid application access token', 'application_access_invalid', 401);
  }

  if (matched.revoked_at) {
    if (input.ip) recordFailedAttempt(`ip:${input.ip}`, nowMs);
    throw new AppError('application access token revoked', 'application_access_revoked', 401);
  }

  if (matched.expires_at.getTime() <= nowMs) {
    if (input.ip) recordFailedAttempt(`ip:${input.ip}`, nowMs);
    throw new AppError('application access token expired', 'application_access_expired', 401);
  }

  await client.query(
    `update application_access_token set last_used_at = $2 where id = $1`,
    [matched.id, now],
  );

  return { tokenId: matched.id };
}

export async function revokeApplicationAccessTokens(
  client: DbClient,
  applicationId: string,
  clock: Clock = systemClock,
): Promise<number> {
  const { rowCount } = await client.query(
    `update application_access_token
     set revoked_at = $2
     where application_id = $1 and revoked_at is null`,
    [applicationId, clock.now()],
  );
  return rowCount ?? 0;
}
