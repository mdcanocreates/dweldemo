-- Email verification codes and hashed session credentials.
-- Pre-auth challenges have no session yet; same class as auth_magic_token.
-- Existing session rows keep working: secret_hash stays null until the next sign-in.

create table auth_email_challenge (
  id               uuid primary key default gen_random_uuid(),
  email_hmac       bytea not null,
  purpose          text not null,
  code_hash        bytea not null,
  party_id         uuid references party(id),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  superseded_at    timestamptz,
  attempt_count    integer not null default 0,
  max_attempts     integer not null default 5,
  remember_device  boolean not null default false,
  request_ip       inet,
  created_at       timestamptz not null default now()
);

create index auth_email_challenge_email_created
  on auth_email_challenge (email_hmac, created_at desc);

alter table session
  add column if not exists secret_hash bytea,
  add column if not exists idle_expires_at timestamptz,
  add column if not exists absolute_expires_at timestamptz,
  add column if not exists remember_device boolean not null default false,
  add column if not exists previous_secret_hash bytea,
  add column if not exists previous_secret_valid_until timestamptz,
  add column if not exists credential_rotated_at timestamptz;

create unique index if not exists session_secret_hash_uidx
  on session (secret_hash)
  where secret_hash is not null;

grant select, insert, update on auth_email_challenge to rbit_app;
grant select, insert, update on auth_email_challenge to rbit_app_user;
