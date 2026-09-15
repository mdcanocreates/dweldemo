/**
 * B-2 — listing↔renter match score (model listing_renter_match / v0.1).
 * Weights from config namespace scoring_weights — never hardcoded as sole source.
 */

import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { AppError } from '../shared/errors.js';

export const MATCH_MODEL_KEY = 'listing_renter_match';
export const MATCH_MODEL_VERSION = 'v0.1';

export type ScoringWeights = {
  rent_affordability: number;
  move_in_window: number;
  bedroom_match: number;
  badge_tier: number;
  submarket_match: number;
};

/** Test/dev fallback only — production must resolve from config. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  rent_affordability: 0.3,
  move_in_window: 0.2,
  bedroom_match: 0.15,
  badge_tier: 0.2,
  submarket_match: 0.15,
};

export type MatchDimensionScore = {
  dimension: keyof ScoringWeights;
  weight: number;
  score: number; // 0|50|100 (or 0|60|100 for badge)
  weighted: number;
  explanation: string;
};

export type MatchScoreResult = {
  match_score: number;
  match_score_components: MatchDimensionScore[];
  model_key: string;
  model_version: string;
};

export type ListingMatchInput = {
  rent_amount_cents: number | null;
  available_on: string | null; // ISO date
  bedrooms: number | null;
  submarket_id: string | null;
};

export type RenterMatchInput = {
  rent_max_cents: number | null;
  move_in_earliest: string | null;
  move_in_latest: string | null;
  bedrooms_min: number | null;
  badge_state: string;
  target_submarket_ids: string[];
};

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  return Math.round((db - da) / 86_400_000);
}

export function scoreRentAffordability(
  listingRent: number | null,
  renterMax: number | null,
): { score: number; explanation: string } {
  if (listingRent == null || renterMax == null) {
    return { score: 0, explanation: 'rent data incomplete' };
  }
  if (renterMax >= listingRent) {
    return { score: 100, explanation: 'renter max covers listing rent' };
  }
  const ratio = (listingRent - renterMax) / listingRent;
  if (ratio <= 0.1) {
    return { score: 50, explanation: 'renter max within 10% below listing rent' };
  }
  return { score: 0, explanation: 'renter max more than 10% below listing rent' };
}

export function scoreMoveInWindow(
  availableOn: string | null,
  earliest: string | null,
  latest: string | null,
): { score: number; explanation: string } {
  if (!availableOn || (!earliest && !latest)) {
    return { score: 0, explanation: 'move-in window incomplete' };
  }
  const avail = availableOn.slice(0, 10);
  const lo = earliest?.slice(0, 10) ?? null;
  const hi = latest?.slice(0, 10) ?? null;
  const inWindow =
    (lo == null || avail >= lo) && (hi == null || avail <= hi);
  if (inWindow) {
    return { score: 100, explanation: 'listing available_on within renter window' };
  }
  let outside = 0;
  if (lo && avail < lo) outside = Math.abs(daysBetween(avail, lo));
  if (hi && avail > hi) outside = Math.abs(daysBetween(hi, avail));
  if (outside <= 14) {
    return { score: 50, explanation: 'available_on within 14 days of renter window' };
  }
  return { score: 0, explanation: 'available_on outside renter window by >14 days' };
}

export function scoreBedroomMatch(
  listingBeds: number | null,
  renterMin: number | null,
): { score: number; explanation: string } {
  if (listingBeds == null || renterMin == null) {
    return { score: 0, explanation: 'bedroom data incomplete' };
  }
  if (listingBeds >= renterMin) {
    return { score: 100, explanation: 'listing bedrooms meet renter minimum' };
  }
  return { score: 0, explanation: 'listing bedrooms below renter minimum' };
}

export function scoreBadgeTier(badgeState: string): {
  score: number;
  explanation: string;
} {
  if (badgeState === 'fully_screened') {
    return { score: 100, explanation: 'fully_screened badge' };
  }
  if (badgeState === 'prechecked') {
    return { score: 60, explanation: 'prechecked badge' };
  }
  return { score: 20, explanation: 'unverified badge' };
}

export function scoreSubmarketMatch(
  listingSubmarketId: string | null,
  targetIds: string[],
): { score: number; explanation: string } {
  if (!listingSubmarketId || !targetIds.length) {
    return { score: 0, explanation: 'submarket data incomplete' };
  }
  if (targetIds.includes(listingSubmarketId)) {
    return { score: 100, explanation: 'listing submarket in renter targets' };
  }
  return { score: 0, explanation: 'listing submarket not in renter targets' };
}

export function assertWeightsSumToOne(weights: ScoringWeights): void {
  const sum =
    weights.rent_affordability +
    weights.move_in_window +
    weights.bedroom_match +
    weights.badge_tier +
    weights.submarket_match;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new AppError(
      `scoring_weights must sum to 1.0, got ${sum}`,
      'scoring_weights_invalid',
      500,
    );
  }
}

export function computeMatchScore(
  listing: ListingMatchInput,
  renter: RenterMatchInput,
  weights: ScoringWeights,
): MatchScoreResult {
  assertWeightsSumToOne(weights);

  const rent = scoreRentAffordability(
    listing.rent_amount_cents,
    renter.rent_max_cents,
  );
  const move = scoreMoveInWindow(
    listing.available_on,
    renter.move_in_earliest,
    renter.move_in_latest,
  );
  const beds = scoreBedroomMatch(listing.bedrooms, renter.bedrooms_min);
  const badge = scoreBadgeTier(renter.badge_state);
  const sub = scoreSubmarketMatch(
    listing.submarket_id,
    renter.target_submarket_ids,
  );

  const components: MatchDimensionScore[] = [
    {
      dimension: 'rent_affordability',
      weight: weights.rent_affordability,
      score: rent.score,
      weighted: rent.score * weights.rent_affordability,
      explanation: rent.explanation,
    },
    {
      dimension: 'move_in_window',
      weight: weights.move_in_window,
      score: move.score,
      weighted: move.score * weights.move_in_window,
      explanation: move.explanation,
    },
    {
      dimension: 'bedroom_match',
      weight: weights.bedroom_match,
      score: beds.score,
      weighted: beds.score * weights.bedroom_match,
      explanation: beds.explanation,
    },
    {
      dimension: 'badge_tier',
      weight: weights.badge_tier,
      score: badge.score,
      weighted: badge.score * weights.badge_tier,
      explanation: badge.explanation,
    },
    {
      dimension: 'submarket_match',
      weight: weights.submarket_match,
      score: sub.score,
      weighted: sub.score * weights.submarket_match,
      explanation: sub.explanation,
    },
  ];

  const match_score = Math.round(
    components.reduce((acc, c) => acc + c.weighted, 0) * 1000,
  ) / 1000;

  return {
    match_score,
    match_score_components: components,
    model_key: MATCH_MODEL_KEY,
    model_version: MATCH_MODEL_VERSION,
  };
}

export async function loadScoringWeights(
  client: DbClient,
  asOf?: Date,
): Promise<ScoringWeights> {
  const payload = await resolveConfig(client, 'scoring_weights', asOf ?? new Date());
  if (!payload) return { ...DEFAULT_SCORING_WEIGHTS };
  const w: ScoringWeights = {
    rent_affordability: Number(payload.rent_affordability),
    move_in_window: Number(payload.move_in_window),
    bedroom_match: Number(payload.bedroom_match),
    badge_tier: Number(payload.badge_tier),
    submarket_match: Number(payload.submarket_match),
  };
  assertWeightsSumToOne(w);
  return w;
}

export async function loadListingMatchInput(
  client: DbClient,
  listingId: string,
): Promise<ListingMatchInput> {
  const { rows } = await client.query<{
    rent_amount_cents: number | null;
    available_on: string | null;
    bedrooms: string | null;
    submarket_id: string | null;
  }>(
    `select l.rent_amount_cents,
            l.available_on::text,
            u.bedrooms::text,
            a.submarket_id::text
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = $1`,
    [listingId],
  );
  const r = rows[0];
  if (!r) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }
  return {
    rent_amount_cents: r.rent_amount_cents,
    available_on: r.available_on,
    bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
    submarket_id: r.submarket_id,
  };
}
