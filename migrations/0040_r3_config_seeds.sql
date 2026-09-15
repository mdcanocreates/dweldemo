-- R-3: Versioned pricing / TTL / SLA config + screening_package cost.
-- rs_price_book: seeded UNAPPROVED (dev/staging data only — §10.3).
-- hold_durations + sla: initial approved seed so runtime can resolve (changes still go through dual approval).
-- screening_package.total_cost_cents: catalog data, not a TS literal.

insert into party (id, kind)
values ('00000000-0000-4000-8000-000000000040'::uuid, 'organization')
on conflict (id) do nothing;

-- §10.3 RS price book — twelve tiers, unapproved.
insert into config_version (
  id, namespace, version, payload, effective_from, proposed_by_party_id,
  approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000401'::uuid,
  'rs_price_book',
  'seed-v1',
  '{
    "env": "dev_staging_only",
    "tiers": [
      {"tier":"RS-1","rent_min_cents":80000,"rent_max_cents":119900,"fee_cents":6500},
      {"tier":"RS-2","rent_min_cents":120000,"rent_max_cents":159900,"fee_cents":9000},
      {"tier":"RS-3","rent_min_cents":160000,"rent_max_cents":199900,"fee_cents":11500},
      {"tier":"RS-4","rent_min_cents":200000,"rent_max_cents":249900,"fee_cents":14000},
      {"tier":"RS-5","rent_min_cents":250000,"rent_max_cents":299900,"fee_cents":17000},
      {"tier":"RS-6","rent_min_cents":300000,"rent_max_cents":399900,"fee_cents":21000},
      {"tier":"RS-7","rent_min_cents":400000,"rent_max_cents":599900,"fee_cents":29000},
      {"tier":"RS-8","rent_min_cents":600000,"rent_max_cents":899900,"fee_cents":43000},
      {"tier":"RS-9","rent_min_cents":900000,"rent_max_cents":1499900,"fee_cents":66500},
      {"tier":"RS-10","rent_min_cents":1500000,"rent_max_cents":2499900,"fee_cents":107000},
      {"tier":"RS-11","rent_min_cents":2500000,"rent_max_cents":4499900,"fee_cents":182000},
      {"tier":"RS-12","rent_min_cents":4500000,"rent_max_cents":null,"fee_cents":240000}
    ]
  }'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000040'::uuid,
  null,
  null
) on conflict (namespace, version) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from, proposed_by_party_id,
  approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000402'::uuid,
  'hold_durations',
  'seed-v1',
  '{"hold_ttl_ms":172800000}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '2020-01-01T00:00:00Z'::timestamptz
) on conflict (namespace, version) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from, proposed_by_party_id,
  approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000403'::uuid,
  'sla',
  'seed-v1',
  '{
    "magic_token_ttl_ms":900000,
    "session_ttl_ms":2592000000,
    "elevation_ttl_ms":900000,
    "rebate_payout_details_ttl_days":90
  }'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '2020-01-01T00:00:00Z'::timestamptz
) on conflict (namespace, version) do nothing;

insert into screening_package (
  id, package_key, version, vendor, product_codes, total_cost_cents, is_active
) values (
  '00000000-0000-4000-8000-000000000404'::uuid,
  'standard',
  '1',
  'certn',
  array['oneid','criminal_tier_1','credit_equifax','risk_insight']::text[],
  2946,
  true
) on conflict (package_key, version) do nothing;
