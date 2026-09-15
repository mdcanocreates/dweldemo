import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import type { CanonicalListingFields } from './types.js';
import { valueHash } from './transform.js';
import { DEFAULT_INGESTION_THRESHOLDS } from './types.js';

type SourceListingRow = {
  id: string;
  source_id: string;
  precedence: number;
  last_seen_at: Date;
  rent_amount_cents: number | null;
  deposit_cents: number | null;
  bedrooms: string | null;
  bathrooms: string | null;
  sqft: number | null;
  available_on: string | null;
  lease_term_months: number | null;
  mapped_status: string | null;
};

/**
 * Field-level merge with precedence (§6A.3).
 * Lowest source.precedence with non-null wins; ties by last_seen_at.
 * Rent disagreement > tolerance → unit_source_conflict, hold prior value.
 */
export async function mergeCanonicalListing(
  client: DbClient,
  input: {
    orgId: string;
    unitId: string;
    sourceListingId: string;
    fields: CanonicalListingFields;
    origin: 'manual' | 'ingested' | 'hybrid';
    precedence: number;
    rentConflictTolerance?: number;
  },
): Promise<{ listingId: string; rentHeld: boolean }> {
  const tolerance =
    input.rentConflictTolerance ?? DEFAULT_INGESTION_THRESHOLDS.rent_conflict_tolerance;

  const { rows: existing } = await client.query<{
    id: string;
    rent_amount_cents: number;
    primary_source_listing_id: string | null;
    origin: string;
  }>(
    `select l.id, l.rent_amount_cents, l.primary_source_listing_id, l.origin
     from listing l
     where l.unit_id = $1 and l.status in ('draft','active','paused','stale')
     order by l.created_at asc
     limit 1
     for update`,
    [input.unitId],
  );

  // Load all active source listings for this unit to recompute field winners.
  const { rows: actives } = await client.query<SourceListingRow>(
    `select sl.id, sl.source_id, s.precedence, sl.last_seen_at,
            sl.rent_amount_cents, sl.deposit_cents, sl.bedrooms::text, sl.bathrooms::text,
            sl.sqft, sl.available_on::text, sl.lease_term_months, sl.mapped_status
     from source_listing sl
     join source s on s.id = sl.source_id
     where sl.unit_id = $1 and sl.mapped_status = 'active' and sl.resolution_status = 'resolved'
     order by s.precedence asc, sl.last_seen_at desc`,
    [input.unitId],
  );

  const winner = pickFieldWinners(actives.length ? actives : [{
    id: input.sourceListingId,
    source_id: '',
    precedence: input.precedence,
    last_seen_at: new Date(),
    rent_amount_cents: input.fields.rentAmountCents,
    deposit_cents: input.fields.depositCents ?? null,
    bedrooms: input.fields.bedrooms != null ? String(input.fields.bedrooms) : null,
    bathrooms: input.fields.bathrooms != null ? String(input.fields.bathrooms) : null,
    sqft: input.fields.sqft ?? null,
    available_on: input.fields.availableOn ?? null,
    lease_term_months: input.fields.leaseTermMonths ?? null,
    mapped_status: 'active',
  }]);

  let rentHeld = false;
  let listingId: string;

  if (!existing[0]) {
    listingId = randomUUID();
    await client.query(
      `insert into listing (
         id, org_id, unit_id, origin, primary_source_listing_id,
         rent_amount_cents, deposit_cents, available_on, lease_term_months,
         status, published_at, last_confirmed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active', now(), now())`,
      [
        listingId,
        input.orgId,
        input.unitId,
        input.origin,
        winner.primarySourceListingId,
        winner.rentAmountCents ?? input.fields.rentAmountCents,
        winner.depositCents,
        winner.availableOn,
        winner.leaseTermMonths,
      ],
    );
    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: listingId,
      eventType: 'listing.created',
      payload: {
        unit_id: input.unitId,
        origin: input.origin,
        source_listing_id: input.sourceListingId,
      },
      actorKind: 'system',
    });
  } else {
    listingId = existing[0].id;
    const priorRent = existing[0].rent_amount_cents;
    const candidateRent = winner.rentAmountCents ?? input.fields.rentAmountCents!;

    // Cross-source rent disagreement among active sources.
    const rentValues = actives
      .map((a) => a.rent_amount_cents)
      .filter((v): v is number => v != null);
    const disagreement = rentsDisagree(rentValues, tolerance);

    if (disagreement && priorRent > 0) {
      rentHeld = true;
      await client.query(
        `insert into unit_source_conflict (unit_id, field_name, values_seen)
         values ($1, 'rent_amount_cents', $2::jsonb)`,
        [
          input.unitId,
          JSON.stringify({
            prior: priorRent,
            values_seen: rentValues,
            incoming: candidateRent,
            source_listing_id: input.sourceListingId,
          }),
        ],
      );
      await client.query(
        `update listing set
           deposit_cents = coalesce($2, deposit_cents),
           available_on = coalesce($3, available_on),
           lease_term_months = coalesce($4, lease_term_months),
           last_confirmed_at = now(),
           origin = case when origin = 'manual' and $5 = 'ingested' then 'hybrid' else origin end
         where id = $1`,
        [
          listingId,
          winner.depositCents,
          winner.availableOn,
          winner.leaseTermMonths,
          input.origin,
        ],
      );
    } else {
      await client.query(
        `update listing set
           rent_amount_cents = $2,
           deposit_cents = coalesce($3, deposit_cents),
           available_on = coalesce($4, available_on),
           lease_term_months = coalesce($5, lease_term_months),
           primary_source_listing_id = $6,
           last_confirmed_at = now(),
           origin = case when origin = 'manual' and $7 = 'ingested' then 'hybrid' else origin end
         where id = $1`,
        [
          listingId,
          candidateRent,
          winner.depositCents,
          winner.availableOn,
          winner.leaseTermMonths,
          winner.primarySourceListingId,
          input.origin,
        ],
      );
    }

    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: listingId,
      eventType: 'listing.merged',
      payload: {
        source_listing_id: input.sourceListingId,
        precedence: input.precedence,
        rent_held: rentHeld,
        primary_source_listing_id: winner.primarySourceListingId,
      },
      actorKind: 'system',
    });
  }

  const fieldsToProvenance: Array<[string, unknown, string | null]> = [
    ['rent_amount_cents', rentHeld ? existing[0]?.rent_amount_cents : winner.rentAmountCents, winner.rentSourceListingId],
    ['deposit_cents', winner.depositCents, winner.depositSourceListingId],
    ['bedrooms', winner.bedrooms, winner.bedroomsSourceListingId],
    ['bathrooms', winner.bathrooms, winner.bathroomsSourceListingId],
    ['sqft', winner.sqft, winner.sqftSourceListingId],
    ['available_on', winner.availableOn, winner.availableOnSourceListingId],
    ['lease_term_months', winner.leaseTermMonths, winner.leaseTermSourceListingId],
  ];

  for (const [fieldName, value, sourceListingId] of fieldsToProvenance) {
    if (value == null || !sourceListingId) continue;
    await client.query(
      `insert into listing_field_provenance (listing_id, field_name, source_listing_id, value_hash)
       values ($1,$2,$3,$4)
       on conflict (listing_id, field_name) do update
         set source_listing_id = excluded.source_listing_id,
             value_hash = excluded.value_hash,
             set_at = now()`,
      [listingId, fieldName, sourceListingId, valueHash(value)],
    );
  }

  return { listingId, rentHeld };
}

