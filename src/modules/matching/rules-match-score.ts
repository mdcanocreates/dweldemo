/**
 * Part L — rules_based_v1 match score (NOT a trained model).
 */

import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export const MATCH_SCORE_VERSION = 'rules_based_v1' as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function incomeScore(monthlyGrossCents: number | null, rentCents: number): number {
  if (!monthlyGrossCents || rentCents <= 0) return 0;
  const ratio = monthlyGrossCents / rentCents;
  if (ratio >= 3) return 40;
  if (ratio <= 2) return 0;
  return ((ratio - 2) / 1) * 40;
}

function moveInScore(
  urgency: string | null,
  availableOn: Date | null,
): number {
  // Exact match window = full 25; mismatch scales down.
  if (!urgency) return 8;
  const days =
    availableOn != null
      ? Math.round((availableOn.getTime() - Date.now()) / 86400000)
      : null;
  const map: Record<string, [number, number]> = {
    immediate: [0, 14],
    within_30_days: [0, 30],
    within_60_days: [15, 60],
    within_90_days: [30, 90],
    flexible: [0, 180],
  };
  const window = map[urgency];
  if (!window) return 10;
  if (days == null) return 18;
  if (days >= window[0] && days <= window[1]) return 25;
  const dist = days < window[0] ? window[0] - days : days - window[1];
  return clamp(25 - dist * 0.4, 0, 25);
}

function completenessScore(intake: Record<string, unknown> | null): number {
  if (!intake) return 0;
  const fields = [
    'current_address_line1',
    'current_address_city',
    'current_address_state',
    'current_address_move_in',
    'employer_name',
    'job_title',
    'employer_phone',
    'employment_length_months',
    'monthly_gross_income_cents',
    'emergency_contact',
  ];
  let filled = 0;
  for (const f of fields) {
    const v = intake[f];
    if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) filled += 1;
  }
  const occ = intake.occupants;
  if (Array.isArray(occ) && occ.length > 0) filled += 1;
  const pets = intake.pets;
  if (Array.isArray(pets)) filled += 1; // answered (even empty array after form)
  return (filled / 12) * 20;
}

function tenureScore(profileCreatedAt: Date | null): number {
  if (!profileCreatedAt) return 5;
  const hours = (Date.now() - profileCreatedAt.getTime()) / 3600000;
  if (hours < 24) return 3;
  if (hours < 24 * 7) return 8;
  if (hours < 24 * 30) return 12;
  return 15;
}

export async function computeAndStoreRulesMatchScore(
  client: DbClient,
  applicationId: string,
): Promise<{
  match_score_value: number;
  match_score_version: typeof MATCH_SCORE_VERSION;
  components: Record<string, number>;
}> {
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    rent_amount_cents: number;
    available_on: Date | null;
    move_in_urgency: string | null;
    annual_income_cents: number | null;
    profile_created_at: Date | null;
    monthly_gross_income_cents: number | null;
    intake: Record<string, unknown> | null;
  }>(
    `select a.id, a.party_id, l.rent_amount_cents, l.available_on,
            rp.move_in_urgency, rp.annual_income_cents, rp.created_at as profile_created_at,
            rai.monthly_gross_income_cents,
            case when rai.party_id is null then null else to_jsonb(rai) - 'party_id' end as intake
     from application a
     join listing l on l.id = a.listing_id
     join renter_profile rp on rp.id = a.renter_profile_id
     left join renter_application_intake rai on rai.party_id = a.party_id
     where a.id = $1`,
    [applicationId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'application_not_found', 404);

  const monthly =
    row.monthly_gross_income_cents ??
    (row.annual_income_cents != null ? Math.round(row.annual_income_cents / 12) : null);

  const income = incomeScore(monthly, row.rent_amount_cents);
  const moveIn = moveInScore(row.move_in_urgency, row.available_on);
  const completeness = completenessScore(row.intake);
  const tenure = tenureScore(row.profile_created_at);
  const total = Math.round(clamp(income + moveIn + completeness + tenure, 0, 100));
  const components = {
    income_to_rent: Math.round(income * 10) / 10,
    move_in_fit: Math.round(moveIn * 10) / 10,
    completeness: Math.round(completeness * 10) / 10,
    profile_tenure: Math.round(tenure * 10) / 10,
  };

  await client.query(
    `insert into application_match_score_history (application_id, score_value, score_version, components)
     select id, match_score_value, match_score_version, coalesce(match_score_components, '{}'::jsonb)
     from application
     where id = $1 and match_score_value is not null and match_score_version is not null`,
    [applicationId],
  );

  await client.query(
    `update application set
       match_score_value = $2,
       match_score_version = $3,
       match_score_computed_at = now(),
       match_score_components = $4::jsonb
     where id = $1`,
    [applicationId, total, MATCH_SCORE_VERSION, JSON.stringify(components)],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: 'match_score_computed',
    payload: {
      match_score_value: total,
      match_score_version: MATCH_SCORE_VERSION,
      components,
    },
    actorKind: 'system',
  });

  return {
    match_score_value: total,
    match_score_version: MATCH_SCORE_VERSION,
    components,
  };
}
