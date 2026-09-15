-- B-3 Device-based fraud prescreen

create table device_fingerprint (
  id                uuid primary key default gen_random_uuid(),
  device_id         text not null,
  party_id          uuid not null references party(id),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  application_count int not null default 0,
  identity_count    int not null default 0,
  is_flagged        boolean not null default false,
  flagged_at        timestamptz,
  flagged_reason    text
);
create unique index on device_fingerprint (device_id, party_id);
create index on device_fingerprint (device_id);
create index on device_fingerprint (is_flagged) where is_flagged = true;

create table device_identity_edge (
  device_id     text not null,
  party_id      uuid not null references party(id),
  first_seen_at timestamptz not null default now(),
  primary key (device_id, party_id)
);
create index on device_identity_edge (party_id, first_seen_at desc);
create index on device_identity_edge (device_id, first_seen_at desc);

-- Platform fraud graph: cross-party aggregates require global visibility for gate workers.
-- Isolation is via application grants + admin review; not tenant UI.
grant select, insert, update on device_fingerprint, device_identity_edge
  to rbit_app, rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app, rbit_app_user;
