-- Charter v3 NO-GO closure: partner attribution, preferred lease term,
-- broker delegation acceptance, lease renter access + acknowledgements.
-- Additive only. No DROP TABLE / TRUNCATE / destructive type changes.

-- ---------------------------------------------------------------------------
-- 1. Preferred lease term on application (prequal display)
-- ---------------------------------------------------------------------------
alter table application
  add column if not exists preferred_lease_term_months int;

alter table renter_profile
  add column if not exists preferred_lease_term_months int;

alter table renter_application_intake
  add column if not exists preferred_lease_term_months int;

-- ---------------------------------------------------------------------------
-- 2. Broker provider delegation (real relationship; drives access)
-- Also keeps org.managed_by_broker_org_id in sync transactionally (legacy path).
-- ---------------------------------------------------------------------------
create table if not exists broker_provider_delegation (
  id                   uuid primary key default gen_random_uuid(),
  broker_org_id        uuid not null references org(id),
  provider_org_id      uuid not null references org(id),
  invitation_id        uuid references broker_provider_invitation(id),
  status               text not null default 'accepted'
                         check (status in ('accepted', 'revoked')),
  permissions          text[] not null default array[
                         'view_listings',
                         'view_applicants',
                         'request_screening',
                         'recommend'
                       ]::text[],
  accepted_at          timestamptz not null default now(),
  revoked_at           timestamptz,
  accepted_by_party_id uuid references party(id),
  revoked_by_party_id  uuid references party(id),
  unique (broker_org_id, provider_org_id)
);

create index if not exists broker_provider_delegation_broker_idx
  on broker_provider_delegation (broker_org_id, status);
create index if not exists broker_provider_delegation_provider_idx
  on broker_provider_delegation (provider_org_id, status);

alter table broker_provider_delegation enable row level security;
alter table broker_provider_delegation force row level security;

drop policy if exists broker_provider_delegation_tenant on broker_provider_delegation;
create policy broker_provider_delegation_tenant on broker_provider_delegation
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or broker_org_id::text = current_setting('rbit.current_org_id', true)
    or provider_org_id::text = current_setting('rbit.current_org_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or broker_org_id::text = current_setting('rbit.current_org_id', true)
    or provider_org_id::text = current_setting('rbit.current_org_id', true)
  );

-- ---------------------------------------------------------------------------
-- 3. Lease document workflow (no e-sign claims)
-- ---------------------------------------------------------------------------
alter table lease_document
  add column if not exists workflow_status text;

-- Backfill then constrain
update lease_document
set workflow_status = case status
  when 'uploaded' then 'uploaded'
  when 'shared' then 'available_to_renter'
  when 'executed' then 'executed_copy_uploaded'
  when 'void' then 'void'
  else coalesce(workflow_status, 'uploaded')
end
where workflow_status is null;

alter table lease_document
  alter column workflow_status set default 'uploaded';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lease_document_workflow_status_chk'
  ) then
    alter table lease_document
      add constraint lease_document_workflow_status_chk
      check (workflow_status in (
        'not_started',
        'uploaded',
        'available_to_renter',
        'acknowledged',
        'executed_copy_uploaded',
        'complete',
        'void'
      ));
  end if;
end $$;

alter table lease_document
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by_party_id uuid references party(id),
  add column if not exists made_available_at timestamptz;

-- Renter may read leases for their own approved applications when available.
drop policy if exists lease_document_tenant on lease_document;
create policy lease_document_tenant on lease_document
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or (
      workflow_status in ('available_to_renter', 'acknowledged', 'executed_copy_uploaded', 'complete')
      and exists (
        select 1 from application a
        where a.id = lease_document.application_id
          and a.party_id::text = current_setting('rbit.current_party_id', true)
          and a.status = 'approved'
      )
    )
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or (
      exists (
        select 1 from application a
        where a.id = lease_document.application_id
          and a.party_id::text = current_setting('rbit.current_party_id', true)
          and a.status = 'approved'
      )
    )
  );

create table if not exists lease_document_access_log (
  id               uuid primary key default gen_random_uuid(),
  lease_document_id uuid not null references lease_document(id),
  party_id         uuid not null references party(id),
  action           text not null check (action in ('list', 'view', 'download', 'acknowledge')),
  ip               inet,
  user_agent       text,
  occurred_at      timestamptz not null default now()
);
create index if not exists lease_document_access_log_doc_idx
  on lease_document_access_log (lease_document_id, occurred_at desc);

