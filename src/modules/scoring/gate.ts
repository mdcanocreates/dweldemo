/**
 * Phase 7 activation gate (§17):
 * ≥6 months of placements with ≥60% label coverage at the 90-day horizon.
 * If unmet: rules v0 continues; do NOT activate an ML model.
 */

import type { DbClient } from '../../db/pool.js';
import { systemClock, type Clock } from '../shared/clock.js';
import type { Phase7GateResult } from './types.js';

export const GATE_MIN_SPAN_DAYS = 183; // ~6 months
export const GATE_MIN_LABEL_COVERAGE = 0.6;
export const GATE_HORIZON_DAYS = 90;

export async function evaluatePhase7Gate(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<Phase7GateResult> {
  const asOf = clock.now();

  const { rows: spanRows } = await client.query<{
    placement_count: string;
    earliest: Date | null;
    latest: Date | null;
  }>(
    `select
       count(*)::text as placement_count,
       min(coalesce(lease_signed_at, accepted_at)) as earliest,
       max(coalesce(lease_signed_at, accepted_at)) as latest
     from placement
     where status in ('lease_signed','funded','closed')
        or lease_signed_at is not null`,
  );

  const placementCount = Number(spanRows[0]?.placement_count ?? 0);
  const earliest = spanRows[0]?.earliest ?? null;
  const latest = spanRows[0]?.latest ?? null;

  let spanDays = 0;
  if (earliest && latest) {
    spanDays = Math.floor(
      (asOf.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  const { rows: covRows } = await client.query<{
    due_count: string;
    responded_count: string;
  }>(
    `select
       count(*)::text as due_count,
       count(*) filter (
         where reported_at is not null
           and source is distinct from 'no_response'
       )::text as responded_count
     from placement_outcome
     where horizon_days = $1
       and requested_at <= $2`,
    [GATE_HORIZON_DAYS, asOf],
  );

  const dueCount = Number(covRows[0]?.due_count ?? 0);
  const respondedCount = Number(covRows[0]?.responded_count ?? 0);
  const labelCoverage = dueCount === 0 ? 0 : respondedCount / dueCount;

  const spanMet = spanDays >= GATE_MIN_SPAN_DAYS && placementCount > 0;
  const coverageMet = dueCount > 0 && labelCoverage >= GATE_MIN_LABEL_COVERAGE;
  const met = spanMet && coverageMet;

  let reason: string;
  if (met) {
    reason = 'Phase 7 gate met: placement span and 90-day label coverage thresholds satisfied';
  } else if (!spanMet && !coverageMet) {
    reason =
      'UNMET: insufficient placement history span AND 90-day label coverage below 60% — ML activation blocked; rules v0 continues';
  } else if (!spanMet) {
    reason =
      'UNMET: placement history spans less than 6 months — ML activation blocked; rules v0 continues';
  } else {
    reason =
      'UNMET: 90-day label coverage below 60% — ML activation blocked; rules v0 continues';
  }

  return {
    met,
    reason,
    evidence: {
      placement_span_days: spanDays,
      placement_count: placementCount,
      min_span_days: GATE_MIN_SPAN_DAYS,
      horizon_days: GATE_HORIZON_DAYS,
      due_count: dueCount,
      responded_count: respondedCount,
      label_coverage: labelCoverage,
      min_label_coverage: GATE_MIN_LABEL_COVERAGE,
      as_of: asOf.toISOString(),
    },
  };
}
