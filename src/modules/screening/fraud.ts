import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { resolveFraudThresholds } from './config.js';

export async function recordFraudSignal(
  client: DbClient,
  input: {
    partyId?: string | null;
    applicationId?: string | null;
    signalKind: string;
    severity: 'low' | 'medium' | 'high';
    detail: Record<string, unknown>;
    clock?: Clock;
  },
): Promise<string> {
  const clock = input.clock ?? systemClock;
  const id = randomUUID();
  await client.query(
    `insert into fraud_signal (
       id, party_id, application_id, signal_kind, severity, detail, detected_at
     ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      id,
      input.partyId ?? null,
      input.applicationId ?? null,
      input.signalKind,
      input.severity,
      JSON.stringify(input.detail),
      clock.now(),
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'fraud_signal',
    aggregateId: id,
    eventType: 'fraud_signal.recorded',
    payload: {
      signal_kind: input.signalKind,
      severity: input.severity,
      application_id: input.applicationId ?? null,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });
  return id;
}

/**
 * Velocity + device checks. Nothing auto-rejects — signals go to review queue.
 */
export async function evaluateFraudSignals(
  client: DbClient,
  input: {
    partyId: string;
    applicationId: string;
    deviceId?: string | null;
    clock?: Clock;
  },
): Promise<string[]> {
  const clock = input.clock ?? systemClock;
  const thresholds = await resolveFraudThresholds(client, clock);
  const signalIds: string[] = [];

  if (input.deviceId) {
    const windowHours = Number(thresholds.device_window_hours ?? 24);
    const maxApps = Number(thresholds.device_max_applications ?? 5);
    const since = new Date(clock.now().getTime() - windowHours * 3600000);
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from application
       where device_id = $1 and created_at >= $2`,
      [input.deviceId, since],
    );
    if (Number(rows[0]?.n ?? 0) > maxApps) {
      const id = await recordFraudSignal(client, {
        partyId: input.partyId,
        applicationId: input.applicationId,
        signalKind: 'device_velocity',
        severity: 'high',
        detail: {
          device_id_present: true,
          count: Number(rows[0]!.n),
          threshold: maxApps,
        },
        clock,
      });
      signalIds.push(id);
    }
  }

  const partyWindowHours = Number(thresholds.party_window_hours ?? 24);
  const partyMax = Number(thresholds.party_max_applications ?? 10);
  const partySince = new Date(clock.now().getTime() - partyWindowHours * 3600000);
  const { rows: partyCount } = await client.query<{ n: string }>(
    `select count(*)::text as n from application
     where party_id = $1 and created_at >= $2`,
    [input.partyId, partySince],
  );
  if (Number(partyCount[0]?.n ?? 0) > partyMax) {
    const id = await recordFraudSignal(client, {
      partyId: input.partyId,
      applicationId: input.applicationId,
      signalKind: 'party_velocity',
      severity: 'medium',
      detail: {
        count: Number(partyCount[0]!.n),
        threshold: partyMax,
      },
      clock,
    });
    signalIds.push(id);
  }

  return signalIds;
}

export async function confirmFraud(
  client: DbClient,
  signalId: string,
  reviewerPartyId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const { rows } = await client.query<{ party_id: string | null }>(
    `update fraud_signal
     set review_status = 'confirmed_fraud',
         reviewed_by_party_id = $2,
         reviewed_at = $3
     where id = $1
     returning party_id`,
    [signalId, reviewerPartyId, clock.now()],
  );
  if (rows[0]?.party_id) {
    await client.query(
      `update party_features
       set fraud_flag_count = fraud_flag_count + 1, updated_at = $2
       where party_id = $1`,
      [rows[0].party_id, clock.now()],
    );
  }
  await emitDomainEvent(client, {
    aggregateType: 'fraud_signal',
    aggregateId: signalId,
    eventType: 'fraud_signal.confirmed',
    payload: { reviewed_by_party_id: reviewerPartyId },
    actorPartyId: reviewerPartyId,
    actorKind: 'admin',
    occurredAt: clock.now(),
  });
}

export async function listReviewQueue(
  client: DbClient,
): Promise<
  Array<{
    id: string;
    signal_kind: string;
    severity: string;
    application_id: string | null;
    party_id: string | null;
    detected_at: Date;
  }>
> {
  const { rows } = await client.query<{
    id: string;
    signal_kind: string;
    severity: string;
    application_id: string | null;
    party_id: string | null;
    detected_at: Date;
  }>(
    `select id, signal_kind, severity, application_id, party_id, detected_at
     from fraud_signal
     where review_status = 'pending'
     order by detected_at asc`,
  );
  return rows;
}
