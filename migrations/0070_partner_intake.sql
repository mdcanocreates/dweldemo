-- Prospective landlord and broker intake. Party-scoped until an admin
-- approval creates the organization and grants the portal role.

create table partner_intake (
  id                 uuid primary key default gen_random_uuid(),
  party_id           uuid not null references party(id),
  role               text not null check (role in ('landlord', 'broker')),
  status             text not null default 'new' check (status in ('new', 'under_review', 'approved', 'rejected')),
  full_name          text not null,
  email              text not null,
  phone              text not null,
  organization_name  text not null,
  market             text not null,
  portfolio_size     text not null,
  property_types     text,
  notes              text,
  org_id             uuid references org(id),
  reviewed_by        uuid references party(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index partner_intake_party_role_idx
  on partner_intake (party_id, role, created_at desc);

create unique index partner_intake_open_party_role_uidx
  on partner_intake (party_id, role)
  where status in ('new', 'under_review');

create index partner_intake_status_idx
  on partner_intake (status, created_at desc);

alter table partner_intake enable row level security;
alter table partner_intake force row level security;

drop policy if exists partner_intake_party_isolation on partner_intake;
create policy partner_intake_party_isolation on partner_intake
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

grant select, insert, update on partner_intake to rbit_app;
grant select, insert, update on partner_intake to rbit_app_user;
