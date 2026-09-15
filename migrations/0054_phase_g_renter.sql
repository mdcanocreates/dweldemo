-- Part G: renter profile fields, NY screening submissions, config seeds, grants

alter table renter_profile
  add column if not exists annual_income_cents int,
  add column if not exists move_in_urgency text
    check (move_in_urgency is null or move_in_urgency in
      ('immediate','within_30_days','within_60_days','within_90_days','flexible')),
  add column if not exists preferred_state text,
  add column if not exists given_name text,
  add column if not exists family_name text,
  add column if not exists phone_e164 text,
  add column if not exists email text;

-- Distinct from vendor screening_report (0018). Stores NY Path 1/2 applicant artifacts.
create table if not exists applicant_screening_submission (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null references party(id),
  report_source       text not null check (report_source in
                        ('applicant_supplied','applicant_purchased','landlord_ordered')),
  completed_at        timestamptz not null,
  state_jurisdiction  text not null,
  storage_key         text,
  original_filename   text,
  content_type        text,
  compliance_tag      text,
  created_at          timestamptz not null default now()
);
create index if not exists applicant_screening_submission_party_completed
  on applicant_screening_submission (party_id, completed_at desc);

alter table applicant_screening_submission enable row level security;

drop policy if exists applicant_screening_submission_owner on applicant_screening_submission;
create policy applicant_screening_submission_owner on applicant_screening_submission
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

grant select, insert, update on applicant_screening_submission to rbit_app;
grant select, insert, update on applicant_screening_submission to rbit_app_user;

insert into party (id, kind)
values ('00000000-0000-4000-8000-000000000054'::uuid, 'organization')
on conflict (id) do nothing;

insert into config_version (
  id, namespace, version, payload, effective_from,
  proposed_by_party_id, approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000541'::uuid,
  'screening_fee_by_state',
  'v1',
  '{"default_cents":2900,"state_overrides":{"NY":{"max_cents":2000,"note":"RPL §238-a cap"}}}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000054'::uuid,
  '00000000-0000-4000-8000-000000000054'::uuid,
  now()
) on conflict (namespace, version) do update
  set payload = excluded.payload,
      approved_at = now();

insert into config_version (
  id, namespace, version, payload, effective_from,
  proposed_by_party_id, approved_by_party_id, approved_at
) values (
  '00000000-0000-4000-8000-000000000542'::uuid,
  'consent_copy',
  'v1',
  '{"fcra_one_time_use":"[PLACEHOLDER] This is non-legal sandbox FCRA one-time-use consent copy. Counsel must replace before any production use. By checking the box you acknowledge a consumer report may be obtained for rental screening."}'::jsonb,
  '2020-01-01T00:00:00Z'::timestamptz,
  '00000000-0000-4000-8000-000000000054'::uuid,
  '00000000-0000-4000-8000-000000000054'::uuid,
  now()
) on conflict (namespace, version) do update
  set payload = excluded.payload,
      approved_at = now();
