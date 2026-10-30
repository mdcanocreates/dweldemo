-- Authority Lite completion. Additive except for dropping verification columns
-- that were never applied to Aurora. The application role cannot read them.

alter table authority_housing_case
  drop column if exists program_type,
  drop column if exists verification_source,
  drop column if exists verified_at,
  drop column if exists assistance_indicator;

create table authority_private_verification (
  agency_id uuid not null,
  case_id uuid not null,
  assistance_indicator text not null default 'unknown' check (assistance_indicator in (
    'unknown', 'self_reported', 'agency_verified', 'expired', 'revoked'
  )),
  program_type text,
  verification_source text,
  verified_at timestamptz,
  recorded_by uuid,
  primary key (agency_id, case_id),
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);

revoke all on authority_private_verification from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    execute 'revoke all on authority_private_verification from rbit_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    execute 'revoke all on authority_private_verification from rbit_app_user';
  end if;
end $$;

create table authority_scanner_credential (
  id int primary key,
  token_hash text not null
);
revoke all on authority_scanner_credential from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    execute 'revoke all on authority_scanner_credential from rbit_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    execute 'revoke all on authority_scanner_credential from rbit_app_user';
  end if;
end $$;

create or replace function authority_init_assistance(agency uuid, housing_case uuid, indicator text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if indicator not in ('unknown', 'self_reported') then
    raise exception 'verification cannot be set from case creation' using errcode = '42501';
  end if;
  if not authority_has_role(agency, array['agency_owner', 'agency_supervisor', 'caseworker']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into authority_private_verification (agency_id, case_id, assistance_indicator, recorded_by)
  values (agency, housing_case, indicator, authority_party())
  on conflict (agency_id, case_id) do nothing;
end;
$$;

create or replace function authority_write_verification(
  agency uuid,
  housing_case uuid,
  indicator text,
  program text,
  source text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if indicator not in ('agency_verified', 'expired', 'revoked') then
    raise exception 'unsupported verification indicator' using errcode = '42501';
  end if;
  if not authority_has_role(agency, array['agency_owner', 'agency_supervisor']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into authority_private_verification (
    agency_id, case_id, assistance_indicator, program_type, verification_source, verified_at, recorded_by
  ) values (
    agency, housing_case, indicator, program, source, now(), authority_party()
  )
  on conflict (agency_id, case_id) do update
    set assistance_indicator = excluded.assistance_indicator,
        program_type = excluded.program_type,
        verification_source = excluded.verification_source,
        verified_at = now(),
        recorded_by = excluded.recorded_by;
end;
$$;

create or replace function authority_read_verification(agency uuid, housing_case uuid)
returns table (assistance_indicator text, program_type text, verification_source text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    authority_has_role(agency, array['agency_owner', 'agency_supervisor'])
    or exists (
      select 1
      from authority_membership m
      join authority_housing_case c
        on c.id = housing_case
       and c.agency_id = agency
       and c.assigned_membership_id = m.id
      where m.agency_id = agency
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role = 'caseworker'
    )
  ) then
    return;
  end if;
  return query
    select v.assistance_indicator, v.program_type, v.verification_source
    from authority_private_verification v
    where v.agency_id = agency and v.case_id = housing_case;
end;
$$;

alter table authority_document
  add column scan_evidence_id text,
  add column scan_completed_at timestamptz;

alter table authority_document drop constraint if exists authority_document_scan_status_check;
alter table authority_document add constraint authority_document_scan_status_check
  check (scan_status in (
    'upload_pending', 'quarantine', 'scanning', 'clean', 'rejected', 'expired', 'deleted'
  ));

create or replace function authority_document_freeze_scan()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.scan_status := 'quarantine';
    new.scan_evidence_id := null;
    new.scan_completed_at := null;
    return new;
  end if;
  if current_user in ('rbit_app_user', 'rbit_app')
     and (
       new.scan_status is distinct from old.scan_status
       or new.scan_evidence_id is distinct from old.scan_evidence_id
       or new.scan_completed_at is distinct from old.scan_completed_at
     ) then
    raise exception 'scan status cannot be changed by the application role' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists authority_document_freeze_scan on authority_document;
create trigger authority_document_freeze_scan
  before insert or update on authority_document
  for each row execute function authority_document_freeze_scan();

create table authority_object_bytes (
  document_id uuid primary key references authority_document(id),
  sha256 text not null,
  byte_size int not null,
  body bytea not null
);
alter table authority_object_bytes enable row level security;
alter table authority_object_bytes force row level security;
create policy authority_object_bytes_access on authority_object_bytes
  for all using (
    authority_bypass()
    or exists (select 1 from authority_document d where d.id = authority_object_bytes.document_id)
  )
  with check (
    authority_bypass()
    or exists (select 1 from authority_document d where d.id = authority_object_bytes.document_id)
  );

create or replace function authority_apply_scan(
  doc uuid,
  verdict text,
  evidence text,
  expected_sha text,
  token text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
  current_status text;
begin
  if verdict not in ('clean', 'malicious', 'error') then
    raise exception 'unsupported scan verdict' using errcode = '22023';
  end if;
  select token_hash into stored from authority_scanner_credential where id = 1;
  if stored is null or stored is distinct from encode(digest(convert_to(token, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'scanner is not authorized' using errcode = '42501';
  end if;
  select scan_status into current_status
  from authority_document
  where id = doc and content_sha256 = expected_sha;
  if current_status is null then
    raise exception 'document hash does not match' using errcode = '42501';
  end if;
  if current_status = 'clean' and verdict = 'clean' then
    return 'clean';
  end if;
  if current_status <> 'quarantine' then
    raise exception 'document is not awaiting a scan' using errcode = '42501';
  end if;
  if verdict = 'clean' then
    update authority_document
       set scan_status = 'clean',
           scan_evidence_id = evidence,
           scan_completed_at = now()
     where id = doc and content_sha256 = expected_sha;
    return 'clean';
  end if;
  update authority_document
     set scan_status = 'rejected',
         scan_evidence_id = evidence,
         scan_completed_at = now()
   where id = doc and content_sha256 = expected_sha;
  return 'rejected';
end;
$$;

alter table authority_task drop constraint if exists authority_task_status_check;
alter table authority_task add constraint authority_task_status_check
  check (status in ('open', 'in_progress', 'completed', 'cancelled'));
alter table authority_task add column version int not null default 1;
alter table authority_task add column updated_at timestamptz not null default now();
alter table authority_task add column title text;
create index authority_task_due_idx
  on authority_task (agency_id, due_at)
  where status in ('open', 'in_progress');

alter table authority_appointment add column version int not null default 1;

create table authority_appointment_change (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  appointment_id uuid not null,
  prior_start_at timestamptz not null,
  new_start_at timestamptz not null,
  reason text not null,
  actor_party_id uuid not null references party(id),
  occurred_at timestamptz not null default now()
);
alter table authority_appointment_change enable row level security;
alter table authority_appointment_change force row level security;
create policy authority_appointment_change_access on authority_appointment_change
  for all using (
    authority_bypass()
    or exists (
      select 1 from authority_appointment a
      where a.id = authority_appointment_change.appointment_id
        and a.agency_id = authority_appointment_change.agency_id
    )
  )
  with check (
    authority_bypass()
    or exists (
      select 1 from authority_appointment a
      where a.id = authority_appointment_change.appointment_id
        and a.agency_id = authority_appointment_change.agency_id
    )
  );

alter table authority_tenant add column timezone text not null default 'America/Chicago';

create table authority_mfa_factor (
  party_id uuid primary key references party(id),
  secret_base32 text not null,
  confirmed_at timestamptz
);
alter table authority_mfa_factor enable row level security;
alter table authority_mfa_factor force row level security;
create policy authority_mfa_self on authority_mfa_factor
  for all using (authority_bypass() or party_id = authority_party())
  with check (authority_bypass() or party_id = authority_party());

alter table session add column authority_mfa_until timestamptz;

do $$
declare
  rel text;
begin
  foreach rel in array array[
    'authority_object_bytes', 'authority_appointment_change', 'authority_mfa_factor'
  ]
  loop
    if exists (select 1 from pg_roles where rolname = 'rbit_app') then
      execute format('grant select, insert, update on %I to rbit_app', rel);
    end if;
    if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
      execute format('grant select, insert, update on %I to rbit_app_user', rel);
    end if;
  end loop;
end $$;

revoke all on function authority_init_assistance(uuid, uuid, text) from public;
revoke all on function authority_write_verification(uuid, uuid, text, text, text) from public;
revoke all on function authority_read_verification(uuid, uuid) from public;
revoke all on function authority_apply_scan(uuid, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    execute 'grant execute on function authority_init_assistance(uuid, uuid, text) to rbit_app_user';
    execute 'grant execute on function authority_write_verification(uuid, uuid, text, text, text) to rbit_app_user';
    execute 'grant execute on function authority_read_verification(uuid, uuid) to rbit_app_user';
    execute 'grant execute on function authority_apply_scan(uuid, text, text, text, text) to rbit_app_user';
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    execute 'grant execute on function authority_init_assistance(uuid, uuid, text) to rbit_app';
    execute 'grant execute on function authority_write_verification(uuid, uuid, text, text, text) to rbit_app';
    execute 'grant execute on function authority_read_verification(uuid, uuid) to rbit_app';
    execute 'grant execute on function authority_apply_scan(uuid, text, text, text, text) to rbit_app';
  end if;
end $$;
