import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export type CriteriaRules = {
  min_income_to_rent_ratio?: number;
  move_in_window_days?: number;
  pets_allowed?: boolean;
  max_occupants?: number;
  lease_term_months?: number | number[];
  require_complete_profile?: boolean;
};

export type PrequalCheckResult = 'meets' | 'does_not_meet' | 'unknown';

export type PrequalCheck = {
  key: string;
  label: string;
  result: PrequalCheckResult;
  detail: string;
  self_reported: boolean;
};

export type PrequalEvaluation = {
  appears_to_meet: boolean;
  checks: PrequalCheck[];
  criteria_version_id: string | null;
  evaluated_at: string;
};

export type ListingCriteriaRow = {
  id: string;
  listing_id: string;
  org_id: string;
  version: number;
  jurisdiction: string | null;
  rules: CriteriaRules;
  effective_at: string;
  created_by_party_id: string | null;
  superseded_at: string | null;
};

const URGENCY_WINDOWS: Record<string, [number, number]> = {
  immediate: [0, 14],
  within_30_days: [0, 30],
  within_60_days: [15, 60],
  within_90_days: [30, 90],
  flexible: [0, 180],
};

export function normalizeCriteriaRules(raw: unknown): CriteriaRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const rules: CriteriaRules = {};
  if (typeof o.min_income_to_rent_ratio === 'number' && Number.isFinite(o.min_income_to_rent_ratio)) {
    rules.min_income_to_rent_ratio = o.min_income_to_rent_ratio;
  }
  if (typeof o.move_in_window_days === 'number' && Number.isFinite(o.move_in_window_days)) {
    rules.move_in_window_days = Math.trunc(o.move_in_window_days);
  }
  if (typeof o.pets_allowed === 'boolean') rules.pets_allowed = o.pets_allowed;
  if (typeof o.max_occupants === 'number' && Number.isFinite(o.max_occupants)) {
    rules.max_occupants = Math.trunc(o.max_occupants);
  }
  if (typeof o.lease_term_months === 'number' && Number.isFinite(o.lease_term_months)) {
    rules.lease_term_months = Math.trunc(o.lease_term_months);
  } else if (Array.isArray(o.lease_term_months)) {
    rules.lease_term_months = o.lease_term_months
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      .map((n) => Math.trunc(n));
  }
  if (typeof o.require_complete_profile === 'boolean') {
    rules.require_complete_profile = o.require_complete_profile;
  }
  return rules;
}

/**
 * Pure prequal evaluation against listing criteria rules.
 * Self-reported income/pets/occupancy — not an FCRA consumer report.
 */
