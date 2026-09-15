import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { computeAndStoreRulesMatchScore } from '../matching/rules-match-score.js';
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
  await client.query(
    `insert into renter_application_intake (
       party_id, current_address_line1, current_address_city, current_address_state,
       current_address_postal, current_address_move_in, employer_name, job_title,
       employer_phone, employment_length_months, monthly_gross_income_cents,
       occupants, pets, emergency_contact, vehicle, completed_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,
       coalesce($12::jsonb, '[]'::jsonb),
       coalesce($13::jsonb, '[]'::jsonb),
       $14::jsonb, $15::jsonb,
       case when $16 then now() else null end,
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
       occupants = coalesce(excluded.occupants, renter_application_intake.occupants),
       pets = coalesce(excluded.pets, renter_application_intake.pets),
       emergency_contact = coalesce(excluded.emergency_contact, renter_application_intake.emergency_contact),
       vehicle = coalesce(excluded.vehicle, renter_application_intake.vehicle),
       completed_at = case
         when $16 then now()
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
      input.occupants != null ? JSON.stringify(input.occupants) : null,
      input.pets != null ? JSON.stringify(input.pets) : null,
      input.emergency_contact != null ? JSON.stringify(input.emergency_contact) : null,
      input.vehicle != null ? JSON.stringify(input.vehicle) : null,
      Boolean(input.mark_complete),
    ],
  );

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
  await client.query(
    `update application
     set intake_snapshot = $2::jsonb
     where id = $1
       and (intake_snapshot is null)`,
    [applicationId, JSON.stringify(snapshot)],
  );
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