function rentsDisagree(values: number[], tolerance: number): boolean {
  if (values.length < 2) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min <= 0) return false;
  return (max - min) / min > tolerance;
}

function pickFieldWinners(rows: SourceListingRow[]) {
  const pick = <T>(
    getter: (r: SourceListingRow) => T | null | undefined,
  ): { value: T | null; sourceListingId: string | null } => {
    for (const r of rows) {
      const v = getter(r);
      if (v != null && v !== '') return { value: v as T, sourceListingId: r.id };
    }
    return { value: null, sourceListingId: null };
  };

  const rent = pick((r) => r.rent_amount_cents);
  const deposit = pick((r) => r.deposit_cents);
  const bedrooms = pick((r) => (r.bedrooms != null ? Number(r.bedrooms) : null));
  const bathrooms = pick((r) => (r.bathrooms != null ? Number(r.bathrooms) : null));
  const sqft = pick((r) => r.sqft);
  const availableOn = pick((r) => r.available_on);
  const lease = pick((r) => r.lease_term_months);

  return {
    rentAmountCents: rent.value,
    rentSourceListingId: rent.sourceListingId,
    depositCents: deposit.value,
    depositSourceListingId: deposit.sourceListingId,
    bedrooms: bedrooms.value,
    bedroomsSourceListingId: bedrooms.sourceListingId,
    bathrooms: bathrooms.value,
    bathroomsSourceListingId: bathrooms.sourceListingId,
    sqft: sqft.value,
    sqftSourceListingId: sqft.sourceListingId,
    availableOn: availableOn.value,
    availableOnSourceListingId: availableOn.sourceListingId,
    leaseTermMonths: lease.value,
    leaseTermSourceListingId: lease.sourceListingId,
    primarySourceListingId: rent.sourceListingId ?? rows[0]?.id ?? null,
  };
}

