-- Meeting demo: mark demo applications; broker terms acknowledgment (server-side).

alter table application
  add column if not exists is_demo boolean not null default false;

create index if not exists application_is_demo_idx
  on application (is_demo) where is_demo = true;

create table if not exists broker_terms_acceptance (
  id                      uuid primary key default gen_random_uuid(),
  party_id                uuid not null references party(id),
  terms_version           text not null,
  accepted_at             timestamptz not null default now(),
  ip_address              inet,
  user_agent              text,
  compensation_cap_ack    boolean not null,
  non_circumvention_ack   boolean not null,
  licensing_ack           boolean not null,
  platform_role_ack       boolean not null,
  unique (party_id, terms_version)
);

create index if not exists broker_terms_acceptance_party_idx
  on broker_terms_acceptance (party_id, accepted_at desc);

alter table broker_terms_acceptance enable row level security;
alter table broker_terms_acceptance force row level security;

drop policy if exists broker_terms_acceptance_self on broker_terms_acceptance;
create policy broker_terms_acceptance_self on broker_terms_acceptance
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = nullif(current_setting('rbit.current_party_id', true), '')
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = nullif(current_setting('rbit.current_party_id', true), '')
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    grant select, insert, update on broker_terms_acceptance to rbit_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    grant select, insert, update on broker_terms_acceptance to rbit_app_user;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    grant all on broker_terms_acceptance to rbit_migrator;
  end if;
end $$;
