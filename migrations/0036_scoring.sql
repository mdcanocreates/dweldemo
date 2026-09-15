-- Phase 7 — Scoring feature store (§8.3) + renter_score rules v0 registration (§8.5 / §17)
-- score + model_registry already exist (Phase 1 / Phase 6). Do not reinvent columns.

-- §8.3 feature_snapshot (point-in-time feature store rows)
create table feature_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null references party(id),
  application_id      uuid references application(id),
  computed_at         timestamptz not null,
  feature_set_version text not null,
  features            jsonb not null,
  point_in_time_key   timestamptz not null
);
create index on feature_snapshot (party_id, point_in_time_key desc);
create index on feature_snapshot (application_id, computed_at desc)
  where application_id is not null;

-- §8.5 v0 rules engine — active. ML candidates must remain inactive until gate met.
insert into model_registry (model_key, version, kind, feature_spec, activated_at)
values (
  'renter_score',
  'rules-v0',
  'rules',
  '{
    "feature_set_version": "renter_features-v1",
    "features": [
      "application_count",
      "interest_received_count",
      "approval_count",
      "decline_count",
      "placement_count",
      "fraud_flag_count",
      "paid_upfront_screening_count",
      "income_band",
      "household_size",
      "approval_rate"
    ],
    "cohort_floor": 50
  }'::jsonb,
  now()
)
on conflict (model_key, version) do nothing;

-- Inactive ML candidate placeholder (artifact_ref null until a real train); never activated here.
insert into model_registry (model_key, version, kind, artifact_ref, feature_spec, trained_at, training_row_count)
values (
  'renter_score',
  'ml-v1-candidate',
  'ml',
  null,
  '{
    "feature_set_version": "renter_features-v1",
    "features": [
      "application_count",
      "interest_received_count",
      "approval_count",
      "decline_count",
      "placement_count",
      "fraud_flag_count",
      "paid_upfront_screening_count",
      "income_band",
      "household_size",
      "approval_rate"
    ],
    "note": "Inactive until Phase 7 gate met; shadow-only"
  }'::jsonb,
  null,
  null
)
on conflict (model_key, version) do nothing;
