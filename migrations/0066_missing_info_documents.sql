-- Sprint 2: durable missing-info document requests + review outcomes
-- Depends on: 0064 (missing_info_request), 0028 (document)

-- ---------------------------------------------------------------------------
-- 1. Extend missing_info_request for docs + review lifecycle
-- ---------------------------------------------------------------------------
alter table missing_info_request
  drop constraint if exists missing_info_request_status_check;

alter table missing_info_request
  add constraint missing_info_request_status_check
  check (status in (
    'open',
    'responded',
    'accepted',
    'returned',
    'cancelled'
  ));

alter table missing_info_request
  add column if not exists required_document_types text[] not null default '{}'::text[];

alter table missing_info_request
  add column if not exists review_note text;

alter table missing_info_request
  add column if not exists reviewed_at timestamptz;

alter table missing_info_request
  add column if not exists reviewed_by_party_id uuid references party(id);

alter table missing_info_request
  add column if not exists response_version int not null default 0;

alter table missing_info_request
  add column if not exists idempotency_key text;

alter table missing_info_request
  drop constraint if exists missing_info_request_review_note_len;

alter table missing_info_request
  add constraint missing_info_request_review_note_len
  check (review_note is null or char_length(review_note) <= 1000);

alter table missing_info_request
  drop constraint if exists missing_info_request_doc_types_chk;

alter table missing_info_request
  add constraint missing_info_request_doc_types_chk
  check (
    required_document_types <@ array[
      'proof_of_income',
      'employment_letter',
      'id_document',
      'pet_documentation',
      'household_roster',
      'other_supporting'
    ]::text[]
  );

create unique index if not exists missing_info_request_idempotency_uidx
  on missing_info_request (org_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Link documents to missing-info requests
-- ---------------------------------------------------------------------------
create table if not exists missing_info_request_document (
  id                        uuid primary key default gen_random_uuid(),
  missing_info_request_id   uuid not null references missing_info_request(id) on delete cascade,
  document_id               uuid not null references document(id),
  uploaded_by_party_id      uuid not null references party(id),
  created_at                timestamptz not null default now(),
  unique (missing_info_request_id, document_id)
);

create index if not exists missing_info_request_document_req_idx
  on missing_info_request_document (missing_info_request_id, created_at desc);

create index if not exists missing_info_request_document_doc_idx
  on missing_info_request_document (document_id);

alter table missing_info_request_document enable row level security;
alter table missing_info_request_document force row level security;

drop policy if exists missing_info_request_document_tenant on missing_info_request_document;
create policy missing_info_request_document_tenant on missing_info_request_document
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or exists (
      select 1
      from missing_info_request mir
      where mir.id = missing_info_request_document.missing_info_request_id
        and (
          mir.org_id::text = current_setting('rbit.current_org_id', true)
          or exists (
            select 1 from application a
            where a.id = mir.application_id
              and a.party_id::text = current_setting('rbit.current_party_id', true)
          )
        )
    )
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or exists (
      select 1
      from missing_info_request mir
      where mir.id = missing_info_request_document.missing_info_request_id
        and (
          mir.org_id::text = current_setting('rbit.current_org_id', true)
          or exists (
            select 1 from application a
            where a.id = mir.application_id
              and a.party_id::text = current_setting('rbit.current_party_id', true)
          )
        )
    )
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    grant select, insert, update on missing_info_request_document to rbit_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    grant select, insert, update on missing_info_request_document to rbit_app_user;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    grant select, insert, update, delete on missing_info_request_document to rbit_migrator;
  end if;
end $$;
