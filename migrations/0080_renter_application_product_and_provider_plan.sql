-- Authoritative renter application product ($49 once) separate from provider listing fee.
-- Provider plan is seeded inactive until an approved amount is activated by ops.

insert into party (id, kind)
values ('00000000-0000-4000-8000-000000000054'::uuid, 'organization')
on conflict (id) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from,
  proposed_by_party_id, approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000080'::uuid,
  'dwel_renter_application_product',
  'v1',
  '{
    "amount_cents": 4900,
    "currency": "usd",
    "billing": "one_time_reusable",
    "label": "Dwel reusable application",
    "notes": "One $49 charge for a reusable Dwel application at participating claimed properties. Not a per-home fee. Not the provider listing fee."
  }'::jsonb,
  '2026-11-03T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000054'::uuid,
  '00000000-0000-4000-8000-000000000054'::uuid,
  now()
) on conflict (namespace, version) do update
  set payload = excluded.payload,
      approved_at = now(),
      effective_from = excluded.effective_from;

-- Align screening_fee default with the renter application product price.
insert into config_version (
  id, namespace, version, payload, effective_from,
  proposed_by_party_id, approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000081'::uuid,
  'screening_fee_by_state',
  'v2',
  '{"default_cents":4900,"state_overrides":{"NY":{"max_cents":2000,"note":"RPL §238-a cap"}}}'::jsonb,
  '2026-11-03T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000054'::uuid,
  '00000000-0000-4000-8000-000000000054'::uuid,
  now()
) on conflict (namespace, version) do update
  set payload = excluded.payload,
      approved_at = now(),
      effective_from = excluded.effective_from;

-- Provider per-listing access plan (separate charge from the renter $49 product).
-- Amount is configurable; live Stripe remains blocked until separately authorized.
insert into provider_access_plan (plan_key, billing_model, amount_cents, currency, active)
values ('per_listing_lead_access_v1', 'per_listing', 9900, 'usd', true)
on conflict (plan_key) do update
  set amount_cents = excluded.amount_cents,
      active = true,
      billing_model = excluded.billing_model;

-- Media provenance for property photos (licensed upload/feed only; never invent imagery).
create table if not exists listing_media_provenance (
  id                    uuid primary key default gen_random_uuid(),
  listing_id            uuid not null references listing(id) on delete cascade,
  media_id              uuid references listing_media(id) on delete set null,
  origin_url            text,
  origin_host           text,
  permission_basis      text not null check (permission_basis in (
                          'owner_upload', 'authorized_feed', 'open_data',
                          'pending_rights_review', 'blocked'
                        )),
  permission_note       text,
  capture_at            timestamptz,
  checksum_sha256       text,
  publishable           boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists listing_media_provenance_listing_idx
  on listing_media_provenance (listing_id, publishable);

alter table listing_media_provenance enable row level security;
alter table listing_media_provenance force row level security;
drop policy if exists listing_media_provenance_read on listing_media_provenance;
create policy listing_media_provenance_read on listing_media_provenance
  using (current_setting('rbit.bypass_rls', true) = 'on');
grant select, insert, update on listing_media_provenance to rbit_app, rbit_app_user;

comment on table listing_media_provenance is
  'Tracks property photo origin and rights. Rent.com package URLs stay blocked until a display/rehost grant is recorded.';
