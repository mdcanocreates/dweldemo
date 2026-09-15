-- Part H: landlord settings, contact reveal, self-execution evidence

alter table org
  add column if not exists screening_mode text not null default 'auto_screen'
    check (screening_mode in ('auto_screen', 'manual_review'));

alter table landlord_decision
  add column if not exists contact_revealed_at timestamptz;

alter table application
  add column if not exists contact_revealed_at timestamptz;

create table if not exists landlord_self_execution (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references org(id),
  submitted_by_party_id uuid not null references party(id),
  license_state         text not null,
  license_type          text not null check (license_type in
                          ('licensed_broker','licensed_pm','owner_occupant')),
  license_number        text,
  business_entity_name  text,
  storage_key           text,
  original_filename     text,
  content_type          text,
  status                text not null default 'pending'
                          check (status in ('pending','verified','rejected')),
  reviewer_notes        text,
  reviewed_by_party_id  uuid references party(id),
  reviewed_at           timestamptz,
  compliance_tag        text not null default 'interim_v1',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists landlord_self_execution_org
  on landlord_self_execution (org_id, created_at desc);
create index if not exists landlord_self_execution_status
  on landlord_self_execution (status, created_at desc);

alter table landlord_self_execution enable row level security;
drop policy if exists landlord_self_execution_tenant on landlord_self_execution;
create policy landlord_self_execution_tenant on landlord_self_execution
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  );

grant select, insert, update on landlord_self_execution to rbit_app;
grant select, insert, update on landlord_self_execution to rbit_app_user;
grant select, insert, update, delete on landlord_self_execution to rbit_migrator;

alter table listing
  add column if not exists pets_allowed boolean,
  add column if not exists amenities text[] not null default '{}';
