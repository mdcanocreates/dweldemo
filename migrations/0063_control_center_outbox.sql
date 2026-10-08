-- Control Center transactional outbox + internal mutation idempotency.
-- Outbox payloads must never include FCRA screening report bodies.

create table if not exists cc_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null unique default gen_random_uuid(),
  schema_version  int not null default 1,
  event_type      text not null,
  product         text not null default 'dwel',
  source_case_id  text,
  source_party_id text,
  occurred_at     timestamptz not null default now(),
  source_version  text,
  payload         jsonb not null default '{}'::jsonb,
  published_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists cc_outbox_unpublished_idx
  on cc_outbox (created_at)
  where published_at is null;

create index if not exists cc_outbox_case_idx
  on cc_outbox (source_case_id, created_at desc)
  where source_case_id is not null;

create table if not exists internal_action_idempotency (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null,
  route_key        text not null,
  request_hash     text,
  response_status  int not null,
  response_body    jsonb not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '7 days'),
  unique (idempotency_key, route_key)
);

create index if not exists internal_action_idempotency_expires_idx
  on internal_action_idempotency (expires_at);

alter table cc_outbox enable row level security;
alter table cc_outbox force row level security;
alter table internal_action_idempotency enable row level security;
alter table internal_action_idempotency force row level security;

drop policy if exists cc_outbox_bypass on cc_outbox;
create policy cc_outbox_bypass on cc_outbox
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

drop policy if exists internal_action_idempotency_bypass on internal_action_idempotency;
create policy internal_action_idempotency_bypass on internal_action_idempotency
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    grant select, insert, update on cc_outbox to rbit_app;
    grant select, insert, update on internal_action_idempotency to rbit_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    grant select, insert, update on cc_outbox to rbit_app_user;
    grant select, insert, update on internal_action_idempotency to rbit_app_user;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    grant all on cc_outbox to rbit_migrator;
    grant all on internal_action_idempotency to rbit_migrator;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_admin_reader') then
    grant select on cc_outbox to rbit_admin_reader;
    grant select on internal_action_idempotency to rbit_admin_reader;
  end if;
end $$;