export function evaluatePrequalAgainstRules(input: {
  rules: CriteriaRules;
  rentAmountCents: number;
  monthlyIncomeCents: number | null;
  moveInUrgency: string | null;
  availableOn: Date | null;
  hasPets: boolean | null;
  householdSize: number | null;
  occupantsCount: number | null;
  preferredLeaseTermMonths: number | null;
  listingLeaseTermMonths: number | null;
  profileComplete: boolean;
  now?: Date;
}): Omit<PrequalEvaluation, 'criteria_version_id' | 'evaluated_at'> {
  const rules = input.rules;
  const checks: PrequalCheck[] = [];
  const now = input.now ?? new Date();

  if (rules.min_income_to_rent_ratio != null) {
    if (input.monthlyIncomeCents == null || input.rentAmountCents <= 0) {
      checks.push({
        key: 'income',
        label: 'Income requirement',
        result: 'unknown',
        detail: 'Self-reported income not available to compare against rent',
        self_reported: true,
      });
    } else {
      const ratio = input.monthlyIncomeCents / input.rentAmountCents;
      const meets = ratio + 1e-9 >= rules.min_income_to_rent_ratio;
      checks.push({
        key: 'income',
        label: 'Income requirement',
        result: meets ? 'meets' : 'does_not_meet',
        detail: meets
          ? `Appears to meet based on self-reported income (${ratio.toFixed(2)}x rent; need ${rules.min_income_to_rent_ratio}x)`
          : `Self-reported income ratio ${ratio.toFixed(2)}x is below ${rules.min_income_to_rent_ratio}x rent`,
        self_reported: true,
      });
    }
  }

  if (rules.move_in_window_days != null) {
    if (!input.moveInUrgency) {
      checks.push({
        key: 'move_in',
        label: 'Move-in timing',
        result: 'unknown',
        detail: 'Move-in preference not provided',
        self_reported: true,
      });
    } else {
      const urgencyWindow = URGENCY_WINDOWS[input.moveInUrgency];
      const daysUntilAvailable =
        input.availableOn != null
          ? Math.round((input.availableOn.getTime() - now.getTime()) / 86400000)
          : 0;
      const windowDays = rules.move_in_window_days;
      let meets = true;
      if (urgencyWindow) {
        const [lo, hi] = urgencyWindow;
        const overlaps =
          daysUntilAvailable <= Math.max(hi, windowDays) &&
          daysUntilAvailable + windowDays >= lo;
        meets = overlaps;
      }
      checks.push({
        key: 'move_in',
        label: 'Move-in timing',
        result: meets ? 'meets' : 'does_not_meet',
        detail: meets
          ? 'Matches listing availability window (self-reported)'
          : 'Self-reported move-in timing does not match availability window',
        self_reported: true,
      });
    }
  }

  if (rules.pets_allowed != null) {
    if (input.hasPets == null) {
      checks.push({
        key: 'pets',
        label: 'Pet policy',
        result: 'unknown',
        detail: 'Pet preference not provided',
        self_reported: true,
      });
    } else if (rules.pets_allowed === false && input.hasPets) {
      checks.push({
        key: 'pets',
        label: 'Pet policy',
        result: 'does_not_meet',
        detail: 'Self-reported pets conflict with no-pets criteria',
        self_reported: true,
      });
    } else {
      checks.push({
        key: 'pets',
        label: 'Pet policy',
        result: 'meets',
        detail: 'Matches pet policy (self-reported)',
        self_reported: true,
      });
    }
  }

  if (rules.max_occupants != null) {
    const occ = input.occupantsCount ?? input.householdSize;
    if (occ == null) {
      checks.push({
        key: 'occupancy',
        label: 'Occupancy',
        result: 'unknown',
        detail: 'Occupant count not provided',
        self_reported: true,
      });
    } else {
      const meets = occ <= rules.max_occupants;
      checks.push({
        key: 'occupancy',
        label: 'Occupancy',
        result: meets ? 'meets' : 'does_not_meet',
        detail: meets
          ? `Occupants (${occ}) within max ${rules.max_occupants} (self-reported)`
          : `Occupants (${occ}) exceed max ${rules.max_occupants} (self-reported)`,
        self_reported: true,
      });
    }
  }

  if (rules.lease_term_months != null) {
    const allowed = Array.isArray(rules.lease_term_months)
      ? rules.lease_term_months
      : [rules.lease_term_months];
    const preferred = input.preferredLeaseTermMonths ?? input.listingLeaseTermMonths;
    if (preferred == null) {
      checks.push({
        key: 'lease_term',
        label: 'Lease term',
        result: 'unknown',
        detail: 'Preferred lease term not provided',
        self_reported: true,
      });
    } else {
      const meets = allowed.includes(preferred);
      checks.push({
        key: 'lease_term',
        label: 'Lease term',
        result: meets ? 'meets' : 'does_not_meet',
        detail: meets
          ? `Lease term ${preferred} months matches criteria`
          : `Lease term ${preferred} months not in allowed ${allowed.join(', ')}`,
        self_reported: true,
      });
    }
  }

  if (rules.require_complete_profile) {
    checks.push({
      key: 'profile',
      label: 'Complete profile',
      result: input.profileComplete ? 'meets' : 'does_not_meet',
      detail: input.profileComplete
        ? 'Profile/intake appears complete'
        : 'Incomplete profile / missing intake',
      self_reported: true,
    });
  }

  // Appears to meet when no explicit failures; unknowns do not fail the aggregate.
  const hardFail = checks.some((c) => c.result === 'does_not_meet');
  return { appears_to_meet: !hardFail, checks };
}

