-- §8.4 Outcome capture

create table placement_outcome (
  id                uuid primary key default gen_random_uuid(),
  placement_id      uuid not null references placement(id),
  horizon_days      int not null check (horizon_days in (30, 90, 180, 365)),
  requested_at      timestamptz not null,
  reported_at       timestamptz,
  reporter_party_id uuid references party(id),
  source            text check (source in
                      ('landlord_attest','broker_attest','tenant_attest',
                       'inferred','no_response')),
  payment_status    text check (payment_status in
                      ('current','late_1_30','late_31_60','late_60_plus','default','n_a')),
  tenancy_status    text check (tenancy_status in
                      ('occupied','vacated_normal','vacated_early','evicted','n_a')),
  incident_flags    text[] not null default '{}',
  confidence        numeric,
  unique (placement_id, horizon_days)
);
