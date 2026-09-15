-- §6 Supply

create table property (
  id            uuid primary key default gen_random_uuid(),
  address_id    uuid not null unique references address(id),
  property_type text not null,
  year_built    int,
  created_at    timestamptz not null default now()
);

create table unit (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references property(id),
  unit_label_raw        text,
  unit_label_normalized text not null default '',
  bedrooms              numeric(3,1),
  bathrooms             numeric(3,1),
  sqft                  int,
  created_at            timestamptz not null default now(),
  unique (property_id, unit_label_normalized)
);

create table listing (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references org(id),
  unit_id                 uuid not null references unit(id),
  origin                  text not null check (origin in ('manual','ingested','hybrid')),
  primary_source_listing_id uuid,
  rent_amount_cents       int not null,
  deposit_cents           int,
  available_on            date,
  lease_term_months       int,
  status                  text not null check (status in
                            ('draft','active','paused','stale','expired','rented',
                             'removed','archived')),
  published_at            timestamptz,
  last_confirmed_at       timestamptz not null default now(),
  stale_at                timestamptz,
  expires_at              timestamptz,
  rented_at               timestamptz,
  created_at              timestamptz not null default now()
);
create index on listing (status, org_id);
create index on listing (unit_id) where status = 'active';
