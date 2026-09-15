-- B-2 Match score on landlord discovery

alter table landlord_interest
  add column if not exists match_score numeric;
alter table landlord_interest
  add column if not exists match_score_components jsonb;
alter table landlord_interest
  add column if not exists match_model_key text;
alter table landlord_interest
  add column if not exists match_model_version text;

insert into model_registry (model_key, version, kind, feature_spec, activated_at)
values (
  'listing_renter_match',
  'v0.1',
  'rules',
  '{
    "dimensions": ["rent_affordability","move_in_window","bedroom_match","badge_tier","submarket_match"],
    "config_namespace": "scoring_weights"
  }'::jsonb,
  now()
)
on conflict (model_key, version) do nothing;
