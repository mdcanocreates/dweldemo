-- §4.1 Identity core model

create table org (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in
                         ('rbit','landlord','brokerage','property_mgmt','solar_partner')),
  legal_name           text not null,
  display_name         text not null,
  status               text not null default 'active',
  claim_status         text not null default 'claimed'
                         check (claim_status in ('unclaimed','pending','claimed')),
  created_by_source_id uuid,
  created_at           timestamptz not null default now()
);

create table party (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('person','organization')),
  created_at  timestamptz not null default now(),
  purge_after date,
  purged_at   timestamptz
);

create table data_encryption_key (
  id           uuid primary key default gen_random_uuid(),
  party_id     uuid not null references party(id),
  wrapped_key  bytea not null,
  kms_key_id   text not null,
  created_at   timestamptz not null default now(),
  destroyed_at timestamptz
);

create table party_identity (
  party_id             uuid primary key references party(id),
  dek_id               uuid not null references data_encryption_key(id),
  given_name_enc       bytea,
  family_name_enc      bytea,
  dob_enc              bytea,
  phone_enc            bytea,
  email_enc            bytea,
  email_hmac           bytea,
  phone_hmac           bytea,
  identity_fingerprint text,
  updated_at           timestamptz not null default now()
);
create index on party_identity (email_hmac);
create index on party_identity (phone_hmac);
create index on party_identity (identity_fingerprint) where identity_fingerprint is not null;

create table external_identity_ref (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid not null references party(id),
  vendor            text not null,
  vendor_subject_id text not null,
  first_seen_at     timestamptz not null default now(),
  unique (vendor, vendor_subject_id)
);

create table party_role (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references party(id),
  org_id     uuid references org(id),
  role       text not null check (role in
               ('renter','landlord','agent','broker','broker_admin',
                'solar_homeowner','solar_rep','rbit_admin','rbit_support',
                'rbit_super_admin')),
  status     text not null default 'active',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index party_role_unique_active on party_role
  (party_id, coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid), role)
  where revoked_at is null;

-- Retained half. No FK cascade from party (§3.4).
create table party_features (
  party_id                     uuid primary key,
  first_seen_at                timestamptz not null,
  home_submarket_id            uuid,
  home_h3_r8                   text,
  income_band                  int,
  income_source                text,
  employment_band              text,
  household_size               int,
  application_count            int not null default 0,
  interest_received_count      int not null default 0,
  approval_count               int not null default 0,
  decline_count                int not null default 0,
  placement_count              int not null default 0,
  fraud_flag_count             int not null default 0,
  paid_upfront_screening_count int not null default 0,
  latest_score                 numeric,
  updated_at                   timestamptz not null default now()
);

create table org_claim (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references org(id),
  claimant_party_id    uuid not null references party(id),
  method               text not null check (method in
                         ('email_domain','phone_verification','admin_manual','feed_credential')),
  evidence             jsonb not null,
  status               text not null check (status in ('pending','approved','rejected')),
  reviewed_by_party_id uuid references party(id),
  requested_at         timestamptz not null default now(),
  resolved_at          timestamptz
);