function mapCriteriaRow(row: {
  id: string;
  listing_id: string;
  org_id: string;
  version: number;
  jurisdiction: string | null;
  rules: unknown;
  effective_at: Date;
  created_by_party_id: string | null;
  superseded_at: Date | null;
}): ListingCriteriaRow {
  return {
    id: row.id,
    listing_id: row.listing_id,
    org_id: row.org_id,
    version: row.version,
    jurisdiction: row.jurisdiction,
    rules: normalizeCriteriaRules(row.rules),
    effective_at: row.effective_at.toISOString(),
    created_by_party_id: row.created_by_party_id,
    superseded_at: row.superseded_at?.toISOString() ?? null,
  };
}

export async function getActiveCriteria(
  client: DbClient,
  listingId: string,
): Promise<ListingCriteriaRow | null> {
  const { rows } = await client.query<{
    id: string;
    listing_id: string;
    org_id: string;
    version: number;
    jurisdiction: string | null;
    rules: unknown;
    effective_at: Date;
    created_by_party_id: string | null;
    superseded_at: Date | null;
  }>(
    `select id, listing_id, org_id, version, jurisdiction, rules,
            effective_at, created_by_party_id, superseded_at
     from listing_criteria
     where listing_id = $1 and superseded_at is null
     limit 1`,
    [listingId],
  );
  return rows[0] ? mapCriteriaRow(rows[0]) : null;
}