alter table lease_document_access_log enable row level security;
alter table lease_document_access_log force row level security;
drop policy if exists lease_document_access_log_party on lease_document_access_log;
create policy lease_document_access_log_party on lease_document_access_log
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

-- ---------------------------------------------------------------------------
-- 4. Partner attribution (no payouts)
-- ---------------------------------------------------------------------------
create table if not exists partner_organization (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  partner_code text not null unique,
  partner_type text not null check (partner_type in (
    'nonprofit',
    'community_organization',
    'employer',
    'university',
    'housing_program',
    'government_program',
    'broker',
    'marketing_partner',
    'other'
  )),
  status       text not null default 'active'
                 check (status in ('active', 'inactive', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint partner_organization_code_len check (char_length(partner_code) between 2 and 64),
  constraint partner_organization_name_len check (char_length(name) between 1 and 200)
);

create table if not exists partner_campaign (
  id             uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references partner_organization(id),
  campaign_code  text not null,
  name           text not null,
  status         text not null default 'active'
                   check (status in ('active', 'inactive', 'ended')),
  starts_at      timestamptz,
  ends_at        timestamptz,
  landing_path   text,
  created_at     timestamptz not null default now(),
  unique (partner_org_id, campaign_code),
  constraint partner_campaign_code_len check (char_length(campaign_code) between 2 and 80)
);

create table if not exists visitor_attribution (
  id               uuid primary key default gen_random_uuid(),
  visitor_key      text not null unique,
  partner_org_id   uuid references partner_organization(id),
  campaign_id      uuid references partner_campaign(id),
  landing_path     text,
  http_referrer    text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index if not exists visitor_attribution_partner_idx
  on visitor_attribution (partner_org_id, first_seen_at desc);

create table if not exists party_acquisition (
  party_id              uuid primary key references party(id),
  first_touch_id        uuid references visitor_attribution(id),
  last_touch_id         uuid references visitor_attribution(id),
  acquisition_partner_org_id uuid references partner_organization(id),
  acquisition_campaign_id uuid references partner_campaign(id),
  bound_at              timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table application
  add column if not exists acquisition_first_touch_id uuid references visitor_attribution(id),
  add column if not exists acquisition_last_touch_id uuid references visitor_attribution(id),
  add column if not exists acquisition_partner_org_id uuid references partner_organization(id),
  add column if not exists acquisition_campaign_id uuid references partner_campaign(id);

-- Partner tables: internal/service access primarily; RLS force with bypass for app.
alter table partner_organization enable row level security;
alter table partner_organization force row level security;
drop policy if exists partner_organization_read on partner_organization;
create policy partner_organization_read on partner_organization
  for select using (true);
drop policy if exists partner_organization_write on partner_organization;
create policy partner_organization_write on partner_organization
  for all using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

alter table partner_campaign enable row level security;
alter table partner_campaign force row level security;
drop policy if exists partner_campaign_read on partner_campaign;
create policy partner_campaign_read on partner_campaign for select using (true);
drop policy if exists partner_campaign_write on partner_campaign;
create policy partner_campaign_write on partner_campaign
  for all using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

alter table visitor_attribution enable row level security;
alter table visitor_attribution force row level security;
drop policy if exists visitor_attribution_access on visitor_attribution;
create policy visitor_attribution_access on visitor_attribution
  for all using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

alter table party_acquisition enable row level security;
alter table party_acquisition force row level security;
drop policy if exists party_acquisition_party on party_acquisition;
create policy party_acquisition_party on party_acquisition
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    grant select, insert, update on broker_provider_delegation to rbit_app;
    grant select, insert on lease_document_access_log to rbit_app;
    grant select on partner_organization, partner_campaign to rbit_app;
    grant select, insert, update on visitor_attribution, party_acquisition to rbit_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    grant select, insert, update on broker_provider_delegation to rbit_app_user;
    grant select, insert on lease_document_access_log to rbit_app_user;
    grant select on partner_organization, partner_campaign to rbit_app_user;
    grant select, insert, update on visitor_attribution, party_acquisition to rbit_app_user;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    grant select, insert, update, delete on broker_provider_delegation to rbit_migrator;
    grant select, insert, update, delete on lease_document_access_log to rbit_migrator;
    grant select, insert, update, delete on partner_organization to rbit_migrator;
    grant select, insert, update, delete on partner_campaign to rbit_migrator;
    grant select, insert, update, delete on visitor_attribution to rbit_migrator;
    grant select, insert, update, delete on party_acquisition to rbit_migrator;
  end if;
end $$;
