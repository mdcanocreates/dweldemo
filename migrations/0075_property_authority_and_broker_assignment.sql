-- Property authority is separate from partner approval.
-- A broker assignment covers one property. It does not grant a landlord role.

alter table partner_intake
  add column if not exists reviewer_note text,
  add column if not exists provider_response text;

create table if not exists property_authority (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references org(id),
  property_id             uuid not null references property(id),
  submitted_by_party_id   uuid not null references party(id),
  authority_kind          text not null check (authority_kind in ('owner', 'manager')),
  statement               text not null,
  status                  text not null default 'pending'
                            check (status in ('pending', 'verified', 'rejected')),
  reviewer_note           text,
  reviewed_by_party_id    uuid references party(id),
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists property_authority_open_uidx
  on property_authority (org_id, property_id)
  where status in ('pending', 'verified');

alter table property_authority enable row level security;
alter table property_authority force row level security;

drop policy if exists property_authority_tenant on property_authority;
create policy property_authority_tenant on property_authority
  for all
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

create table if not exists property_broker_assignment (
  id                    uuid primary key default gen_random_uuid(),
  broker_org_id         uuid not null references org(id),
  provider_org_id       uuid not null references org(id),
  property_id           uuid not null references property(id),
  status                text not null default 'active' check (status in ('active', 'revoked')),
  granted_by_party_id   uuid not null references party(id),
  revoked_by_party_id   uuid references party(id),
  revoked_at            timestamptz,
  created_at            timestamptz not null default now()
);

create unique index if not exists property_broker_assignment_active_uidx
  on property_broker_assignment (broker_org_id, property_id)
  where status = 'active';

alter table property_broker_assignment enable row level security;
alter table property_broker_assignment force row level security;

drop policy if exists property_broker_assignment_parties on property_broker_assignment;
create policy property_broker_assignment_parties on property_broker_assignment
  for all
  using (
    provider_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    provider_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

drop policy if exists property_authority_broker_read on property_authority;
create policy property_authority_broker_read on property_authority
  for select
  using (
    exists (
      select 1 from property_broker_assignment pba
      where pba.property_id = property_authority.property_id
        and pba.provider_org_id = property_authority.org_id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  );

drop policy if exists listing_broker_assignment on listing;
create policy listing_broker_assignment on listing
  for select
  using (
    exists (
      select 1
      from unit u
      join property_broker_assignment pba on pba.property_id = u.property_id
      where u.id = listing.unit_id
        and pba.provider_org_id = listing.org_id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  );

drop policy if exists listing_broker_assignment_update on listing;
create policy listing_broker_assignment_update on listing
  for update
  using (
    exists (
      select 1
      from unit u
      join property_broker_assignment pba on pba.property_id = u.property_id
      where u.id = listing.unit_id
        and pba.provider_org_id = listing.org_id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  )
  with check (
    exists (
      select 1
      from unit u
      join property_broker_assignment pba on pba.property_id = u.property_id
      where u.id = listing.unit_id
        and pba.provider_org_id = listing.org_id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  );

drop policy if exists application_broker_assignment_read on application;
create policy application_broker_assignment_read on application
  for select
  using (
    exists (
      select 1
      from unit u
      join property_broker_assignment pba on pba.property_id = u.property_id
      where u.id = application.unit_id
        and pba.provider_org_id = application.org_id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  );

drop policy if exists renter_profile_broker_assignment_read on renter_profile;
create policy renter_profile_broker_assignment_read on renter_profile
  for select
  using (
    exists (
      select 1
      from application a
      join unit u on u.id = a.unit_id
      join property_broker_assignment pba
        on pba.property_id = u.property_id
       and pba.provider_org_id = a.org_id
      where a.renter_profile_id = renter_profile.id
        and pba.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and pba.status = 'active'
        and pba.revoked_at is null
    )
  );

grant select, insert, update on property_authority to rbit_app;
grant select, insert, update on property_authority to rbit_app_user;
grant select, insert, update on property_broker_assignment to rbit_app;
grant select, insert, update on property_broker_assignment to rbit_app_user;
