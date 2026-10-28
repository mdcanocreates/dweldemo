import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { computeAndStoreRulesMatchScore } from '../matching/index.js';
import { shouldFreezeIntakeSnapshot } from './dossier-view.js';
import {
  INTAKE_FROZEN_EVENT,
  classifySnapshotRecovery,
  type SnapshotRecovery,
} from './lifecycle.js';
import { getRenterProfile } from './profile.js';

export type IntakePayload = {
  current_address_line1?: string | null;
  current_address_city?: string | null;
  current_address_state?: string | null;
  current_address_postal?: string | null;
  current_address_move_in?: string | null;
  employer_name?: string | null;
  job_title?: string | null;
  employer_phone?: string | null;
  employment_length_months?: number | null;
  monthly_gross_income_cents?: number | null;
  preferred_lease_term_months?: number | null;
  occupants?: unknown[];
  pets?: unknown[];
  emergency_contact?: unknown | null;
  vehicle?: unknown | null;
  mark_complete?: boolean;
};

export async function getRenterIntake(
  client: DbClient,
  partyId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query(
    `select * from renter_application_intake where party_id = $1`,
    [partyId],
  );
  return rows[0] ?? null;
}

export async function upsertRenterIntake(
  client: DbClient,
  partyId: string,
  input: IntakePayload,
): Promise<Record<string, unknown>> {
  const leaseTerm =
    input.preferred_lease_term_months != null &&
    Number.isFinite(input.preferred_lease_term_months) &&
    input.preferred_lease_term_months > 0
      ? Math.trunc(input.preferred_lease_term_months)
      : null;

  if (input.mark_complete) {
    const existing = await getRenterIntake(client, partyId);
    const merged: Record<string, unknown> = { ...(existing ?? {}) };
    const keep = (key: (typeof INTAKE_READY_FIELDS)[number], value: string | null | undefined) => {
      if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
    };
    keep('current_address_line1', input.current_address_line1);
    keep('current_address_city', input.current_address_city);
    keep('current_address_state', input.current_address_state);
    keep('current_address_postal', input.current_address_postal);
    keep('employer_name', input.employer_name);
    keep('job_title', input.job_title);
    if (!intakeRowReady(merged)) {
      throw new AppError(
        'current address and employment are required before intake can be completed',
        'intake_incomplete',
        400,
      );
    }
  }

  await client.query(
    `insert into renter_application_intake (
       party_id, current_address_line1, current_address_city, current_address_state,
       current_address_postal, current_address_move_in, employer_name, job_title,
       employer_phone, employment_length_months, monthly_gross_income_cents,
       preferred_lease_term_months,
       occupants, pets, emergency_contact, vehicle, completed_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,
       coalesce($13::jsonb, '[]'::jsonb),
       coalesce($14::jsonb, '[]'::jsonb),
       $15::jsonb, $16::jsonb,
       case when $17 then now() else null end,
       now()
     )
     on conflict (party_id) do update set
       current_address_line1 = coalesce(excluded.current_address_line1, renter_application_intake.current_address_line1),
       current_address_city = coalesce(excluded.current_address_city, renter_application_intake.current_address_city),
       current_address_state = coalesce(excluded.current_address_state, renter_application_intake.current_address_state),
       current_address_postal = coalesce(excluded.current_address_postal, renter_application_intake.current_address_postal),
       current_address_move_in = coalesce(excluded.current_address_move_in, renter_application_intake.current_address_move_in),
       employer_name = coalesce(excluded.employer_name, renter_application_intake.employer_name),
       job_title = coalesce(excluded.job_title, renter_application_intake.job_title),
       employer_phone = coalesce(excluded.employer_phone, renter_application_intake.employer_phone),
       employment_length_months = coalesce(excluded.employment_length_months, renter_application_intake.employment_length_months),
       monthly_gross_income_cents = coalesce(excluded.monthly_gross_income_cents, renter_application_intake.monthly_gross_income_cents),
       preferred_lease_term_months = coalesce(excluded.preferred_lease_term_months, renter_application_intake.preferred_lease_term_months),
       occupants = coalesce(excluded.occupants, renter_application_intake.occupants),
       pets = coalesce(excluded.pets, renter_application_intake.pets),
       emergency_contact = coalesce(excluded.emergency_contact, renter_application_intake.emergency_contact),
       vehicle = coalesce(excluded.vehicle, renter_application_intake.vehicle),
       completed_at = case
         when $17 then now()
         else renter_application_intake.completed_at
       end,
       updated_at = now()`,
    [
      partyId,
      input.current_address_line1 ?? null,
      input.current_address_city ?? null,
      input.current_address_state ?? null,
      input.current_address_postal ?? null,
      input.current_address_move_in ?? null,
      input.employer_name ?? null,
      input.job_title ?? null,
      input.employer_phone ?? null,
      input.employment_length_months ?? null,
      input.monthly_gross_income_cents ?? null,
      leaseTerm,
      input.occupants != null ? JSON.stringify(input.occupants) : null,
      input.pets != null ? JSON.stringify(input.pets) : null,
      input.emergency_contact != null ? JSON.stringify(input.emergency_contact) : null,
      input.vehicle != null ? JSON.stringify(input.vehicle) : null,
      Boolean(input.mark_complete),
    ],
  );

  if (leaseTerm != null) {
    await client.query(
      `update renter_profile
       set preferred_lease_term_months = coalesce($2, preferred_lease_term_months),
           updated_at = now()
       where party_id = $1`,
      [partyId, leaseTerm],
    );
  }

  // Mirror monthly income onto renter_profile annual when provided
  if (input.monthly_gross_income_cents != null) {
    await client.query(
      `update renter_profile set
         annual_income_cents = $2 * 12,
         has_pets = case
           when $3::jsonb is not null then jsonb_array_length($3::jsonb) > 0
           else has_pets
         end,
         updated_at = now()
       where party_id = $1`,
      [
        partyId,
        input.monthly_gross_income_cents,
        input.pets != null ? JSON.stringify(input.pets) : null,
      ],
    );
  }

  const row = await getRenterIntake(client, partyId);
  if (!row) throw new AppError('intake save failed', 'intake_failed', 500);
  return row;
}

