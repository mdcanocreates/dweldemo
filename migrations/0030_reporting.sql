-- §15 Analytics warehouse — reporting schema star marts on same cluster
-- Column sets derived from source entities; full mart DDL not in spec (see phase5/spec-gaps).

create schema if not exists reporting;

create table reporting.fct_application (
  application_id          uuid primary key,
  org_id                  uuid not null,
  party_id                uuid not null,
  listing_id              uuid,
  unit_id                 uuid,
  status                  text not null,
  entry_point             text not null,
  submitted_at            timestamptz,
  screened_at             timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz not null,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.fct_placement (
  placement_id            uuid primary key,
  application_id          uuid not null,
  listing_id              uuid not null,
  unit_id                 uuid not null,
  org_id                  uuid not null,
  status                  text not null,
  hold_expires_at         timestamptz,
  lease_signed_at         timestamptz,
  funded_at               timestamptz,
  created_at              timestamptz not null,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.fct_lead (
  lead_id                 uuid primary key,
  application_id          uuid not null,
  listing_id              uuid not null,
  party_id                uuid not null,
  rs_tier                 text not null,
  fee_amount_cents        int not null,
  status                  text not null,
  created_at              timestamptz not null,
  etl_loaded_at           timestamptz not null default now()
);

-- Empty until Phase 6 solar vertical
create table reporting.fct_solar_deal (
  solar_deal_id           uuid primary key,
  homeowner_party_id      uuid not null,
  partner_org_id          uuid not null,
  system_size_kw          numeric(6,2),
  status                  text not null,
  submitted_at            timestamptz,
  decided_at              timestamptz,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.fct_ledger_entry (
  entry_id                bigint primary key,
  transaction_id          uuid not null,
  account_id              uuid not null,
  account_code            text not null,
  direction               char(2) not null,
  amount_cents            bigint not null,
  occurred_at             timestamptz not null,
  kind                    text not null,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.dim_party_features (
  party_id                uuid primary key,
  features                jsonb not null default '{}'::jsonb,
  purged_at               timestamptz,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.dim_submarket (
  submarket_id            uuid primary key,
  name                    text not null,
  metro_code              text not null,
  version                 text not null,
  is_active               boolean not null,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.dim_listing (
  listing_id              uuid primary key,
  org_id                  uuid not null,
  unit_id                 uuid not null,
  submarket_id            uuid,
  rent_amount_cents       int not null,
  bedrooms                numeric(3,1),
  status                  text not null,
  published_at            timestamptz,
  expires_at              timestamptz,
  created_at              timestamptz not null,
  etl_loaded_at           timestamptz not null default now()
);

create table reporting.agg_search_demand_daily (
  date                    date not null,
  submarket_id            uuid,
  bed_band                text not null,
  rent_band               text not null,
  searches                int not null default 0,
  zero_results            int not null default 0,
  clicks                  int not null default 0
);
create unique index agg_search_demand_daily_uidx
  on reporting.agg_search_demand_daily (date, submarket_id, bed_band, rent_band) nulls not distinct;

create table reporting.agg_supply_daily (
  date                    date not null,
  submarket_id            uuid,
  active_listings         int not null default 0,
  stale_listings          int not null default 0,
  expired_listings        int not null default 0,
  median_rent_cents       int
);
create unique index agg_supply_daily_uidx
  on reporting.agg_supply_daily (date, submarket_id) nulls not distinct;

create table reporting.agg_label_coverage (
  as_of_date              date not null,
  horizon_days            int not null check (horizon_days in (30, 90, 180, 365)),
  due_count               int not null default 0,
  responded_count         int not null default 0,
  response_rate           numeric(7,4) not null default 0,
  primary key (as_of_date, horizon_days)
);
