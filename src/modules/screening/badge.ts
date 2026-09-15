import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';

export type BadgeState = 'unverified' | 'prechecked' | 'fully_screened';

/**
 * Badge: identity + income → prechecked; full package products complete → fully_screened.
 */
export async function recomputeBadge(
  client: DbClient,
  partyId: string,
  clock: Clock = systemClock,
): Promise<BadgeState> {
  const { rows: rp } = await client.query<{ id: string; badge_state: string }>(
    `select id, badge_state from renter_profile where party_id = $1 for update`,
    [partyId],
  );
  if (!rp[0]) return 'unverified';

  const { rows: reports } = await client.query<{
    report_kind: string;
    status: string;
  }>(
    `select report_kind, status from screening_report
     where party_id = $1 and status = 'complete'`,
    [partyId],
  );
  const kinds = new Set(reports.map((r) => r.report_kind));

  const { rows: income } = await client.query<{ n: string }>(
    `select count(*)::text as n from income_verification where party_id = $1`,
    [partyId],
  );
  const hasIncome = Number(income[0]?.n ?? 0) > 0 || kinds.has('income');
  const hasIdentity = kinds.has('identity');

  let next: BadgeState = 'unverified';
  if (hasIdentity && hasIncome) {
    next = 'prechecked';
  }
  const fullSet = ['identity', 'credit', 'criminal', 'risk_insight'];
  if (fullSet.every((k) => kinds.has(k)) && hasIncome) {
    next = 'fully_screened';
  } else if (fullSet.every((k) => kinds.has(k))) {
    // Full screening package without separate income_verification row still counts
    // if income product is in package — launch package has no income product;
    // prechecked requires income_verification. fully_screened needs all package products.
    next = kinds.has('income') || hasIncome ? 'fully_screened' : 'prechecked';
  }

  // Correct fully_screened: all of identity, credit, criminal, risk_insight complete.
  // Income is separate for prechecked; fully_screened = package complete.
  if (
    kinds.has('identity') &&
    kinds.has('credit') &&
    kinds.has('criminal') &&
    kinds.has('risk_insight')
  ) {
    next = 'fully_screened';
  } else if (hasIdentity && hasIncome) {
    next = 'prechecked';
  } else {
    next = 'unverified';
  }

  if (rp[0].badge_state === next) return next;

  const now = clock.now();
  await client.query(
    `update renter_profile
     set badge_state = $2, badge_computed_at = $3, updated_at = $3
     where id = $1`,
    [rp[0].id, next, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'renter_profile',
    aggregateId: rp[0].id,
    eventType: 'renter_profile.badge_changed',
    payload: { from: rp[0].badge_state, to: next, party_id: partyId },
    actorKind: 'system',
    occurredAt: now,
  });
  return next;
}