const INTAKE_READY_FIELDS = [
  'current_address_line1',
  'current_address_city',
  'current_address_state',
  'current_address_postal',
  'employer_name',
  'job_title',
] as const;

/** Residence and employment must be present before an intake can be marked complete. */
export function intakeRowReady(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return INTAKE_READY_FIELDS.every((key) => {
    const value = row[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export async function isIntakeComplete(client: DbClient, partyId: string): Promise<boolean> {
  const { rows } = await client.query<{ completed_at: Date | null }>(
    `select completed_at from renter_application_intake where party_id = $1`,
    [partyId],
  );
  return Boolean(rows[0]?.completed_at);
}

/**
 * Freeze current dossier onto the application at submit time.
 * Later edits to renter_application_intake must not rewrite this snapshot.
 */
export async function snapshotIntakeOnApplication(
  client: DbClient,
  applicationId: string,
  partyId: string,
): Promise<void> {
  const existing = await client.query<{ intake_snapshot: unknown }>(
    `select intake_snapshot from application where id = $1`,
    [applicationId],
  );
  if (!shouldFreezeIntakeSnapshot(existing.rows[0]?.intake_snapshot)) return;

  const intake = await getRenterIntake(client, partyId);
  const profile = await getRenterProfile(client, partyId);
  const snapshot = {
    captured_at: new Date().toISOString(),
    contact: profile
      ? {
          given_name: profile.given_name,
          family_name: profile.family_name,
          email: profile.email,
          phone_e164: profile.phone_e164,
        }
      : null,
    intake,
  };
  const preferredLease =
    (intake &&
    typeof intake === 'object' &&
    'preferred_lease_term_months' in intake &&
    intake.preferred_lease_term_months != null
      ? Number(intake.preferred_lease_term_months)
      : null) ??
    profile?.preferred_lease_term_months ??
    null;

  const written = await client.query<{ id: string }>(
    `update application
     set intake_snapshot = $2::jsonb,
         preferred_lease_term_months = coalesce(
           preferred_lease_term_months,
           $3
         )
     where id = $1
       and (intake_snapshot is null)
     returning id`,
    [
      applicationId,
      JSON.stringify(snapshot),
      preferredLease != null && Number.isFinite(preferredLease) && preferredLease > 0
        ? Math.trunc(preferredLease)
        : null,
    ],
  );
  if (!written.rows[0]) return;
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: INTAKE_FROZEN_EVENT,
    payload: {
      source: INTAKE_FROZEN_EVENT,
      snapshot,
    },
    actorPartyId: partyId,
    actorKind: 'user',
  });
}

/**
 * Fill a null snapshot from the freeze event for this application.
 * A stored snapshot is never replaced. A current profile or intake row is never copied in.
 */
export async function restoreSnapshotFromFreezeEvent(
  client: DbClient,
  applicationId: string,
): Promise<SnapshotRecovery & { written: boolean }> {
  const existing = await client.query<{ intake_snapshot: unknown }>(
    `select intake_snapshot from application where id = $1 for update`,
    [applicationId],
  );
  if (!existing.rows[0]) {
    throw new AppError('application not found', 'application_not_found', 404);
  }
  if (existing.rows[0].intake_snapshot != null) {
    return {
      ...classifySnapshotRecovery({
        intakeSnapshot: existing.rows[0].intake_snapshot,
        freezeEventPayload: null,
      }),
      written: false,
    };
  }
  const events = await client.query<{ payload: unknown }>(
    `select payload
       from domain_event
      where aggregate_type = 'application'
        and aggregate_id = $1
        and event_type = $2
      order by seq desc
      limit 1`,
    [applicationId, INTAKE_FROZEN_EVENT],
  );
  const decision = classifySnapshotRecovery({
    intakeSnapshot: null,
    freezeEventPayload: events.rows[0]?.payload ?? null,
  });
  if (decision.classification !== 'recoverable_from_freeze_event' || !decision.snapshot) {
    return { ...decision, written: false };
  }
  const updated = await client.query<{ id: string }>(
    `update application
        set intake_snapshot = $2::jsonb
      where id = $1
        and intake_snapshot is null
      returning id`,
    [applicationId, JSON.stringify(decision.snapshot)],
  );
  return { ...decision, written: updated.rows.length === 1 };
}

export async function getApplicationIntakeDetail(
  client: DbClient,
  input: { applicationId: string; partyId: string },
): Promise<{
  application_id: string;
  listing_id: string | null;
  status: string;
  snapshot: unknown;
  live_intake: Record<string, unknown> | null;
  snapshot_is_frozen: boolean;
}> {
  const { rows } = await client.query<{
    id: string;
    listing_id: string | null;
    status: string;
    party_id: string;
    intake_snapshot: unknown;
  }>(
    `select id, listing_id, status, party_id, intake_snapshot
     from application where id = $1`,
    [input.applicationId],
  );
  const row = rows[0];
  if (!row || row.party_id !== input.partyId) {
    throw new AppError('application not found', 'application_not_found', 404);
  }
  const live = await getRenterIntake(client, input.partyId);
  return {
    application_id: row.id,
    listing_id: row.listing_id,
    status: row.status,
    snapshot: row.intake_snapshot,
    live_intake: live,
    snapshot_is_frozen: row.intake_snapshot != null,
  };
}

export { computeAndStoreRulesMatchScore };