-- B-1 Shareable renter verification badge

alter table renter_profile
  add column if not exists badge_share_token text;
alter table renter_profile
  add column if not exists badge_share_enabled boolean not null default false;
alter table renter_profile
  add column if not exists badge_share_views int not null default 0;

create unique index if not exists renter_profile_badge_share_token_uidx
  on renter_profile (badge_share_token)
  where badge_share_token is not null;

create table badge_share_view (
  id                uuid primary key default gen_random_uuid(),
  renter_profile_id uuid not null references renter_profile(id),
  viewer_ip         inet,
  viewer_ua         text,
  referrer          text,
  is_authenticated  boolean not null default false,
  viewer_party_id   uuid references party(id),
  occurred_at       timestamptz not null default now()
);
create index on badge_share_view (renter_profile_id, occurred_at desc);

-- Public badge read: bind token via transaction-local GUC (no broad leak)
drop policy if exists renter_profile_badge_token_read on renter_profile;
create policy renter_profile_badge_token_read on renter_profile
  for select
  using (
    badge_share_enabled = true
    and badge_share_token is not null
    and badge_share_token = nullif(current_setting('rbit.badge_share_token', true), '')
  );

drop policy if exists renter_profile_badge_view_increment on renter_profile;
create policy renter_profile_badge_view_increment on renter_profile
  for update
  using (
    badge_share_enabled = true
    and badge_share_token is not null
    and badge_share_token = nullif(current_setting('rbit.badge_share_token', true), '')
  )
  with check (
    badge_share_enabled = true
    and badge_share_token is not null
    and badge_share_token = nullif(current_setting('rbit.badge_share_token', true), '')
  );

alter table badge_share_view enable row level security;
alter table badge_share_view force row level security;

-- Owner (renter) can read own view log; public insert when token GUC matches
drop policy if exists badge_share_view_owner on badge_share_view;
create policy badge_share_view_owner on badge_share_view
  for select
  using (
    exists (
      select 1 from renter_profile rp
      where rp.id = badge_share_view.renter_profile_id
        and rp.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

drop policy if exists badge_share_view_public_insert on badge_share_view;
create policy badge_share_view_public_insert on badge_share_view
  for insert
  with check (
    exists (
      select 1 from renter_profile rp
      where rp.id = badge_share_view.renter_profile_id
        and rp.badge_share_enabled = true
        and rp.badge_share_token = nullif(current_setting('rbit.badge_share_token', true), '')
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

grant select, insert on badge_share_view to rbit_app, rbit_app_user;
grant select, insert, update on renter_profile to rbit_app, rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app, rbit_app_user;
