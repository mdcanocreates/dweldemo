-- §14.2 Search event capture (async buffer → monthly partitions)
-- Never on the transactional write path of application/placement.

create table search_event (
  id                  bigserial,
  occurred_at         timestamptz not null default now(),
  session_id          uuid,
  party_id            uuid,
  submarket_id        uuid,
  h3_r8               text,
  bedrooms_min        numeric(3,1),
  bedrooms_max        numeric(3,1),
  rent_min_cents      int,
  rent_max_cents      int,
  filters             jsonb,
  result_count        int not null,
  clicked_listing_ids uuid[],
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- Default partition catches out-of-range / test inserts; monthly partitions added by ETL.
create table search_event_default partition of search_event default;

create table search_event_y2026m01 partition of search_event
  for values from ('2026-01-01') to ('2026-02-01');
create table search_event_y2026m02 partition of search_event
  for values from ('2026-02-01') to ('2026-03-01');
create table search_event_y2026m03 partition of search_event
  for values from ('2026-03-01') to ('2026-04-01');
create table search_event_y2026m04 partition of search_event
  for values from ('2026-04-01') to ('2026-05-01');
create table search_event_y2026m05 partition of search_event
  for values from ('2026-05-01') to ('2026-06-01');
create table search_event_y2026m06 partition of search_event
  for values from ('2026-06-01') to ('2026-07-01');
create table search_event_y2026m07 partition of search_event
  for values from ('2026-07-01') to ('2026-08-01');
create table search_event_y2026m08 partition of search_event
  for values from ('2026-08-01') to ('2026-09-01');
create table search_event_y2026m09 partition of search_event
  for values from ('2026-09-01') to ('2026-10-01');
create table search_event_y2026m10 partition of search_event
  for values from ('2026-10-01') to ('2026-11-01');
create table search_event_y2026m11 partition of search_event
  for values from ('2026-11-01') to ('2026-12-01');
create table search_event_y2026m12 partition of search_event
  for values from ('2026-12-01') to ('2027-01-01');
create table search_event_y2027m01 partition of search_event
  for values from ('2027-01-01') to ('2027-02-01');

-- §14.2 Nightly rollup target (columns from prose; full DDL not in spec — see phase5/spec-gaps)
create table search_demand_daily (
  date            date not null,
  submarket_id    uuid,
  bed_band        text not null,
  rent_band       text not null,
  searches        int not null default 0,
  zero_results    int not null default 0,
  clicks          int not null default 0
);
create unique index search_demand_daily_uidx
  on search_demand_daily (date, submarket_id, bed_band, rent_band) nulls not distinct;
create index on search_demand_daily (submarket_id, date desc);
