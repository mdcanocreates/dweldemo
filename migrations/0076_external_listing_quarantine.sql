-- Quarantine staging for authorized external listing packages.
-- These rows are never public listings. Publication requires a separate rights gate.
-- Access is bypass-only until a verified provider org claims a property.

create table external_source (
  id                      uuid primary key default gen_random_uuid(),
  provider_key            text not null unique,
  display_name            text not null,
  license_evidence_ref    text,
  permitted_fields        text[] not null default '{}',
  attribution_text        text,
  refresh_interval_hours  int,
  expiry_policy           text,
  geo_market_scope        text,
  status                  text not null default 'unverified'
                            check (status in ('unverified', 'approved', 'suspended')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table external_source_snapshot (
  id                      uuid primary key default gen_random_uuid(),
  external_source_id      uuid not null references external_source(id),
  batch_id                text not null,
  external_id             text not null,
  retrieved_at            timestamptz not null default now(),
  as_of                   timestamptz,
  payload_checksum        text not null,
  raw_payload             jsonb not null,
  package_name            text not null,
  created_at              timestamptz not null default now(),
  unique (external_source_id, external_id, payload_checksum)
);
create index external_source_snapshot_batch_idx
  on external_source_snapshot (batch_id, external_source_id);

create table external_property_candidate (
  id                          uuid primary key default gen_random_uuid(),
  external_source_id          uuid not null references external_source(id),
  external_id                 text not null,
  latest_snapshot_id          uuid references external_source_snapshot(id),
  property_name               text,
  line1                       text,
  city                        text,
  state                       text,
  postal_code                 text,
  address_key                 text,
  latitude                    double precision,
  longitude                   double precision,
  location_precision          text check (location_precision in ('area', 'approximate', 'unknown')),
  listing_kind                text not null check (listing_kind in ('market_deal', 'hud_assisted', 'unknown')),
  review_state                text not null default 'pending_review'
                                check (review_state in (
                                  'pending_review', 'needs_manual_review', 'rights_blocked',
                                  'approved_for_publish', 'rejected', 'duplicate'
                                )),
  rights_validated            boolean not null default false,
  duplicate_of_candidate_id   uuid references external_property_candidate(id),
  match_confidence            numeric(4,3),
  source_updated_at           timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (external_source_id, external_id)
);
create index external_property_candidate_address_key_idx
  on external_property_candidate (address_key)
  where address_key is not null;

create table listing_offer_candidate (
  id                          uuid primary key default gen_random_uuid(),
  candidate_id                uuid not null references external_property_candidate(id) on delete cascade,
  display_text                text not null,
  offer_type                  text not null check (offer_type in (
                                'weeks_free', 'months_free', 'dollar_credit', 'fee_waiver', 'other'
                              )),
  qualifier_text              text,
  numeric_value               numeric,
  unit_label                  text,
  starts_on                   date,
  ends_on                     date,
  source_reference            text,
  validated_at                timestamptz,
  offer_status                text not null default 'unverified'
                                check (offer_status in ('unverified', 'verified', 'stale', 'rejected')),
  created_at                  timestamptz not null default now()
);
create index listing_offer_candidate_candidate_idx on listing_offer_candidate (candidate_id);

create table property_contact_candidate (
  id                          uuid primary key default gen_random_uuid(),
  candidate_id                uuid not null references external_property_candidate(id) on delete cascade,
  relationship_kind           text not null check (relationship_kind in ('property', 'management_firm', 'unknown')),
  contact_name                text,
  contact_title               text,
  contact_email               text,
  contact_phone               text,
  source_provenance           text not null,
  verification_state          text not null default 'unverified'
                                check (verification_state in (
                                  'unverified', 'format_ok', 'verified', 'bounced', 'opted_out', 'rejected'
                                )),
  last_verified_at            timestamptz,
  created_at                  timestamptz not null default now()
);
create index property_contact_candidate_candidate_idx on property_contact_candidate (candidate_id);

create table external_import_run (
  id                          uuid primary key default gen_random_uuid(),
  batch_id                    text not null unique,
  mode                        text not null check (mode in ('dry_run', 'quarantine_write')),
  package_root                text not null,
  status                      text not null check (status in ('succeeded', 'failed')),
  records_seen                int not null default 0,
  distinct_external_ids       int not null default 0,
  snapshots_written           int not null default 0,
  candidates_written          int not null default 0,
  contacts_written            int not null default 0,
  offers_written              int not null default 0,
  address_collision_groups    int not null default 0,
  rights_blocked              int not null default 0,
  report_json                 jsonb not null default '{}'::jsonb,
  error_detail                text,
  started_at                  timestamptz not null default now(),
  finished_at                 timestamptz
);

alter table external_source enable row level security;
alter table external_source force row level security;
alter table external_source_snapshot enable row level security;
alter table external_source_snapshot force row level security;
alter table external_property_candidate enable row level security;
alter table external_property_candidate force row level security;
alter table listing_offer_candidate enable row level security;
alter table listing_offer_candidate force row level security;
alter table property_contact_candidate enable row level security;
alter table property_contact_candidate force row level security;
alter table external_import_run enable row level security;
alter table external_import_run force row level security;

create policy external_source_system on external_source
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');
create policy external_source_snapshot_system on external_source_snapshot
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');
create policy external_property_candidate_system on external_property_candidate
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');
create policy listing_offer_candidate_system on listing_offer_candidate
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');
create policy property_contact_candidate_system on property_contact_candidate
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');
create policy external_import_run_system on external_import_run
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

grant select, insert, update on external_source to rbit_app, rbit_app_user;
grant select, insert, update on external_source_snapshot to rbit_app, rbit_app_user;
grant select, insert, update on external_property_candidate to rbit_app, rbit_app_user;
grant select, insert, update on listing_offer_candidate to rbit_app, rbit_app_user;
grant select, insert, update on property_contact_candidate to rbit_app, rbit_app_user;
grant select, insert, update on external_import_run to rbit_app, rbit_app_user;
