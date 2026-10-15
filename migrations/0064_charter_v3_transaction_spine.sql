-- Charter v3 P0 transaction spine: criteria, decisions, missing info,
-- saved listings, support cases, lease docs, cashback eligibility status,
-- broker provider invitations.

-- ---------------------------------------------------------------------------
-- 1. listing_criteria (versioned per listing)
-- ---------------------------------------------------------------------------
create table if not exists listing_criteria (
  id                  uuid primary key default gen_random_uuid(),
  listing_id          uuid not null references listing(id),
  org_id              uuid not null references org(id),
  version             int not null,
  jurisdiction        char(2),
  rules               jsonb not null default '{}'::jsonb,
  effective_at        timestamptz not null default now(),
  created_by_party_id uuid references party(id),
  superseded_at       timestamptz,
  unique (listing_id, version)
);

create unique index if not exists listing_criteria_one_live
  on listing_criteria (listing_id)
  where superseded_at is null;

create index if not exists listing_criteria_org_idx
  on listing_criteria (org_id, listing_id);

comment on column listing_criteria.rules is
  'Shape: { min_income_to_rent_ratio?: number, move_in_window_days?: number, pets_allowed?: boolean, max_occupants?: number, lease_term_months?: number|number[], require_complete_profile?: boolean }';

alter table listing_criteria enable row level security;
alter table listing_criteria force row level security;

drop policy if exists listing_criteria_tenant on listing_criteria;
create policy listing_criteria_tenant on listing_criteria
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  );

-- ---------------------------------------------------------------------------
-- 2. application columns
-- ---------------------------------------------------------------------------
alter table application
  add column if not exists criteria_version_id uuid references listing_criteria(id),
  add column if not exists prequal_evaluation jsonb,
  add column if not exists info_requested_at timestamptz,
  add column if not exists move_forward_at timestamptz,
  add column if not exists passed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Expand landlord_decision.decision check
-- ---------------------------------------------------------------------------
alter table landlord_decision drop constraint if exists landlord_decision_decision_check;
alter table landlord_decision
  add constraint landlord_decision_decision_check
  check (decision in (
    'interested',
    'approved',
    'declined',
    'withdrawn',
    'passed',
    'move_forward',
    'info_requested'
  ));

-- ---------------------------------------------------------------------------
-- 4. missing_info_request
-- ---------------------------------------------------------------------------
create table if not exists missing_info_request (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null references application(id),
  listing_id             uuid not null references listing(id),
  org_id                 uuid not null references org(id),
  categories             text[] not null,
  message                text,
  requested_by_party_id  uuid not null references party(id),
  status                 text not null default 'open'
                           check (status in ('open', 'responded', 'cancelled')),
  renter_response        text,
  created_at             timestamptz not null default now(),
  responded_at           timestamptz,
  constraint missing_info_request_categories_chk check (
    categories <@ array[
      'move_in',
      'income',
      'occupants',
      'pets',
      'lease_term',
      'incomplete_profile'
    ]::text[]
    and cardinality(categories) >= 1
  ),
  constraint missing_info_request_message_len check (
    message is null or char_length(message) <= 500
  )
);

create index if not exists missing_info_request_app_idx
  on missing_info_request (application_id, created_at desc);
create index if not exists missing_info_request_org_idx
  on missing_info_request (org_id, created_at desc);

alter table missing_info_request enable row level security;
alter table missing_info_request force row level security;

-- Org tenant (landlord) + applicant party can read/respond on their application.
drop policy if exists missing_info_request_tenant on missing_info_request;
create policy missing_info_request_tenant on missing_info_request
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or exists (
      select 1 from application a
      where a.id = missing_info_request.application_id
        and a.party_id::text = current_setting('rbit.current_party_id', true)
    )
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or exists (
      select 1 from application a
      where a.id = missing_info_request.application_id
        and a.party_id::text = current_setting('rbit.current_party_id', true)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. saved_listing
-- ---------------------------------------------------------------------------
create table if not exists saved_listing (
  party_id   uuid not null references party(id),
  listing_id uuid not null references listing(id),
  created_at timestamptz not null default now(),
  primary key (party_id, listing_id),
  unique (party_id, listing_id)
);

create index if not exists saved_listing_listing_idx
  on saved_listing (listing_id);

alter table saved_listing enable row level security;
alter table saved_listing force row level security;

drop policy if exists saved_listing_party on saved_listing;
create policy saved_listing_party on saved_listing
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

-- ---------------------------------------------------------------------------
-- 6. support_case
-- ---------------------------------------------------------------------------
create table if not exists support_case (
  id                     uuid primary key default gen_random_uuid(),
  party_id               uuid not null references party(id),
  org_id                 uuid references org(id),
  category               text not null check (category in (
                           'screening',
                           'payment',
                           'cashback',
                           'listing_issue',
                           'privacy',
                           'account',
                           'broker_relationship',
                           'fraud'
                         )),
  subject                text not null,
  description            text not null,
  related_listing_id     uuid references listing(id),
  related_application_id uuid references application(id),
  status                 text not null default 'open'
                           check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint support_case_subject_len check (char_length(subject) <= 200),
  constraint support_case_description_len check (char_length(description) <= 5000)
);

create index if not exists support_case_party_idx
  on support_case (party_id, created_at desc);

alter table support_case enable row level security;
alter table support_case force row level security;

drop policy if exists support_case_party on support_case;
create policy support_case_party on support_case
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

-- ---------------------------------------------------------------------------
-- 7. lease_document
-- ---------------------------------------------------------------------------
create table if not exists lease_document (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references application(id),
  listing_id           uuid not null references listing(id),
  org_id               uuid not null references org(id),
  uploaded_by_party_id uuid not null references party(id),
  storage_key          text not null,
  original_filename    text not null,
  content_type         text not null,
  status               text not null default 'uploaded'
                         check (status in ('uploaded', 'shared', 'executed', 'void')),
  created_at           timestamptz not null default now(),
  executed_at          timestamptz
);

create index if not exists lease_document_app_idx
  on lease_document (application_id, created_at desc);
create index if not exists lease_document_listing_idx
  on lease_document (listing_id, created_at desc);

alter table lease_document enable row level security;
alter table lease_document force row level security;

drop policy if exists lease_document_tenant on lease_document;
create policy lease_document_tenant on lease_document
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
  );

