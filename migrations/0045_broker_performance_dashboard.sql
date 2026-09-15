-- B-4 Broker performance dashboard (materialised prior window + per-submarket rollup)

alter table broker_performance
  add column if not exists prior_leads_offered int not null default 0;
alter table broker_performance
  add column if not exists prior_leads_accepted int not null default 0;
alter table broker_performance
  add column if not exists prior_placements_closed int not null default 0;
alter table broker_performance
  add column if not exists prior_close_rate numeric;
alter table broker_performance
  add column if not exists prior_median_response_seconds int;
alter table broker_performance
  add column if not exists prior_leakage_rate numeric;
alter table broker_performance
  add column if not exists prior_dispute_count int not null default 0;

create table broker_performance_submarket (
  org_id                  uuid not null references org(id),
  submarket_id            uuid not null references submarket(id),
  window_days             int not null default 90,
  leads_offered           int not null default 0,
  leads_accepted          int not null default 0,
  placements_closed       int not null default 0,
  close_rate              numeric,
  median_response_seconds int,
  updated_at              timestamptz not null default now(),
  primary key (org_id, submarket_id, window_days)
);

alter table broker_performance_submarket enable row level security;
alter table broker_performance_submarket force row level security;
drop policy if exists broker_performance_submarket_tenant on broker_performance_submarket;
create policy broker_performance_submarket_tenant on broker_performance_submarket
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

grant select, insert, update on broker_performance_submarket to rbit_app, rbit_app_user;
