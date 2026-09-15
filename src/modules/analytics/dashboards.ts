import type { DbClient } from '../../db/pool.js';

/** Supply/demand dashboard queries — reporting schema only. */

export async function getSupplyDemandBySubmarket(
  client: DbClient,
  asOfDate: string,
): Promise<
  Array<{
    submarket_id: string | null;
    active_listings: number;
    searches: number;
    zero_results: number;
    demand_supply_ratio: number | null;
  }>
> {
  const { rows } = await client.query<{
    submarket_id: string | null;
    active_listings: number;
    searches: string;
    zero_results: string;
  }>(
    `select
       coalesce(s.submarket_id, d.submarket_id) as submarket_id,
       coalesce(s.active_listings, 0) as active_listings,
       coalesce(sum(d.searches), 0)::text as searches,
       coalesce(sum(d.zero_results), 0)::text as zero_results
     from reporting.agg_supply_daily s
     full outer join reporting.agg_search_demand_daily d
       on d.submarket_id is not distinct from s.submarket_id
      and d.date = s.date
     where coalesce(s.date, d.date) = $1::date
     group by coalesce(s.submarket_id, d.submarket_id), s.active_listings`,
    [asOfDate],
  );

  return rows.map((r) => {
    const searches = Number(r.searches);
    const active = Number(r.active_listings);
    return {
      submarket_id: r.submarket_id,
      active_listings: active,
      searches,
      zero_results: Number(r.zero_results),
      demand_supply_ratio: active > 0 ? searches / active : null,
    };
  });
}

export async function getLabelCoverage(
  client: DbClient,
  asOfDate: string,
): Promise<
  Array<{
    horizon_days: number;
    due_count: number;
    responded_count: number;
    response_rate: number;
  }>
> {
  const { rows } = await client.query<{
    horizon_days: number;
    due_count: number;
    responded_count: number;
    response_rate: string;
  }>(
    `select horizon_days, due_count, responded_count, response_rate::text
     from reporting.agg_label_coverage
     where as_of_date = $1::date
     order by horizon_days`,
    [asOfDate],
  );
  return rows.map((r) => ({
    horizon_days: r.horizon_days,
    due_count: r.due_count,
    responded_count: r.responded_count,
    response_rate: Number(r.response_rate),
  }));
}

export async function getZeroResultDemandRollup(
  client: DbClient,
  asOfDate: string,
): Promise<
  Array<{
    submarket_id: string | null;
    bed_band: string;
    rent_band: string;
    searches: number;
    zero_results: number;
  }>
> {
  const { rows } = await client.query<{
    submarket_id: string | null;
    bed_band: string;
    rent_band: string;
    searches: number;
    zero_results: number;
  }>(
    `select submarket_id, bed_band, rent_band, searches, zero_results
     from reporting.agg_search_demand_daily
     where date = $1::date and zero_results > 0
     order by zero_results desc, bed_band, rent_band`,
    [asOfDate],
  );
  return rows;
}
