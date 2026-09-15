-- Listing media for marketplace galleries (no stock URLs — rows only when attached).
-- org_id denormalized from listing for tenant RLS.

create table listing_media (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listing(id) on delete cascade,
  org_id       uuid not null references org(id),
  position     int not null default 0,
  url          text,
  storage_key  text,
  content_type text,
  created_at   timestamptz not null default now(),
  check (url is not null or storage_key is not null)
);

create index on listing_media (listing_id, position);
create index on listing_media (org_id);

alter table listing_media enable row level security;
alter table listing_media force row level security;

create policy listing_media_tenant_isolation on listing_media
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- Public browse: media for active listings only (join-safe with public listing read).
create policy listing_media_public_active_read on listing_media
  for select
  using (
    exists (
      select 1 from listing l
      where l.id = listing_media.listing_id
        and l.status = 'active'
    )
  );

grant select, insert, update, delete on listing_media to rbit_app;
grant select, insert, update, delete on listing_media to rbit_migrator;
