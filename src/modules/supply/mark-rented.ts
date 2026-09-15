import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

export type RentedVia =
  | 'rbit_placement'
  | 'rbit_broker_offplatform'
  | 'own_broker'
  | 'direct'
  | 'other';

const RENTED_VIA = new Set<string>([
  'rbit_placement',
  'rbit_broker_offplatform',
  'own_broker',
  'direct',
  'other',
]);

/**
 * POST /v1/listings/{listing_id}/mark-rented
 */
export async function markListingRented(
  client: DbClient,
  input: {
    listingId: string;
    rentedVia: string;
    placementId?: string | null;
    brokerPartyId?: string | null;
    brokerOrgId?: string | null;
    reportedByPartyId: string;
    clock?: Clock;
  },
): Promise<{ listingId: string; leakageEventId: string | null }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  if (!input.rentedVia || !RENTED_VIA.has(input.rentedVia)) {
    throw new AppError('rented_via required', 'bad_request', 400);
  }
  if (input.rentedVia === 'rbit_placement' && !input.placementId) {
    throw new AppError('placement_id required for rbit_placement', 'bad_request', 400);
  }

  const { rows: listing } = await client.query<{
    id: string;
    org_id: string;
    status: string;
  }>(`select id, org_id, status from listing where id = $1 for update`, [
    input.listingId,
  ]);
  if (!listing[0]) throw new AppError('listing not found', 'not_found', 404);

  await client.query(
    `update listing set status = 'rented', rented_at = $2 where id = $1`,
    [input.listingId, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: input.listingId,
    eventType: 'listing.status_changed',
    payload: { from: listing[0].status, to: 'rented', rented_via: input.rentedVia },
    actorPartyId: input.reportedByPartyId,
    actorKind: 'user',
    occurredAt: now,
  });

  if (input.rentedVia === 'rbit_placement') {
    return { listingId: input.listingId, leakageEventId: null };
  }

  const leakageId = randomUUID();
  await client.query(
    `insert into listing_leakage_event (
       id, listing_id, org_id, rented_via, broker_party_id, broker_org_id,
       placement_id, reported_by_party_id, occurred_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      leakageId,
      input.listingId,
      listing[0].org_id,
      input.rentedVia,
      input.brokerPartyId ?? null,
      input.brokerOrgId ?? null,
      input.placementId ?? null,
      input.reportedByPartyId,
      now,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: input.listingId,
    eventType: 'listing_rented_off_platform',
    payload: {
      leakage_event_id: leakageId,
      rented_via: input.rentedVia,
      broker_org_id: input.brokerOrgId ?? null,
    },
    actorPartyId: input.reportedByPartyId,
    actorKind: 'user',
    occurredAt: now,
  });

  if (input.rentedVia === 'rbit_broker_offplatform' && input.brokerOrgId) {
    await client.query(
      `insert into broker_performance (org_id) values ($1)
       on conflict (org_id) do nothing`,
      [input.brokerOrgId],
    );
    await client.query(
      `update broker_performance
       set leakage_rate = coalesce(leakage_rate, 0) + 0.01,
           updated_at = $2
       where org_id = $1`,
      [input.brokerOrgId, now],
    );
  }

  return { listingId: input.listingId, leakageEventId: leakageId };
}

export async function getAdminLeakage(
  client: DbClient,
): Promise<
  Array<{
    submarket_id: string | null;
    rented_via: string;
    week: string;
    event_count: number;
  }>
> {
  const { rows } = await client.query<{
    submarket_id: string | null;
    rented_via: string;
    week: string;
    event_count: string;
  }>(
    `select a.submarket_id::text,
            e.rented_via,
            date_trunc('week', e.occurred_at)::date::text as week,
            count(*)::text as event_count
     from listing_leakage_event e
     join listing l on l.id = e.listing_id
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     group by 1, 2, 3
     order by week desc`,
  );
  return rows.map((r) => ({
    submarket_id: r.submarket_id,
    rented_via: r.rented_via,
    week: r.week,
    event_count: Number(r.event_count),
  }));
}
