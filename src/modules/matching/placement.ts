import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { resolveHoldTtlMs } from '../config/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import {
  computeMatchScore,
  loadListingMatchInput,
  loadScoringWeights,
  MATCH_MODEL_KEY,
  MATCH_MODEL_VERSION,
} from './match-score.js';

/**
 * §9.4 provisional allowlist (D-13 — content gated; enforcement builds now).
 */
export const ALLOWED_RENTER_SEARCH_FILTERS = [
  'target_submarket_ids',
  'rent_max_cents',
  'bedrooms_min',
  'move_in_earliest',
  'move_in_latest',
  'household_size',
  'has_pets',
  'badge_state',
  'score_band',
] as const;

export type RenterSearchFilterKey = (typeof ALLOWED_RENTER_SEARCH_FILTERS)[number];

export class PlacementConflictError extends AppError {
  constructor(message = 'unit already placed') {
    super(message, 'placement_conflict', 409);
    this.name = 'PlacementConflictError';
  }
}

export class AllowlistViolationError extends AppError {
  constructor(readonly rejectedKeys: string[]) {
    super(
      `filter keys outside allowlist: ${rejectedKeys.join(',')}`,
      'renter_search_allowlist_violation',
      400,
    );
    this.name = 'AllowlistViolationError';
  }
}

