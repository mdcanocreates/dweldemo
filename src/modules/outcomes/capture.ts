import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

const HORIZONS = [30, 90, 180, 365] as const;
const CAPTURE_SECRET =
  process.env.RBIT_OUTCOME_CAPTURE_SECRET ?? 'rbit-dev-outcome-capture-not-for-prod';

/**
 * On lease_signed: schedule four placement_outcome rows with requested_at
 * = lease_signed_at + horizon_days.
 */
export async function schedulePlacementOutcomes(
  client: DbClient,
  placementId: string,
  clock: Clock = systemClock,
): Promise<{ outcomeIds: string[] }> {
  const { rows } = await client.query<{
    lease_signed_at: Date | null;
    status: string;
  }>(`select lease_signed_at, status from placement where id = $1`, [placementId]);
  const placement = rows[0];
  if (!placement) throw new AppError('placement not found', 'placement_not_found', 404);
  if (placement.status !== 'lease_signed' && !placement.lease_signed_at) {
    throw new AppError('placement not lease_signed', 'placement_invalid_state', 409);
  }

  const signedAt = placement.lease_signed_at ?? clock.now();
  const outcomeIds: string[] = [];

  for (const horizon of HORIZONS) {
    const requestedAt = new Date(signedAt.getTime() + horizon * 24 * 60 * 60 * 1000);
    const id = randomUUID();
    await client.query(
      `insert into placement_outcome (id, placement_id, horizon_days, requested_at)
       values ($1,$2,$3,$4)
       on conflict (placement_id, horizon_days) do nothing`,
      [id, placementId, horizon, requestedAt],
    );
    const { rows: got } = await client.query<{ id: string }>(
      `select id from placement_outcome where placement_id = $1 and horizon_days = $2`,
      [placementId, horizon],
    );
    outcomeIds.push(got[0]!.id);
  }

  await emitDomainEvent(client, {
    aggregateType: 'placement',
    aggregateId: placementId,
    eventType: 'placement_outcome.scheduled',
    payload: { horizons: [...HORIZONS], outcome_ids: outcomeIds },
    actorKind: 'system',
  });

  return { outcomeIds };
}

/** Signed single-tap capture token — no session required. */
export function mintOutcomeCaptureToken(outcomeId: string, expiresAt: Date): string {
  const payload = `${outcomeId}.${expiresAt.getTime()}`;
  const sig = createHmac('sha256', CAPTURE_SECRET).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyOutcomeCaptureToken(token: string): {
  outcomeId: string;
  expiresAt: Date;
} {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new AppError('invalid capture token', 'outcome_invalid_token', 401);
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) {
    throw new AppError('invalid capture token', 'outcome_invalid_token', 401);
  }
  const [outcomeId, expStr, sig] = parts as [string, string, string];
  const payload = `${outcomeId}.${expStr}`;
  const expected = createHmac('sha256', CAPTURE_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('invalid capture token', 'outcome_invalid_token', 401);
  }
  const expiresAt = new Date(Number(expStr));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw new AppError('capture token expired', 'outcome_token_expired', 401);
  }
  return { outcomeId, expiresAt };
}

/**
 * Single-tap outcome capture without a login session.
 */
export async function captureOutcomeFromToken(
  client: DbClient,
  input: {
    token: string;
    paymentStatus: 'current' | 'late_1_30' | 'late_31_60' | 'late_60_plus' | 'default' | 'n_a';
    tenancyStatus: 'occupied' | 'vacated_normal' | 'vacated_early' | 'evicted' | 'n_a';
    source?: 'landlord_attest' | 'broker_attest' | 'tenant_attest';
    clock?: Clock;
  },
): Promise<{ outcomeId: string }> {
  const { outcomeId } = verifyOutcomeCaptureToken(input.token);
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  const { rows } = await client.query<{ id: string; reported_at: Date | null }>(
    `select id, reported_at from placement_outcome where id = $1 for update`,
    [outcomeId],
  );
  const row = rows[0];
  if (!row) throw new AppError('outcome not found', 'outcome_not_found', 404);
  if (row.reported_at) {
    // Idempotent: already captured
    return { outcomeId };
  }

  await client.query(
    `update placement_outcome set
       reported_at = $2,
       source = $3,
       payment_status = $4,
       tenancy_status = $5,
       confidence = 1
     where id = $1`,
    [
      outcomeId,
      now,
      input.source ?? 'landlord_attest',
      input.paymentStatus,
      input.tenancyStatus,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'placement_outcome',
    aggregateId: outcomeId,
    eventType: 'placement_outcome.captured',
    payload: {
      payment_status: input.paymentStatus,
      tenancy_status: input.tenancyStatus,
      via: 'single_tap_token',
    },
    actorKind: 'user',
    occurredAt: now,
  });

  return { outcomeId };
}
