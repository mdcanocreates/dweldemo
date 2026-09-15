-- R-2: Register §18-dependent config namespaces as provisional config_version rows.
-- Values match current provisional behavior; payload.provisional = true.
-- approved_by_party_id is NULL — production boot must refuse (see boot-assert.ts).
-- A system party is inserted only to satisfy proposed_by_party_id NOT NULL.

insert into party (id, kind)
values ('00000000-0000-4000-8000-000000000018'::uuid, 'organization')
on conflict (id) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from, proposed_by_party_id,
  approved_by_party_id, approved_at
) values
(
  '00000000-0000-4000-8000-000000000101'::uuid,
  'retention',
  'provisional-d01',
  '{"provisional":true,"decision":"D-01","identity_ttl_days":null,"note":"TTL unset until Jacob decides"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000102'::uuid,
  'screening_policy',
  'provisional-d02-d15',
  '{"provisional":true,"decisions":["D-02","D-15"],"report_portability_days":30,"risk_insight_auto_adverse_action_enabled":false}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000103'::uuid,
  'broker_license_coverage',
  'provisional-d03',
  '{"provisional":true,"decision":"D-03","states":[],"note":"launch markets unset"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000105'::uuid,
  'ledger_policy',
  'provisional-d05',
  '{"provisional":true,"decision":"D-05","lead_fee_recognition":"immediate"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000111'::uuid,
  'ingestion_display_policy',
  'provisional-d11',
  '{"provisional":true,"decision":"D-11","note":"per-partner rule content gated; enforcement only"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000112'::uuid,
  'reso_aggregator',
  'provisional-d12',
  '{"provisional":true,"decision":"D-12","adapter_kind":"reso_aggregator_stub"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000113'::uuid,
  'renter_discoverability_filters',
  'provisional-d13',
  '{"provisional":true,"decision":"D-13","allowed_filters":["target_submarket_ids","rent_max_cents","bedrooms_min","move_in_earliest","move_in_latest","household_size","has_pets","badge_state","score_band"]}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
),
(
  '00000000-0000-4000-8000-000000000114'::uuid,
  'vendor_adapters',
  'provisional-d14-d16',
  '{"provisional":true,"decisions":["D-14","D-16"],"vault_tokenizer":"vault_stub","income_verification":"stub_income","tenant_screening":"certn_stub"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000018'::uuid,
  null,
  null
)
on conflict (namespace, version) do nothing;