export async function upsertCriteria(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    actorPartyId: string;
    jurisdiction?: string | null;
    rules: CriteriaRules;
  },
): Promise<ListingCriteriaRow> {
  const { rows: listing } = await client.query<{ id: string }>(
    `select id from listing where id = $1 and org_id = $2`,
    [input.listingId, input.orgId],
  );
  if (!listing[0]) throw new AppError('listing not found', 'listing_not_found', 404);

  const rules = normalizeCriteriaRules(input.rules);
  const jurisdiction =
    input.jurisdiction != null ? input.jurisdiction.trim().toUpperCase().slice(0, 2) : null;

  await client.query(
    `update listing_criteria
     set superseded_at = now()
     where listing_id = $1 and superseded_at is null`,
    [input.listingId],
  );

  const { rows: ver } = await client.query<{ n: string }>(
    `select coalesce(max(version), 0)::text as n from listing_criteria where listing_id = $1`,
    [input.listingId],
  );
  const nextVersion = Number(ver[0]?.n ?? 0) + 1;

  const { rows } = await client.query<{
    id: string;
    listing_id: string;
    org_id: string;
    version: number;
    jurisdiction: string | null;
    rules: unknown;
    effective_at: Date;
    created_by_party_id: string | null;
    superseded_at: Date | null;
  }>(
    `insert into listing_criteria (
       listing_id, org_id, version, jurisdiction, rules, created_by_party_id
     ) values ($1,$2,$3,$4,$5::jsonb,$6)
     returning id, listing_id, org_id, version, jurisdiction, rules,
               effective_at, created_by_party_id, superseded_at`,
    [
      input.listingId,
      input.orgId,
      nextVersion,
      jurisdiction,
      JSON.stringify(rules),
      input.actorPartyId,
    ],
  );
  const created = mapCriteriaRow(rows[0]!);

  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: input.listingId,
    eventType: 'listing.criteria_updated',
    payload: {
      criteria_version_id: created.id,
      version: created.version,
      jurisdiction: created.jurisdiction,
      rules: created.rules,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return created;
}

export async function evaluatePrequal(
  client: DbClient,
  input: { applicationId: string; listingId: string },
): Promise<PrequalEvaluation> {
  const { rows } = await client.query<{
    rent_amount_cents: number;
    available_on: Date | null;
    lease_term_months: number | null;
    pets_allowed: boolean | null;
    move_in_urgency: string | null;
    annual_income_cents: number | null;
    has_pets: boolean | null;
    household_size: number | null;
    monthly_gross_income_cents: number | null;
    intake_completed_at: Date | null;
    occupants: unknown;
    pets: unknown;
    intake_snapshot: unknown;
  }>(
    `select l.rent_amount_cents, l.available_on, l.lease_term_months, l.pets_allowed,
            rp.move_in_urgency, rp.annual_income_cents, rp.has_pets, rp.household_size,
            rai.monthly_gross_income_cents, rai.completed_at as intake_completed_at,
            rai.occupants, rai.pets, a.intake_snapshot
     from application a
     join listing l on l.id = a.listing_id
     join renter_profile rp on rp.id = a.renter_profile_id
     left join renter_application_intake rai on rai.party_id = a.party_id
     where a.id = $1 and a.listing_id = $2`,
    [input.applicationId, input.listingId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'application_not_found', 404);

  const active = await getActiveCriteria(client, input.listingId);
  let rules = active?.rules ?? {};
  // If no criteria row, fall back to listing pet flag as soft criteria.
  if (!active && row.pets_allowed != null) {
    rules = { pets_allowed: row.pets_allowed };
  }

  const monthly =
    row.monthly_gross_income_cents ??
    (row.annual_income_cents != null ? Math.round(row.annual_income_cents / 12) : null);

  let occupantsCount: number | null = null;
  if (Array.isArray(row.occupants)) occupantsCount = row.occupants.length;
  let hasPets = row.has_pets;
  if (Array.isArray(row.pets)) hasPets = row.pets.length > 0;

  const evaluated = evaluatePrequalAgainstRules({
    rules,
    rentAmountCents: row.rent_amount_cents,
    monthlyIncomeCents: monthly,
    moveInUrgency: row.move_in_urgency,
    availableOn: row.available_on,
    hasPets,
    householdSize: row.household_size,
    occupantsCount,
    preferredLeaseTermMonths: row.lease_term_months,
    listingLeaseTermMonths: row.lease_term_months,
    profileComplete: Boolean(row.intake_completed_at),
  });

  return {
    ...evaluated,
    criteria_version_id: active?.id ?? null,
    evaluated_at: new Date().toISOString(),
  };
}

export async function freezeCriteriaOnInterest(
  client: DbClient,
  applicationId: string,
): Promise<PrequalEvaluation | null> {
  const { rows } = await client.query<{
    id: string;
    listing_id: string;
    criteria_version_id: string | null;
  }>(
    `select id, listing_id, criteria_version_id from application where id = $1 for update`,
    [applicationId],
  );
  const app = rows[0];
  if (!app?.listing_id) return null;
  // Idempotent: keep first frozen evaluation
  if (app.criteria_version_id) {
    const { rows: existing } = await client.query<{ prequal_evaluation: PrequalEvaluation | null }>(
      `select prequal_evaluation from application where id = $1`,
      [applicationId],
    );
    return existing[0]?.prequal_evaluation ?? null;
  }

  const evaluation = await evaluatePrequal(client, {
    applicationId,
    listingId: app.listing_id,
  });

  await client.query(
    `update application
     set criteria_version_id = $2,
         prequal_evaluation = $3::jsonb
     where id = $1`,
    [applicationId, evaluation.criteria_version_id, JSON.stringify(evaluation)],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: 'application.criteria_frozen',
    payload: {
      listing_id: app.listing_id,
      criteria_version_id: evaluation.criteria_version_id,
      appears_to_meet: evaluation.appears_to_meet,
    },
    actorKind: 'system',
  });

  return evaluation;
}
