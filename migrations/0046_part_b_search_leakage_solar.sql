-- B-5 search alerts + B-6 leakage + B-7 solar statements (batched schema)

-- B-5
create table search_alert (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid references party(id),
  email_hmac        bytea,
  confirm_token     text unique,
  confirmed_at      timestamptz,
  submarket_id      uuid references submarket(id),
  bedrooms_min      numeric(3,1),
  rent_max_cents    int,
  move_in_by        date,
  has_pets          boolean,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  last_notified_at  timestamptz,
  match_count       int not null default 0,
  unsubscribed_at   timestamptz,
  unsubscribe_token text unique
);
create index on search_alert (submarket_id, is_active) where is_active = true;
create index on search_alert (email_hmac) where email_hmac is not null;

alter table search_alert enable row level security;
alter table search_alert force row level security;
create policy search_alert_party on search_alert
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
    or (party_id is null and email_hmac is not null)
  );
-- Public unsubscribe by token GUC
create policy search_alert_unsub_token on search_alert
  for update
  using (
    unsubscribe_token = nullif(current_setting('rbit.search_alert_unsub_token', true), '')
  )
  with check (true);

grant select, insert, update on search_alert to rbit_app, rbit_app_user;

-- B-6
create table listing_leakage_event (
  id                   uuid primary key default gen_random_uuid(),
  listing_id           uuid not null references listing(id),
  org_id               uuid not null references org(id),
  rented_via           text not null check (rented_via in
                         ('rbit_placement','rbit_broker_offplatform','own_broker','direct','other')),
  broker_party_id      uuid references party(id),
  broker_org_id        uuid references org(id),
  placement_id         uuid references placement(id),
  reported_by_party_id uuid not null references party(id),
  occurred_at          timestamptz not null default now()
);
create index on listing_leakage_event (org_id, occurred_at desc);
create index on listing_leakage_event (listing_id);

alter table listing_leakage_event enable row level security;
alter table listing_leakage_event force row level security;
create policy listing_leakage_event_tenant on listing_leakage_event
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

grant select, insert on listing_leakage_event to rbit_app, rbit_app_user;

-- B-7
create table solar_remittance_statement (
  id                    uuid primary key default gen_random_uuid(),
  partner_org_id        uuid not null references org(id),
  period_start          date not null,
  period_end            date not null,
  deal_count            int not null,
  expected_total_cents  bigint not null,
  generated_at          timestamptz not null default now(),
  sent_at               timestamptz,
  document_id           uuid references document(id),
  status                text not null check (status in
                          ('draft','sent','matched','variance','disputed'))
);

create table solar_remittance_statement_line (
  id                        uuid primary key default gen_random_uuid(),
  statement_id              uuid not null references solar_remittance_statement(id),
  solar_deal_id             uuid not null references solar_deal(id),
  approved_cashback_cents   int not null,
  net_to_rbit_cents         bigint not null,
  expected_remittance_cents bigint not null,
  deal_installed_at         timestamptz,
  deal_status               text not null
);

alter table solar_remittance_statement enable row level security;
alter table solar_remittance_statement force row level security;
create policy solar_remittance_statement_tenant on solar_remittance_statement
  using (
    partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

alter table solar_remittance_statement_line enable row level security;
alter table solar_remittance_statement_line force row level security;
create policy solar_remittance_statement_line_tenant on solar_remittance_statement_line
  using (
    exists (
      select 1 from solar_remittance_statement s
      where s.id = solar_remittance_statement_line.statement_id
        and (
          s.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
          or current_setting('rbit.bypass_rls', true) = 'on'
        )
    )
  )
  with check (
    exists (
      select 1 from solar_remittance_statement s
      where s.id = solar_remittance_statement_line.statement_id
        and (
          s.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
          or current_setting('rbit.bypass_rls', true) = 'on'
        )
    )
  );

grant select, insert, update on solar_remittance_statement, solar_remittance_statement_line
  to rbit_app, rbit_app_user;
