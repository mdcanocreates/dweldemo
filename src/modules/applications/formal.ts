/**
 * Formal rental applications are separate rows from expressions of interest.
 * Submitting freezes the existing intake snapshot. It does not screen or charge.
 */

import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { getRenterProfile } from '../renter/profile.js';
import {
  getRenterIntake,
  intakeRowReady,
  snapshotIntakeOnApplication,
} from '../renter/intake.js';
import { createPublicApplication, type CreatePublicApplicationResult } from './create.js';

export const FORMAL_SUBMITTED_STATUS = 'submitted';

export function formalApplicationReady(input: {
  intake: Record<string, unknown> | null;
  householdSize: number | null;
}): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!intakeRowReady(input.intake)) {
    missing.push('residence', 'employment');
  }
  const income = input.intake?.monthly_gross_income_cents;
  if (typeof income !== 'number' || !Number.isInteger(income) || income < 0) {
    missing.push('income');
  }
  if (input.householdSize == null || input.householdSize < 1) {
    missing.push('household');
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export async function startFormalApplication(
  client: DbClient,
  input: { partyId: string; listingId: string; deviceId?: string | null },
): Promise<CreatePublicApplicationResult> {
  return createPublicApplication(client, {
    listingId: input.listingId,
    partyId: input.partyId,
    deviceId: input.deviceId ?? null,
    initialStatus: 'draft',
    recordKind: 'formal',
  });
}

export async function submitFormalApplication(
  client: DbClient,
  input: { applicationId: string; partyId: string },
): Promise<{ applicationId: string; status: string; reused: boolean }> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    record_kind: string;
    intake_snapshot: unknown;
    listing_status: string | null;
  }>(
    `select a.id, a.status, a.record_kind, a.intake_snapshot, l.status as listing_status
     from application a
     left join listing l on l.id = a.listing_id
     where a.id = $1 and a.party_id = $2
     for update of a`,
    [input.applicationId, input.partyId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'application_not_found', 404);
  if (row.record_kind !== 'formal') {
    throw new AppError(
      'an expression of interest is not a formal application',
      'interest_is_not_an_application',
      409,
    );
  }
  if (row.status === FORMAL_SUBMITTED_STATUS) {
    if (row.intake_snapshot == null) {
      throw new AppError(
        'this application is marked submitted but has no snapshot',
        'snapshot_absent',
        409,
      );
    }
    return { applicationId: row.id, status: row.status, reused: true };
  }
  if (row.status !== 'draft') {
    throw new AppError('this application cannot be submitted from its current state', 'invalid_transition', 409);
  }
  if (row.listing_status !== 'active') {
    throw new AppError('listing not available', 'listing_not_available', 409);
  }

  const intake = await getRenterIntake(client, input.partyId);
  const profile = await getRenterProfile(client, input.partyId);
  const ready = formalApplicationReady({
    intake,
    householdSize: profile?.household_size ?? null,
  });
  if (!ready.ok) {
    throw new AppError(
      `formal application is missing ${ready.missing.join(', ')}`,
      'formal_incomplete',
      409,
    );
  }

  await snapshotIntakeOnApplication(client, row.id, input.partyId);
  const updated = await client.query<{ id: string }>(
    `update application
     set status = $3, submitted_at = coalesce(submitted_at, now())
     where id = $1 and party_id = $2 and record_kind = 'formal' and status = 'draft'
     returning id`,
    [row.id, input.partyId, FORMAL_SUBMITTED_STATUS],
  );
  if (!updated.rows[0]) {
    const again = await client.query<{ status: string; intake_snapshot: unknown }>(
      `select status, intake_snapshot from application where id = $1 and party_id = $2`,
      [row.id, input.partyId],
    );
    if (again.rows[0]?.status === FORMAL_SUBMITTED_STATUS && again.rows[0].intake_snapshot != null) {
      return { applicationId: row.id, status: FORMAL_SUBMITTED_STATUS, reused: true };
    }
    throw new AppError('formal application was not submitted', 'formal_submit_failed', 409);
  }
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: row.id,
    eventType: 'application.formal_submitted',
    payload: { record_kind: 'formal', status: FORMAL_SUBMITTED_STATUS },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });
  return { applicationId: row.id, status: FORMAL_SUBMITTED_STATUS, reused: false };
}
