/**
 * §14.2 Search event async buffer → bulk flush into monthly partitions.
 * Never on the transactional write path of application/placement.
 */

import type { DbClient } from '../../db/pool.js';

export type SearchEventInput = {
  occurredAt?: Date;
  sessionId?: string | null;
  partyId?: string | null;
  submarketId?: string | null;
  h3R8?: string | null;
  bedroomsMin?: number | null;
  bedroomsMax?: number | null;
  rentMinCents?: number | null;
  rentMaxCents?: number | null;
  filters?: Record<string, unknown> | null;
  resultCount: number;
  clickedListingIds?: string[] | null;
};

const buffer: SearchEventInput[] = [];

export function enqueueSearchEvent(event: SearchEventInput): void {
  buffer.push(event);
}

export function peekSearchEventBuffer(): readonly SearchEventInput[] {
  return buffer;
}

export function clearSearchEventBuffer(): void {
  buffer.length = 0;
}

export function searchEventBufferDepth(): number {
  return buffer.length;
}

/**
 * Bulk flush buffer into search_event (simulates COPY).
 * Zero-result searches are never sampled — all are flushed.
 */
export async function flushSearchEventBuffer(
  client: DbClient,
): Promise<{ inserted: number }> {
  if (buffer.length === 0) return { inserted: 0 };
  const batch = buffer.splice(0, buffer.length);
  for (const e of batch) {
    await client.query(
      `insert into search_event (
         occurred_at, session_id, party_id, submarket_id, h3_r8,
         bedrooms_min, bedrooms_max, rent_min_cents, rent_max_cents,
         filters, result_count, clicked_listing_ids
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
      [
        e.occurredAt ?? new Date(),
        e.sessionId ?? null,
        e.partyId ?? null,
        e.submarketId ?? null,
        e.h3R8 ?? null,
        e.bedroomsMin ?? null,
        e.bedroomsMax ?? null,
        e.rentMinCents ?? null,
        e.rentMaxCents ?? null,
        JSON.stringify(e.filters ?? {}),
        e.resultCount,
        e.clickedListingIds ?? null,
      ],
    );
  }
  return { inserted: batch.length };
}

/** Bed / rent band helpers for rollup dimensions. */
export function bedBand(min: number | null, max: number | null): string {
  const v = min ?? max;
  if (v == null) return 'any';
  if (v < 1) return 'studio';
  if (v < 2) return '1';
  if (v < 3) return '2';
  if (v < 4) return '3';
  return '4plus';
}

export function rentBand(min: number | null, max: number | null): string {
  const v = max ?? min;
  if (v == null) return 'any';
  if (v < 100000) return '0-999';
  if (v < 150000) return '1000-1499';
  if (v < 200000) return '1500-1999';
  if (v < 250000) return '2000-2499';
  if (v < 300000) return '2500-2999';
  return '3000plus';
}

/**
 * Nightly rollup → search_demand_daily (submarket, bed_band, rent_band, date).
 */
export async function rollupSearchDemandDaily(
  client: DbClient,
  forDate: Date,
): Promise<{ rows: number }> {
  const dateStr = forDate.toISOString().slice(0, 10);
  await client.query(
    `delete from search_demand_daily where date = $1::date`,
    [dateStr],
  );

  const { rows } = await client.query<{
    submarket_id: string | null;
    bedrooms_min: string | null;
    bedrooms_max: string | null;
    rent_min_cents: number | null;
    rent_max_cents: number | null;
    result_count: number;
    clicks: number;
  }>(
    `select
       submarket_id,
       bedrooms_min::text,
       bedrooms_max::text,
       rent_min_cents,
       rent_max_cents,
       result_count,
       coalesce(cardinality(clicked_listing_ids), 0) as clicks
     from search_event
     where occurred_at >= $1::date
       and occurred_at < ($1::date + interval '1 day')`,
    [dateStr],
  );

  type Agg = {
    submarketId: string | null;
    bedBand: string;
    rentBand: string;
    searches: number;
    zeroResults: number;
    clicks: number;
  };
  const map = new Map<string, Agg>();

  for (const r of rows) {
    const bb = bedBand(
      r.bedrooms_min != null ? Number(r.bedrooms_min) : null,
      r.bedrooms_max != null ? Number(r.bedrooms_max) : null,
    );
    const rb = rentBand(r.rent_min_cents, r.rent_max_cents);
    const key = `${r.submarket_id ?? 'null'}|${bb}|${rb}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        submarketId: r.submarket_id,
        bedBand: bb,
        rentBand: rb,
        searches: 0,
        zeroResults: 0,
        clicks: 0,
      };
      map.set(key, agg);
    }
    agg.searches += 1;
    if (r.result_count === 0) agg.zeroResults += 1;
    agg.clicks += Number(r.clicks) || 0;
  }

  for (const agg of map.values()) {
    await client.query(
      `insert into search_demand_daily (
         date, submarket_id, bed_band, rent_band, searches, zero_results, clicks
       ) values ($1::date,$2,$3,$4,$5,$6,$7)`,
      [
        dateStr,
        agg.submarketId,
        agg.bedBand,
        agg.rentBand,
        agg.searches,
        agg.zeroResults,
        agg.clicks,
      ],
    );
  }

  return { rows: map.size };
}
