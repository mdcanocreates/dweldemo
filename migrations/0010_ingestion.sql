-- §6A Ingestion (minimal for Phase 1).
-- raw_record is intentionally non-partitioned for test/dev simplicity
-- (spec partitions by received_at; see evidence/phase1/spec-gaps.txt).

create table mapping_profile (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  adapter_kind text not null,
  version      text not null,
  field_map    jsonb not null,
  value_maps   jsonb not null,
  created_at   timestamptz not null default now(),
  unique (name, version)
);

create table source_display_rule (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  version                 text not null,
  is_attribution_required boolean not null default false,
  attribution_text        text,
  suppress_fields         text[] not null default '{}',
  show_exact_address      boolean not null default true,
  media_policy            text not null check (media_policy in ('host','hotlink','none')),
  max_cache_age_seconds   int,
  purge_on_delist_hours   int,
  unique (name, version)
);

create table source (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references org(id),
  name                  text not null,
  adapter_kind          text not null,
  status                text not null check (status in
                          ('pending_auth','testing','dry_run','active',
                           'paused','failed','disabled')),
  credential_ref        text,
  config                jsonb not null,
  mapping_profile_id    uuid references mapping_profile(id),
  display_rule_id       uuid references source_display_rule(id),
  precedence            int not null default 100,
  sync_mode             text not null check (sync_mode in
                          ('pull_incremental','pull_full','push','manual')),
  sync_interval_seconds int,
  rate_limit_per_minute int,
  last_cursor           text,
  last_success_at       timestamptz,
  consecutive_failures  int not null default 0,
  created_at            timestamptz not null default now()
);

create table sync_run (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references source(id),
  run_kind          text not null check (run_kind in
                      ('incremental','full_reconcile','backfill','push','dry_run')),
  status            text not null check (status in
                      ('running','succeeded','failed','quarantined','aborted')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  cursor_from       text,
  cursor_to         text,
  records_fetched   int not null default 0,
  records_new       int not null default 0,
  records_changed   int not null default 0,
  records_unchanged int not null default 0,
  records_rejected  int not null default 0,
  records_absent    int not null default 0,
  quarantine_reason text,
  error_class       text,
  error_detail      text
);
create index on sync_run (source_id, started_at desc);

create table raw_record (
  id                 bigserial primary key,
  source_id          uuid not null,
  sync_run_id        uuid not null references sync_run(id),
  external_id        text not null,
  payload            jsonb,
  payload_ref        text,
  payload_hash       text not null,
  source_modified_at timestamptz,
  received_at        timestamptz not null default now(),
  transformed_at     timestamptz,
  mapping_version    text,
  transform_error    text
);
create unique index on raw_record (source_id, external_id, payload_hash, received_at);

create table source_listing (
  id                    uuid primary key default gen_random_uuid(),
  source_id             uuid not null references source(id),
  org_id                uuid not null,
  external_id           text not null,
  raw_record_id         bigint,
  address_id            uuid references address(id),
  unit_id               uuid references unit(id),
  resolution_status     text not null check (resolution_status in
                          ('pending','resolved','ambiguous','unresolvable')),
  resolution_confidence numeric,
  rent_amount_cents     int,
  deposit_cents         int,
  bedrooms              numeric(3,1),
  bathrooms             numeric(3,1),
  sqft                  int,
  available_on          date,
  lease_term_months     int,
  description           text,
  source_status_raw     text,
  mapped_status         text check (mapped_status in
                          ('active','pending','delisted','rented')),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  absent_since          timestamptz,
  mapping_version       text not null,
  unique (source_id, external_id)
);
create index on source_listing (unit_id) where mapped_status = 'active';
create index on source_listing (resolution_status) where resolution_status <> 'resolved';

create table listing_field_provenance (
  listing_id        uuid not null references listing(id),
  field_name        text not null,
  source_listing_id uuid not null references source_listing(id),
  value_hash        text not null,
  set_at            timestamptz not null default now(),
  primary key (listing_id, field_name)
);

create table unit_source_conflict (
  id                   uuid primary key default gen_random_uuid(),
  unit_id              uuid not null references unit(id),
  field_name           text not null,
  values_seen          jsonb not null,
  detected_at          timestamptz not null default now(),
  resolved_at          timestamptz,
  resolved_by_party_id uuid,
  resolution           text
);

alter table listing add constraint listing_primary_source_fk
  foreign key (primary_source_listing_id) references source_listing(id);
