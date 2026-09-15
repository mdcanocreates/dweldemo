-- SPEC GAP (§4.2): passwordless auth describes behavior but no DDL.
-- auth_magic_token + session implement the described mechanics.
-- See evidence/phase1/spec-gaps.txt.

create table auth_magic_token (
  id             uuid primary key default gen_random_uuid(),
  email_hmac     bytea not null,
  purpose        text not null,
  token_hash     bytea not null,
  party_id       uuid references party(id),
  expires_at     timestamptz not null,
  redeemed_at    timestamptz,
  invalidated_at timestamptz,
  request_ip     inet,
  created_at     timestamptz not null default now()
);
create index on auth_magic_token (email_hmac, purpose, created_at desc);
create unique index on auth_magic_token (token_hash) where redeemed_at is null and invalidated_at is null;

create table session (
  id                 uuid primary key default gen_random_uuid(),
  party_id           uuid not null references party(id),
  device_fingerprint text,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  elevated_until     timestamptz
);
create index on session (party_id) where revoked_at is null;
