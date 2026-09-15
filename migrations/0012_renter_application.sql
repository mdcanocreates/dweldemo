-- §7.1 renter_profile + §7.7 application

create table renter_profile (
  id                    uuid primary key default gen_random_uuid(),
  party_id              uuid not null unique references party(id),
  target_submarket_ids  uuid[] not null default '{}',
  rent_max_cents        int,
  bedrooms_min          numeric(3,1),
  move_in_earliest      date,
  move_in_latest        date,
  household_size        int,
  has_pets              boolean,
  badge_state           text not null default 'unverified' check (badge_state in
                          ('unverified','prechecked','fully_screened')),
  badge_computed_at     timestamptz,
  is_discoverable       boolean not null default false,
  discoverability_level text not null default 'minimal' check (discoverability_level in
                          ('minimal','full')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on renter_profile (badge_state) where is_discoverable = true;

create table application (
  id                      uuid primary key default gen_random_uuid(),
  party_id                uuid not null references party(id),
  renter_profile_id       uuid not null references renter_profile(id),
  listing_id              uuid references listing(id),
  unit_id                 uuid references unit(id),
  org_id                  uuid not null,
  entry_point             text not null check (entry_point in
                            ('renter_initiated','landlord_invited')),
  landlord_interest_id    uuid,
  status                  text not null,
  submitted_at            timestamptz,
  screening_authorized_at timestamptz,
  screened_at             timestamptz,
  closed_at               timestamptz,
  expires_at              timestamptz,
  source_channel          text,
  device_id               text,
  created_at              timestamptz not null default now()
);
create index on application (party_id, status);
create index on application (listing_id, status);
