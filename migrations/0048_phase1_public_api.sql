-- Phase 1 public API: application access tokens + screening consent

create table application_access_token (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references application(id),
  token_hash      bytea not null,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  request_ip      inet,
  created_at      timestamptz not null default now()
);
create unique index on application_access_token (token_hash) where revoked_at is null;
create index on application_access_token (application_id);

create table screening_consent (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references application(id),
  disclosure_version text not null,
  consented_at       timestamptz not null,
  consent_ip         inet,
  created_at         timestamptz not null default now(),
  unique (application_id)
);

create or replace function enforce_screening_consent_before_authorization()
returns trigger
language plpgsql
as $$
begin
  if new.screening_authorized_at is not null
     and (old.screening_authorized_at is null
          or old.screening_authorized_at is distinct from new.screening_authorized_at)
     and not exists (
       select 1 from screening_consent sc where sc.application_id = new.id
     )
  then
    raise exception 'screening_authorized_at requires screening_consent record'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tr_application_screening_consent
  before update on application
  for each row
  execute function enforce_screening_consent_before_authorization();
