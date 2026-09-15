/**
 * TypeScript ETL stand-in for nightly dbt → reporting schema (§15).
 * No ClickHouse. Reads transactional (or replica) tables; writes reporting marts.
 */

import type { DbClient } from '../../db/pool.js';
import { rollupSearchDemandDaily } from './search-events.js';

export type EtlResult = {
  fct_application: number;
  fct_placement: number;
  fct_lead: number;
  fct_solar_deal: number;
  fct_ledger_entry: number;
  dim_party_features: number;
  dim_submarket: number;
  dim_listing: number;
  agg_search_demand_daily: number;
  agg_supply_daily: number;
  agg_label_coverage: number;
};

export async function runReportingEtl(
  client: DbClient,
  opts?: { asOf?: Date },
): Promise<EtlResult> {
  const asOf = opts?.asOf ?? new Date();
  const asOfDate = asOf.toISOString().slice(0, 10);

  // Ensure search_demand_daily is current for asOf day before copying to reporting
  await rollupSearchDemandDaily(client, asOf);

  const fct_application = await upsertFctApplication(client);
  const fct_placement = await upsertFctPlacement(client);
  const fct_lead = await upsertFctLead(client);
  const fct_solar_deal = await upsertFctSolarDeal(client);
  const fct_ledger_entry = await upsertFctLedgerEntry(client);
  const dim_party_features = await upsertDimPartyFeatures(client);
  const dim_submarket = await upsertDimSubmarket(client);
  const dim_listing = await upsertDimListing(client);
  const agg_search_demand_daily = await copySearchDemand(client, asOfDate);
  const agg_supply_daily = await upsertAggSupplyDaily(client, asOfDate);
  const agg_label_coverage = await upsertAggLabelCoverage(client, asOfDate);

  return {
    fct_application,
    fct_placement,
    fct_lead,
    fct_solar_deal,
    fct_ledger_entry,
    dim_party_features,
    dim_submarket,
    dim_listing,
    agg_search_demand_daily,
    agg_supply_daily,
    agg_label_coverage,
  };
}