/** After delist, recompute listing or expire when no active sources remain. */
export async function recomputeListingAfterDelist(
  client: DbClient,
  unitId: string,
): Promise<void> {
  const { rows: active } = await client.query<{ id: string }>(
    `select id from source_listing
     where unit_id = $1 and mapped_status = 'active' and resolution_status = 'resolved'`,
    [unitId],
  );

  const { rows: listings } = await client.query<{ id: string; status: string }>(
    `select id, status from listing
     where unit_id = $1 and status in ('draft','active','paused','stale')`,
    [unitId],
  );
  if (!listings[0]) return;

  if (active.length === 0) {
    await client.query(
      `update listing set status = 'expired', expires_at = now() where id = $1`,
      [listings[0].id],
    );
    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: listings[0].id,
      eventType: 'listing.status_changed',
      payload: { from: listings[0].status, to: 'expired', reason: 'no_active_source' },
      actorKind: 'system',
    });
    return;
  }

  // Re-merge from remaining sources
  const { rows: src } = await client.query<SourceListingRow & { org_id: string; precedence: number }>(
    `select sl.id, sl.source_id, sl.org_id, s.precedence, sl.last_seen_at,
            sl.rent_amount_cents, sl.deposit_cents, sl.bedrooms::text, sl.bathrooms::text,
            sl.sqft, sl.available_on::text, sl.lease_term_months, sl.mapped_status
     from source_listing sl
     join source s on s.id = sl.source_id
     where sl.unit_id = $1 and sl.mapped_status = 'active'
     order by s.precedence asc, sl.last_seen_at desc`,
    [unitId],
  );
  if (!src[0]) return;
  const winner = pickFieldWinners(src);
  await client.query(
    `update listing set
       rent_amount_cents = coalesce($2, rent_amount_cents),
       deposit_cents = coalesce($3, deposit_cents),
       available_on = coalesce($4, available_on),
       lease_term_months = coalesce($5, lease_term_months),
       primary_source_listing_id = $6,
       last_confirmed_at = now()
     where id = $1`,
    [
      listings[0].id,
      winner.rentAmountCents,
      winner.depositCents,
      winner.availableOn,
      winner.leaseTermMonths,
      winner.primarySourceListingId,
    ],
  );
}