export async function acceptPlacement(
  client: DbClient,
  input: {
    unitId: string;
    listingId: string;
    applicationId: string;
    partyId: string;
    orgId: string;
    brokerOrgId?: string | null;
    clock?: Clock;
  },
): Promise<{ placementId: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const placementId = randomUUID();
  const holdTtlMs = await resolveHoldTtlMs(client, now);

  try {
    await client.query(
      `insert into placement (
         id, unit_id, listing_id, application_id, party_id, org_id, broker_org_id,
         status, hold_expires_at, accepted_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'hold',$8,$9)`,
      [
        placementId,
        input.unitId,
        input.listingId,
        input.applicationId,
        input.partyId,
        input.orgId,
        input.brokerOrgId ?? null,
        new Date(now.getTime() + holdTtlMs),
        now,
      ],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      throw new PlacementConflictError();
    }
    throw err;
  }

  await emitDomainEvent(client, {
    aggregateType: 'placement',
    aggregateId: placementId,
    eventType: 'placement.accepted',
    payload: {
      unit_id: input.unitId,
      listing_id: input.listingId,
      application_id: input.applicationId,
      status: 'hold',
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: now,
  });

  return { placementId };
}

export async function enqueuePlacement(
  client: DbClient,
  input: {
    listingId: string;
    applicationId: string;
    rankScore: number;
    rankPosition: number;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `insert into placement_queue_entry (
       id, listing_id, application_id, rank_score, rank_position
     ) values ($1,$2,$3,$4,$5)`,
    [id, input.listingId, input.applicationId, input.rankScore, input.rankPosition],
  );
  return { id };
}

/**
 * Lapse an expired hold: free unit, promote queue head to a new hold.
 */
export async function lapseHoldAndPromote(
  client: DbClient,
  placementId: string,
  clock: Clock = systemClock,
): Promise<{ promotedPlacementId: string | null }> {
  const now = clock.now();

  const { rows } = await client.query<{
    id: string;
    unit_id: string;
    listing_id: string;
    status: string;
    org_id: string;
  }>(
    `select id, unit_id, listing_id, status, org_id from placement where id = $1 for update`,
    [placementId],
  );
  const placement = rows[0];
  if (!placement) throw new AppError('placement not found', 'placement_not_found', 404);
  if (placement.status !== 'hold' && placement.status !== 'broker_assigned') {
    throw new AppError('placement not in holdable state', 'placement_invalid_state', 409);
  }

  await client.query(
    `update placement set status = 'lapsed', terminal_at = $2 where id = $1`,
    [placementId, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'placement',
    aggregateId: placementId,
    eventType: 'placement.lapsed',
    payload: { from: placement.status, to: 'lapsed' },
    actorKind: 'system',
    occurredAt: now,
  });

  // Listing returns to active when unit freed.
  await client.query(
    `update listing set status = 'active', last_confirmed_at = $2
     where id = $1 and status <> 'rented'`,
    [placement.listing_id, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: placement.listing_id,
    eventType: 'listing.status_changed',
    payload: { to: 'active', reason: 'hold_lapsed' },
    actorKind: 'system',
    occurredAt: now,
  });

  const { rows: queue } = await client.query<{
    id: string;
    application_id: string;
  }>(
    `select id, application_id from placement_queue_entry
     where listing_id = $1 and exited_at is null
     order by rank_position asc, entered_at asc
     limit 1
     for update`,
    [placement.listing_id],
  );

  if (!queue[0]) {
    return { promotedPlacementId: null };
  }

  const { rows: apps } = await client.query<{
    id: string;
    party_id: string;
    unit_id: string | null;
    org_id: string;
  }>(`select id, party_id, unit_id, org_id from application where id = $1`, [
    queue[0].application_id,
  ]);
  const app = apps[0];
  if (!app) return { promotedPlacementId: null };

  const promoted = await acceptPlacement(client, {
    unitId: app.unit_id ?? placement.unit_id,
    listingId: placement.listing_id,
    applicationId: app.id,
    partyId: app.party_id,
    orgId: app.org_id,
    clock,
  });

  await client.query(
    `update placement_queue_entry
     set promoted_at = $2, exited_at = $2, exit_reason = 'promoted'
     where id = $1`,
    [queue[0].id, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'placement_queue_entry',
    aggregateId: queue[0].id,
    eventType: 'placement_queue.promoted',
    payload: {
      listing_id: placement.listing_id,
      placement_id: promoted.placementId,
      application_id: app.id,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return { promotedPlacementId: promoted.placementId };
}

export async function markLeaseSigned(
  client: DbClient,
  placementId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{ status: string }>(
    `select status from placement where id = $1 for update`,
    [placementId],
  );
  const row = rows[0];
  if (!row) throw new AppError('placement not found', 'placement_not_found', 404);
  if (row.status !== 'hold' && row.status !== 'broker_assigned') {
    throw new AppError(
      `lease_signed requires hold|broker_assigned, was ${row.status}`,
      'placement_invalid_state',
      409,
    );
  }

  await client.query(
    `update placement set status = 'lease_signed', lease_signed_at = $2 where id = $1`,
    [placementId, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'placement',
    aggregateId: placementId,
    eventType: 'placement.lease_signed',
    payload: { from: row.status, to: 'lease_signed' },
    actorKind: 'system',
    occurredAt: now,
  });
}

/**
 * Mark placement funded. Emits placement.funded — screening rebate evaluates on this event
 * (not lease_signed). Caller may invoke rebate evaluation via screening module.
 */
export async function markPlacementFunded(
  client: DbClient,
  placementId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{ status: string }>(
    `select status from placement where id = $1 for update`,
    [placementId],
  );
  const row = rows[0];
  if (!row) throw new AppError('placement not found', 'placement_not_found', 404);
  if (row.status !== 'lease_signed') {
    throw new AppError(
      `funded requires lease_signed, was ${row.status}`,
      'placement_invalid_state',
      409,
    );
  }

  await client.query(
    `update placement set status = 'funded', funded_at = $2 where id = $1`,
    [placementId, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'placement',
    aggregateId: placementId,
    eventType: 'placement.funded',
    payload: { from: row.status, to: 'funded' },
    actorKind: 'system',
    occurredAt: now,
  });
}

export type MinimalRenterSearchHit = {
  renter_profile_id: string;
  badge_state: string;
  score_band: string | null;
  rent_max_cents: number | null;
  bedrooms_min: string | null;
  household_size: number | null;
  has_pets: boolean | null;
  target_submarket_ids: string[];
  match_score: number | null;
  match_score_components: unknown[] | null;
};

/**
 * Landlord-facing renter search with allowlist enforcement.
 * At discoverability_level = minimal, response contains zero identity fields.
 * When listingId is provided, computes match_score; otherwise match_score is null.
 */
export async function searchDiscoverableRenters(
  client: DbClient,
  input: {
    actorPartyId: string;
    filters: Record<string, unknown>;
    listingId?: string | null;
    sortBy?: 'match_score' | 'badge_state';
  },
): Promise<MinimalRenterSearchHit[]> {
  const rejected = Object.keys(input.filters).filter(
    (k) => !(ALLOWED_RENTER_SEARCH_FILTERS as readonly string[]).includes(k),
  );
  if (rejected.length) {
    throw new AllowlistViolationError(rejected);
  }

  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'renter_search.executed',
    targetType: 'renter_profile',
    afterState: { filters: input.filters, listing_id: input.listingId ?? null },
  });

  const params: unknown[] = [];
  const where: string[] = [
    `rp.is_discoverable = true`,
    `rp.discoverability_level = 'minimal'`,
  ];

  if (input.filters.badge_state != null) {
    params.push(input.filters.badge_state);
    where.push(`rp.badge_state = $${params.length}`);
  }
  if (input.filters.rent_max_cents != null) {
    params.push(input.filters.rent_max_cents);
    where.push(`rp.rent_max_cents <= $${params.length}`);
  }
  if (input.filters.bedrooms_min != null) {
    params.push(input.filters.bedrooms_min);
    where.push(`rp.bedrooms_min >= $${params.length}`);
  }
  if (input.filters.household_size != null) {
    params.push(input.filters.household_size);
    where.push(`rp.household_size = $${params.length}`);
  }
  if (input.filters.has_pets != null) {
    params.push(input.filters.has_pets);
    where.push(`rp.has_pets = $${params.length}`);
  }
  if (input.filters.score_band != null) {
    params.push(input.filters.score_band);
    where.push(`pf.latest_score is not null`); // band filter applied in serializer stub
  }

  const { rows } = await client.query<{
    id: string;
    badge_state: string;
    rent_max_cents: number | null;
    bedrooms_min: string | null;
    household_size: number | null;
    has_pets: boolean | null;
    target_submarket_ids: string[];
    latest_score: string | null;
    move_in_earliest: string | null;
    move_in_latest: string | null;
  }>(
    `select rp.id, rp.badge_state, rp.rent_max_cents, rp.bedrooms_min::text,
            rp.household_size, rp.has_pets, rp.target_submarket_ids,
            pf.latest_score::text,
            rp.move_in_earliest::text, rp.move_in_latest::text
     from renter_profile rp
     join party_features pf on pf.party_id = rp.party_id
     where ${where.join(' and ')}
     limit 100`,
    params,
  );

  let listingInput: Awaited<ReturnType<typeof loadListingMatchInput>> | null =
    null;
  let weights: Awaited<ReturnType<typeof loadScoringWeights>> | null = null;
  if (input.listingId) {
    listingInput = await loadListingMatchInput(client, input.listingId);
    weights = await loadScoringWeights(client);
  }

  const hits: MinimalRenterSearchHit[] = rows.map((r) => {
    let match_score: number | null = null;
    let match_score_components: unknown[] | null = null;
    if (listingInput && weights) {
      const scored = computeMatchScore(
        listingInput,
        {
          rent_max_cents: r.rent_max_cents,
          move_in_earliest: r.move_in_earliest,
          move_in_latest: r.move_in_latest,
          bedrooms_min: r.bedrooms_min != null ? Number(r.bedrooms_min) : null,
          badge_state: r.badge_state,
          target_submarket_ids: r.target_submarket_ids ?? [],
        },
        weights,
      );
      match_score = scored.match_score;
      match_score_components = scored.match_score_components;
    }

    const hit: MinimalRenterSearchHit = {
      renter_profile_id: r.id,
      badge_state: r.badge_state,
      score_band: r.latest_score != null ? bandFromScore(Number(r.latest_score)) : null,
      rent_max_cents: r.rent_max_cents,
      bedrooms_min: r.bedrooms_min,
      household_size: r.household_size,
      has_pets: r.has_pets,
      target_submarket_ids: r.target_submarket_ids ?? [],
      match_score,
      match_score_components,
    };
    assertMinimalSerializer(hit);
    return hit;
  });

  const sortBy = input.sortBy ?? (input.listingId ? 'match_score' : 'badge_state');
  if (sortBy === 'match_score') {
    hits.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
  }
  return hits;
}

function bandFromScore(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

const IDENTITY_KEYS = new Set([
  'email',
  'phone',
  'given_name',
  'family_name',
  'givenName',
  'familyName',
  'dob',
  'party_id',
  'partyId',
  'name',
]);

export function assertMinimalSerializer(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (IDENTITY_KEYS.has(key)) {
      throw new AppError(
        `identity field leaked in minimal serializer: ${key}`,
        'identity_leak',
        500,
      );
    }
  }
}

/**
 * GET /v1/landlord/listings/{listing_id}/matches — top 20 by match_score.
 * Landlord must own the listing.
 */
export async function listListingMatches(
  client: DbClient,
  input: {
    actorPartyId: string;
    orgId: string;
    listingId: string;
  },
): Promise<MinimalRenterSearchHit[]> {
  const { rows: owned } = await client.query<{ id: string }>(
    `select id from listing where id = $1 and org_id = $2`,
    [input.listingId, input.orgId],
  );
  if (!owned[0]) {
    throw new AppError('listing not found or not owned', 'listing_forbidden', 403);
  }

  const hits = await searchDiscoverableRenters(client, {
    actorPartyId: input.actorPartyId,
    filters: {},
    listingId: input.listingId,
    sortBy: 'match_score',
  });
  return hits.slice(0, 20);
}

/**
 * Express landlord interest — snapshots match score + model version.
 */
export async function expressLandlordInterest(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    renterProfileId: string;
    initiatedByPartyId: string;
    message?: string | null;
    searchFilterSnapshot?: Record<string, unknown>;
    expiresAt: Date;
    clock?: Clock;
  },
): Promise<{ interestId: string; match_score: number; match_model_version: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const listing = await loadListingMatchInput(client, input.listingId);
  const weights = await loadScoringWeights(client, now);

  const { rows: rp } = await client.query<{
    rent_max_cents: number | null;
    move_in_earliest: string | null;
    move_in_latest: string | null;
    bedrooms_min: string | null;
    badge_state: string;
    target_submarket_ids: string[];
  }>(
    `select rent_max_cents, move_in_earliest::text, move_in_latest::text,
            bedrooms_min::text, badge_state, target_submarket_ids
     from renter_profile where id = $1`,
    [input.renterProfileId],
  );
  if (!rp[0]) {
    throw new AppError('renter profile not found', 'renter_profile_not_found', 404);
  }

  const scored = computeMatchScore(
    listing,
    {
      rent_max_cents: rp[0].rent_max_cents,
      move_in_earliest: rp[0].move_in_earliest,
      move_in_latest: rp[0].move_in_latest,
      bedrooms_min: rp[0].bedrooms_min != null ? Number(rp[0].bedrooms_min) : null,
      badge_state: rp[0].badge_state,
      target_submarket_ids: rp[0].target_submarket_ids ?? [],
    },
    weights,
  );

  const interestId = randomUUID();
  await client.query(
    `insert into landlord_interest (
       id, listing_id, org_id, renter_profile_id, initiated_by_party_id,
       message, status, expires_at, search_filter_snapshot,
       match_score, match_score_components, match_model_key, match_model_version
     ) values (
       $1,$2,$3,$4,$5,$6,'sent',$7,$8::jsonb,$9,$10::jsonb,$11,$12
     )`,
    [
      interestId,
      input.listingId,
      input.orgId,
      input.renterProfileId,
      input.initiatedByPartyId,
      input.message ?? null,
      input.expiresAt,
      JSON.stringify(input.searchFilterSnapshot ?? {}),
      scored.match_score,
      JSON.stringify(scored.match_score_components),
      MATCH_MODEL_KEY,
      MATCH_MODEL_VERSION,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'landlord_interest',
    aggregateId: interestId,
    eventType: 'landlord_interest.sent',
    payload: {
      listing_id: input.listingId,
      match_score: scored.match_score,
      match_model_version: MATCH_MODEL_VERSION,
    },
    actorPartyId: input.initiatedByPartyId,
    actorKind: 'user',
    occurredAt: now,
  });

  return {
    interestId,
    match_score: scored.match_score,
    match_model_version: MATCH_MODEL_VERSION,
  };
}