async function upsertFctApplication(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.fct_application (
      application_id, org_id, party_id, listing_id, unit_id, status, entry_point,
      submitted_at, screened_at, closed_at, created_at, etl_loaded_at
    )
    select id, org_id, party_id, listing_id, unit_id, status, entry_point,
           submitted_at, screened_at, closed_at, created_at, now()
    from application
    on conflict (application_id) do update set
      status = excluded.status,
      submitted_at = excluded.submitted_at,
      screened_at = excluded.screened_at,
      closed_at = excluded.closed_at,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertFctPlacement(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.fct_placement (
      placement_id, application_id, listing_id, unit_id, org_id, status,
      hold_expires_at, lease_signed_at, funded_at, created_at, etl_loaded_at
    )
    select id, application_id, listing_id, unit_id, org_id, status,
           hold_expires_at, lease_signed_at, funded_at, accepted_at, now()
    from placement
    on conflict (placement_id) do update set
      status = excluded.status,
      hold_expires_at = excluded.hold_expires_at,
      lease_signed_at = excluded.lease_signed_at,
      funded_at = excluded.funded_at,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertFctLead(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.fct_lead (
      lead_id, application_id, listing_id, party_id, rs_tier, fee_amount_cents,
      status, created_at, etl_loaded_at
    )
    select id, application_id, listing_id, party_id, rs_tier, fee_amount_cents,
           status, created_at, now()
    from lead
    on conflict (lead_id) do update set
      status = excluded.status,
      fee_amount_cents = excluded.fee_amount_cents,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertFctSolarDeal(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.fct_solar_deal (
      solar_deal_id, homeowner_party_id, partner_org_id, system_size_kw,
      status, submitted_at, decided_at, etl_loaded_at
    )
    select id, homeowner_party_id, partner_org_id, system_size_kw,
           status, submitted_at, decided_at, now()
    from solar_deal
    on conflict (solar_deal_id) do update set
      status = excluded.status,
      submitted_at = excluded.submitted_at,
      decided_at = excluded.decided_at,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertFctLedgerEntry(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.fct_ledger_entry (
      entry_id, transaction_id, account_id, account_code, direction,
      amount_cents, occurred_at, kind, etl_loaded_at
    )
    select e.id, e.transaction_id, e.account_id, a.code, e.direction,
           e.amount_cents, t.occurred_at, t.kind, now()
    from ledger_entry e
    join ledger_transaction t on t.id = e.transaction_id
    join ledger_account a on a.id = e.account_id
    on conflict (entry_id) do update set
      amount_cents = excluded.amount_cents,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertDimPartyFeatures(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.dim_party_features (party_id, features, purged_at, etl_loaded_at)
    select
      pf.party_id,
      jsonb_build_object(
        'first_seen_at', pf.first_seen_at,
        'home_submarket_id', pf.home_submarket_id,
        'home_h3_r8', pf.home_h3_r8,
        'income_band', pf.income_band,
        'employment_band', pf.employment_band,
        'household_size', pf.household_size,
        'application_count', pf.application_count,
        'placement_count', pf.placement_count,
        'latest_score', pf.latest_score
      ),
      p.purged_at,
      now()
    from party_features pf
    join party p on p.id = pf.party_id
    on conflict (party_id) do update set
      features = excluded.features,
      purged_at = excluded.purged_at,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertDimSubmarket(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.dim_submarket (
      submarket_id, name, metro_code, version, is_active, etl_loaded_at
    )
    select id, name, metro_code, version, is_active, now()
    from submarket
    on conflict (submarket_id) do update set
      name = excluded.name,
      is_active = excluded.is_active,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function upsertDimListing(client: DbClient): Promise<number> {
  const { rowCount } = await client.query(`
    insert into reporting.dim_listing (
      listing_id, org_id, unit_id, submarket_id, rent_amount_cents, bedrooms,
      status, published_at, expires_at, created_at, etl_loaded_at
    )
    select l.id, l.org_id, l.unit_id, a.submarket_id, l.rent_amount_cents, u.bedrooms,
           l.status, l.published_at, l.expires_at, l.created_at, now()
    from listing l
    join unit u on u.id = l.unit_id
    join property p on p.id = u.property_id
    join address a on a.id = p.address_id
    on conflict (listing_id) do update set
      rent_amount_cents = excluded.rent_amount_cents,
      status = excluded.status,
      submarket_id = excluded.submarket_id,
      expires_at = excluded.expires_at,
      etl_loaded_at = now()
  `);
  return rowCount ?? 0;
}

async function copySearchDemand(client: DbClient, asOfDate: string): Promise<number> {
  await client.query(
    `delete from reporting.agg_search_demand_daily where date = $1::date`,
    [asOfDate],
  );
  const { rowCount } = await client.query(
    `insert into reporting.agg_search_demand_daily (
       date, submarket_id, bed_band, rent_band, searches, zero_results, clicks
     )
     select date, submarket_id, bed_band, rent_band, searches, zero_results, clicks
     from search_demand_daily
     where date = $1::date`,
    [asOfDate],
  );
  return rowCount ?? 0;
}

async function upsertAggSupplyDaily(
  client: DbClient,
  asOfDate: string,
): Promise<number> {
  await client.query(
    `delete from reporting.agg_supply_daily where date = $1::date`,
    [asOfDate],
  );
  const { rowCount } = await client.query(
    `insert into reporting.agg_supply_daily (
       date, submarket_id, active_listings, stale_listings, expired_listings, median_rent_cents
     )
     select
       $1::date,
       a.submarket_id,
       count(*) filter (where l.status = 'active')::int,
       count(*) filter (where l.status = 'stale')::int,
       count(*) filter (where l.status = 'expired')::int,
       percentile_cont(0.5) within group (order by l.rent_amount_cents)
         filter (where l.status = 'active')::int
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     group by a.submarket_id`,
    [asOfDate],
  );
  return rowCount ?? 0;
}

/**
 * Label coverage: response rates at 30/90(/180/365) day horizons among outcomes due.
 */
async function upsertAggLabelCoverage(
  client: DbClient,
  asOfDate: string,
): Promise<number> {
  await client.query(
    `delete from reporting.agg_label_coverage where as_of_date = $1::date`,
    [asOfDate],
  );
  const { rowCount } = await client.query(
    `insert into reporting.agg_label_coverage (
       as_of_date, horizon_days, due_count, responded_count, response_rate
     )
     select
       $1::date,
       horizon_days,
       count(*)::int as due_count,
       count(*) filter (where reported_at is not null)::int as responded_count,
       case when count(*) = 0 then 0
            else (count(*) filter (where reported_at is not null))::numeric / count(*)::numeric
       end as response_rate
     from placement_outcome
     where requested_at <= $1::date + interval '1 day'
     group by horizon_days`,
    [asOfDate],
  );
  return rowCount ?? 0;
}
