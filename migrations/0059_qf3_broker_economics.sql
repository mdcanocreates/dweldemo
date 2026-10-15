-- QF-3: seed broker_economics so /broker/dashboard can resolve blended_broker_margin.
-- Value is cents (interim_v1 documented default used by Part I / B-4 tests: $400).

insert into party (id, kind)
values ('00000000-0000-4000-8000-000000000040'::uuid, 'organization')
on conflict (id) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from,
  proposed_by_party_id, approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000590'::uuid,
  'broker_economics',
  'seed-v1',
  '{"blended_broker_margin":40000,"notes":"interim_v1 QF-3 seed — $400 EV margin denominator"}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '00000000-0000-4000-8000-000000000040'::uuid,
  '2020-01-01T00:00:00Z'::timestamptz
) on conflict (namespace, version) do nothing;
