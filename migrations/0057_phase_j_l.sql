-- Part J flags + Part L intake + rules_based_v1 match score

create table if not exists platform_flag (
  name                 text primary key,
  enabled              boolean not null default false,
  compliance_tag       text,
  description          text,
  updated_at           timestamptz not null default now(),
  updated_by_party_id  uuid references party(id)
);

create table if not exists platform_flag_change (
  id                   uuid primary key default gen_random_uuid(),
  flag_name            text not null references platform_flag(name),
  previous_enabled     boolean not null,
  new_enabled          boolean not null,
  actor_party_id       uuid not null references party(id),
  created_at           timestamptz not null default now()
);
create index if not exists platform_flag_change_flag_created
  on platform_flag_change (flag_name, created_at desc);

insert into platform_flag (name, enabled, compliance_tag, description) values
  ('certn_screening_enabled', true, null, 'Global Certn screening gate'),
  ('stripe_connect_enabled', true, null, 'Global Stripe Connect onboarding gate'),
  ('self_execution_review_enabled', true, null, 'Admin self-execution review queue'),
  ('ny_path2_enabled', true, 'interim_v1', 'NY Path 2 screening purchase')
on conflict (name) do nothing;

grant select, insert, update on platform_flag to rbit_app;
grant select, insert on platform_flag_change to rbit_app;
grant select, insert, update, delete on platform_flag to rbit_migrator;
grant select, insert, update, delete on platform_flag_change to rbit_migrator;

-- One intake dossier per renter (reused across listings)
create table if not exists renter_application_intake (
  party_id                      uuid primary key references party(id),
  current_address_line1         text,
  current_address_city          text,
  current_address_state         text,
  current_address_postal          text,
  current_address_move_in       date,
  employer_name                 text,
  job_title                     text,
  employer_phone                text,
  employment_length_months      int,
  monthly_gross_income_cents    int,
  occupants                     jsonb not null default '[]'::jsonb,
  pets                          jsonb not null default '[]'::jsonb,
  emergency_contact             jsonb,
  vehicle                       jsonb,
  completed_at                  timestamptz,
  updated_at                    timestamptz not null default now()
);

alter table renter_application_intake enable row level security;
drop policy if exists renter_application_intake_owner on renter_application_intake;
create policy renter_application_intake_owner on renter_application_intake
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

grant select, insert, update on renter_application_intake to rbit_app;
grant select, insert, update, delete on renter_application_intake to rbit_migrator;

alter table application
  add column if not exists match_score_value int
    check (match_score_value is null or (match_score_value >= 0 and match_score_value <= 100)),
  add column if not exists match_score_version text,
  add column if not exists match_score_computed_at timestamptz,
  add column if not exists match_score_components jsonb;

create table if not exists application_match_score_history (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references application(id),
  score_value     int not null,
  score_version   text not null,
  components      jsonb not null,
  computed_at     timestamptz not null default now()
);
create index if not exists application_match_score_history_app
  on application_match_score_history (application_id, computed_at desc);

grant select, insert on application_match_score_history to rbit_app;
grant select, insert, update, delete on application_match_score_history to rbit_migrator;
