-- Demo classification, inventory channel, verified offers, and fee inputs for savings.
-- Public search excludes is_demo by default. Historical application rows are preserved.

alter table listing
  add column if not exists is_demo boolean not null default false,
  add column if not exists inventory_kind text not null default 'partner'
    check (inventory_kind in ('partner', 'external', 'demo')),
  add column if not exists application_fee_cents int
    check (application_fee_cents is null or application_fee_cents >= 0),
  add column if not exists reusable_application_eligible boolean not null default false,
  add column if not exists external_candidate_id uuid;

create index if not exists listing_is_demo_idx on listing (is_demo) where is_demo = true;
create index if not exists listing_inventory_kind_idx on listing (inventory_kind, status);

-- Tag known preview/demo inventory without deleting rows.
update listing l
set is_demo = true,
    inventory_kind = 'demo'
from unit u
join property p on p.id = u.property_id
join address a on a.id = p.address_id
where l.unit_id = u.id
  and (
    a.normalizer_vendor = 'preview_prod_seed'
    or upper(coalesce(a.line1, '')) like '%IMAGINARY%'
    or upper(coalesce(a.line1, '')) like '%PHANTOM%'
    or upper(coalesce(a.raw_input, '')) like '%IMAGINARY%'
    or upper(coalesce(a.raw_input, '')) like '%PHANTOM%'
  );

create table if not exists listing_offer (
  id                    uuid primary key default gen_random_uuid(),
  listing_id            uuid not null references listing(id) on delete cascade,
  org_id                uuid not null references org(id),
  display_text          text not null,
  offer_type            text not null check (offer_type in (
                          'weeks_free', 'months_free', 'dollar_credit', 'fee_waiver',
                          'cashback', 'other'
                        )),
  qualifier_text        text,
  numeric_value         numeric,
  unit_label            text,
  starts_on             date,
  ends_on               date,
  source_reference      text,
  attribution_text      text,
  validated_at          timestamptz,
  offer_status          text not null default 'unverified'
                          check (offer_status in ('unverified', 'verified', 'stale', 'rejected')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists listing_offer_listing_idx
  on listing_offer (listing_id)
  where offer_status = 'verified';

alter table external_property_candidate
  add column if not exists listing_id uuid references listing(id);

alter table listing_offer enable row level security;
alter table listing_offer force row level security;

drop policy if exists listing_offer_tenant on listing_offer;
create policy listing_offer_tenant on listing_offer
  for all
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

drop policy if exists listing_offer_public_read on listing_offer;
create policy listing_offer_public_read on listing_offer
  for select
  using (
    exists (
      select 1 from listing l
      where l.id = listing_offer.listing_id
        and l.status = 'active'
        and coalesce(l.is_demo, false) = false
        and listing_offer.offer_status = 'verified'
    )
  );

grant select, insert, update, delete on listing_offer to rbit_app, rbit_app_user;
