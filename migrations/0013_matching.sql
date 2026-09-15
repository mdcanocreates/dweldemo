-- §9 Matching + minimal score stub for landlord_decision.score_id FK

create table score (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid references application(id),
  renter_profile_id uuid references renter_profile(id),
  party_id          uuid not null references party(id),
  model_key         text not null,
  model_version     text not null,
  cohort_key        text not null,
  cohort_n          int not null,
  raw_score         numeric not null,
  percentile        numeric,
  band              text,
  feature_snapshot  jsonb not null,
  feature_sources   jsonb not null,
  explanation       jsonb not null,
  computed_at       timestamptz not null default now(),
  computed_by       text not null
);
create index on score (application_id, computed_at desc);
create index on score (party_id, computed_at desc);

create table landlord_interest (
  id                    uuid primary key default gen_random_uuid(),
  listing_id            uuid not null references listing(id),
  org_id                uuid not null,
  renter_profile_id     uuid not null references renter_profile(id),
  initiated_by_party_id uuid not null references party(id),
  message               text,
  status                text not null check (status in
                          ('sent','viewed','accepted','declined','expired','withdrawn')),
  sent_at               timestamptz not null default now(),
  responded_at          timestamptz,
  expires_at            timestamptz not null,
  search_filter_snapshot jsonb not null
);
create index on landlord_interest (renter_profile_id, status);

alter table application add constraint application_landlord_interest_fk
  foreign key (landlord_interest_id) references landlord_interest(id);

create table landlord_decision (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null references application(id),
  listing_id          uuid not null references listing(id),
  org_id              uuid not null,
  decided_by_party_id uuid not null references party(id),
  decision            text not null check (decision in
                        ('interested','approved','declined','withdrawn')),
  reason_codes        text[] not null default '{}',
  score_id            uuid references score(id),
  decided_at          timestamptz not null default now(),
  superseded_at       timestamptz
);
create index on landlord_decision (application_id, decided_at desc);
create unique index one_live_decision_per_application
  on landlord_decision (application_id) where superseded_at is null;

create table placement (
  id                   uuid primary key default gen_random_uuid(),
  unit_id              uuid not null references unit(id),
  listing_id           uuid not null references listing(id),
  application_id       uuid not null references application(id),
  party_id             uuid not null references party(id),
  org_id               uuid not null,
  broker_org_id        uuid references org(id),
  status               text not null check (status in
                         ('hold','broker_assigned','lease_signed','funded',
                          'closed','lapsed','cancelled')),
  hold_expires_at      timestamptz,
  hold_extension_count int not null default 0,
  accepted_at          timestamptz not null default now(),
  broker_assigned_at   timestamptz,
  lease_signed_at      timestamptz,
  funded_at            timestamptz,
  terminal_at          timestamptz
);

create unique index one_active_placement_per_unit on placement (unit_id)
  where status in ('hold','broker_assigned','lease_signed');

create unique index one_active_hold_per_party on placement (party_id)
  where status in ('hold','broker_assigned');

create table placement_queue_entry (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references listing(id),
  application_id uuid not null references application(id),
  rank_score     numeric not null,
  rank_position  int not null,
  entered_at     timestamptz not null default now(),
  promoted_at    timestamptz,
  exited_at      timestamptz,
  exit_reason    text
);
create unique index on placement_queue_entry (listing_id, application_id)
  where exited_at is null;