-- ---------------------------------------------------------------------------
-- 8. cashback_eligibility (status architecture only — display offer, no funding)
-- ---------------------------------------------------------------------------
create table if not exists cashback_eligibility (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references application(id),
  listing_id        uuid not null references listing(id),
  party_id          uuid not null references party(id),
  org_id            uuid not null references org(id),
  -- display_v1: UI display offer only — not a funded program commitment
  offer_version     text not null default 'display_v1',
  rate_bps          int not null default 2000,
  rent_basis_cents  int,
  amount_cents      int,
  status            text not null default 'offered'
                      check (status in (
                        'offered',
                        'qualified',
                        'pending_verification',
                        'eligible',
                        'paid',
                        'ineligible',
                        'exception'
                      )),
  ineligible_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table cashback_eligibility is
  'Status architecture for display cashback offer (display_v1 / 2000 bps). No funding ledger.';
comment on column cashback_eligibility.offer_version is
  'display_v1 — display offer version only; not a funded economics commitment';
comment on column cashback_eligibility.rate_bps is
  'Default 2000 = 20% display rate for offer_version display_v1';

create index if not exists cashback_eligibility_party_idx
  on cashback_eligibility (party_id, created_at desc);
create index if not exists cashback_eligibility_org_idx
  on cashback_eligibility (org_id, created_at desc);

alter table cashback_eligibility enable row level security;
alter table cashback_eligibility force row level security;

drop policy if exists cashback_eligibility_access on cashback_eligibility;
create policy cashback_eligibility_access on cashback_eligibility
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or party_id::text = current_setting('rbit.current_party_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or org_id::text = current_setting('rbit.current_org_id', true)
    or party_id::text = current_setting('rbit.current_party_id', true)
  );

-- ---------------------------------------------------------------------------
-- 9. broker_provider_invitation
-- ---------------------------------------------------------------------------
create table if not exists broker_provider_invitation (
  id                   uuid primary key default gen_random_uuid(),
  broker_org_id        uuid not null references org(id),
  provider_org_id      uuid references org(id),
  contact_email        text not null,
  business_name        text,
  note                 text,
  status               text not null default 'pending'
                         check (status in (
                           'pending',
                           'delivered',
                           'accepted',
                           'expired',
                           'revoked',
                           'delivery_failed'
                         )),
  invited_by_party_id  uuid not null references party(id),
  created_at           timestamptz not null default now(),
  accepted_at          timestamptz,
  expires_at           timestamptz,
  constraint broker_provider_invitation_email_len check (char_length(contact_email) <= 320),
  constraint broker_provider_invitation_note_len check (note is null or char_length(note) <= 2000)
);

create index if not exists broker_provider_invitation_broker_idx
  on broker_provider_invitation (broker_org_id, created_at desc);

alter table broker_provider_invitation enable row level security;
alter table broker_provider_invitation force row level security;

drop policy if exists broker_provider_invitation_tenant on broker_provider_invitation;
create policy broker_provider_invitation_tenant on broker_provider_invitation
  for all
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or broker_org_id::text = current_setting('rbit.current_org_id', true)
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or broker_org_id::text = current_setting('rbit.current_org_id', true)
  );

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rbit_app') then
    grant select, insert, update on listing_criteria to rbit_app;
    grant select, insert, update on missing_info_request to rbit_app;
    grant select, insert, update, delete on saved_listing to rbit_app;
    grant select, insert, update on support_case to rbit_app;
    grant select, insert, update on lease_document to rbit_app;
    grant select, insert, update on cashback_eligibility to rbit_app;
    grant select, insert, update on broker_provider_invitation to rbit_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    grant select, insert, update on listing_criteria to rbit_app_user;
    grant select, insert, update on missing_info_request to rbit_app_user;
    grant select, insert, update, delete on saved_listing to rbit_app_user;
    grant select, insert, update on support_case to rbit_app_user;
    grant select, insert, update on lease_document to rbit_app_user;
    grant select, insert, update on cashback_eligibility to rbit_app_user;
    grant select, insert, update on broker_provider_invitation to rbit_app_user;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    grant select, insert, update, delete on listing_criteria to rbit_migrator;
    grant select, insert, update, delete on missing_info_request to rbit_migrator;
    grant select, insert, update, delete on saved_listing to rbit_migrator;
    grant select, insert, update, delete on support_case to rbit_migrator;
    grant select, insert, update, delete on lease_document to rbit_migrator;
    grant select, insert, update, delete on cashback_eligibility to rbit_migrator;
    grant select, insert, update, delete on broker_provider_invitation to rbit_migrator;
  end if;
end $$;
