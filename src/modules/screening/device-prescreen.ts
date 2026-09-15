/**
 * B-3 — Device-based fraud prescreen before Certn pull.
 * Thresholds from fraud_thresholds config — not code literals.
 */

import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { resolveFraudThresholds } from './config.js';
import { recordFraudSignal } from './fraud.js';

export type DevicePrescreenResult = {
  passed: boolean;
  /** Internal only — never surface to applicant. */
  breachReasons: string[];
  severity: 'low' | 'medium' | 'high' | null;
  signalId: string | null;
  /** Safe message for applicant. */
  applicantMessage: string;
};

const GENERIC_DECLINE =
  'We could not proceed with your application at this time. Please contact support if you need help.';

function severityForOvershoot(count: number, threshold: number): 'medium' | 'high' {
  return count >= threshold * 2 ? 'high' : 'medium';
}

export async function runDevicePrescreen(
  client: DbClient,
  input: {
    applicationId: string;
    partyId: string;
    deviceId: string;
    clock?: Clock;
  },
): Promise<DevicePrescreenResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const thresholds = await resolveFraudThresholds(client, clock);

  const identityThreshold = Number(
    thresholds.device_identity_count_30d_threshold ?? 3,
  );
  const appThreshold = Number(
    thresholds.device_application_count_24h_threshold ?? 5,
  );
  const partyDeviceThreshold = Number(
    thresholds.party_device_count_7d_threshold ?? 4,
  );

  // 1. Upsert fingerprint + identity edge
  await client.query(
    `insert into device_identity_edge (device_id, party_id, first_seen_at)
     values ($1, $2, $3)
     on conflict (device_id, party_id) do nothing`,
    [input.deviceId, input.partyId, now],
  );

  await client.query(
    `insert into device_fingerprint (
       device_id, party_id, first_seen_at, last_seen_at, application_count, identity_count
     ) values ($1, $2, $3, $3, 1, 1)
     on conflict (device_id, party_id) do update
       set last_seen_at = excluded.last_seen_at,
           application_count = device_fingerprint.application_count + 1`,
    [input.deviceId, input.partyId, now],
  );

  const since30d = new Date(now.getTime() - 30 * 86_400_000);
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const since24h = new Date(now.getTime() - 24 * 3_600_000);

  const { rows: idCount } = await client.query<{ n: string }>(
    `select count(distinct party_id)::text as n
     from device_identity_edge
     where device_id = $1 and first_seen_at >= $2`,
    [input.deviceId, since30d],
  );
  const identityCount = Number(idCount[0]?.n ?? 0);

  const { rows: deviceCount } = await client.query<{ n: string }>(
    `select count(distinct device_id)::text as n
     from device_identity_edge
     where party_id = $1 and first_seen_at >= $2`,
    [input.partyId, since7d],
  );
  const partyDevices = Number(deviceCount[0]?.n ?? 0);

  const { rows: appCount } = await client.query<{ n: string }>(
    `select count(*)::text as n from application
     where device_id = $1 and created_at >= $2`,
    [input.deviceId, since24h],
  );
  const apps24h = Number(appCount[0]?.n ?? 0);

  // Refresh identity_count on fingerprint row
  await client.query(
    `update device_fingerprint
     set identity_count = $3
     where device_id = $1 and party_id = $2`,
    [input.deviceId, input.partyId, identityCount],
  );

  const breachReasons: string[] = [];
  let severity: 'low' | 'medium' | 'high' | null = null;

  if (identityCount >= identityThreshold) {
    breachReasons.push('device_identity_count_30d');
    severity = severityForOvershoot(identityCount, identityThreshold);
  }
  if (partyDevices >= partyDeviceThreshold) {
    breachReasons.push('party_device_count_7d');
    const s = severityForOvershoot(partyDevices, partyDeviceThreshold);
    severity = severity === 'high' ? 'high' : s;
  }
  if (apps24h >= appThreshold) {
    breachReasons.push('device_application_count_24h');
    const s = severityForOvershoot(apps24h, appThreshold);
    severity = severity === 'high' ? 'high' : s;
  }

  if (breachReasons.length === 0) {
    return {
      passed: true,
      breachReasons: [],
      severity: null,
      signalId: null,
      applicantMessage: '',
    };
  }

  await client.query(
    `update device_fingerprint
     set is_flagged = true, flagged_at = $3, flagged_reason = $4
     where device_id = $1 and party_id = $2`,
    [input.deviceId, input.partyId, now, breachReasons.join(',')],
  );

  const signalId = await recordFraudSignal(client, {
    partyId: input.partyId,
    applicationId: input.applicationId,
    signalKind: 'device_velocity',
    severity: severity ?? 'medium',
    detail: {
      reasons: breachReasons,
      identity_count_30d: identityCount,
      party_device_count_7d: partyDevices,
      device_application_count_24h: apps24h,
      thresholds: {
        device_identity_count_30d_threshold: identityThreshold,
        party_device_count_7d_threshold: partyDeviceThreshold,
        device_application_count_24h_threshold: appThreshold,
      },
      // never put internal reason in applicant-facing fields
    },
    clock,
  });

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'application_prescreen_failed',
    payload: {
      signal_id: signalId,
      // reason codes are internal; applicant sees generic message only
      applicant_message: GENERIC_DECLINE,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return {
    passed: false,
    breachReasons,
    severity,
    signalId,
    applicantMessage: GENERIC_DECLINE,
  };
}

/**
 * Admin clears device-velocity signal and resumes application at prescreen.
 */
export async function clearPrescreenAndResume(
  client: DbClient,
  input: {
    applicationId: string;
    signalId: string;
    reviewerPartyId: string;
    clock?: Clock;
  },
): Promise<{ status: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  await client.query(
    `update fraud_signal
     set review_status = 'cleared',
         reviewed_by_party_id = $2,
         reviewed_at = $3
     where id = $1`,
    [input.signalId, input.reviewerPartyId, now],
  );

  const { rows } = await client.query<{ status: string }>(
    `select status from application where id = $1 for update`,
    [input.applicationId],
  );
  if (!rows[0]) throw new Error('application not found');
  if (rows[0].status !== 'prescreen_failed') {
    throw new Error(`expected prescreen_failed, was ${rows[0].status}`);
  }

  await client.query(`update application set status = 'prescreen' where id = $1`, [
    input.applicationId,
  ]);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'application.prescreen_cleared',
    payload: {
      signal_id: input.signalId,
      reviewed_by_party_id: input.reviewerPartyId,
    },
    actorPartyId: input.reviewerPartyId,
    actorKind: 'admin',
    occurredAt: now,
  });

  return { status: 'prescreen' };
}

export const DEVICE_PRESCREEN_GENERIC_MESSAGE = GENERIC_DECLINE;
