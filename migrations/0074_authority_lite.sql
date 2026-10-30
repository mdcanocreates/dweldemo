-- Authority Lite coordination tables. Additive. Does not copy party or listing.
-- Historical interest and application rows are unchanged.
-- No eligibility, subsidy, or HAP ledger.

create table authority_tenant (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  status text not null check (status in ('trial', 'active', 'suspended')),
  retention_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table authority_membership (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  staff_party_id uuid not null references party(id),
  role text not null check (role in (
    'agency_owner', 'agency_supervisor', 'caseworker', 'navigator', 'inspection_coordinator'
  )),
  status text not null check (status in ('invited', 'active', 'revoked')),
  invited_at timestamptz not null default now(),
  unique (agency_id, staff_party_id, role)
);
create index authority_membership_staff_idx
  on authority_membership (staff_party_id, agency_id);

create table authority_invitation (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  email text not null,
  role text not null check (role in (
    'agency_owner', 'agency_supervisor', 'caseworker', 'navigator', 'inspection_coordinator'
  )),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_party_id uuid references party(id),
  created_at timestamptz not null default now()
);

create table authority_housing_case (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  dwel_party_id uuid references party(id),
  assigned_membership_id uuid references authority_membership(id),
  status text not null check (status in (
    'draft', 'searching', 'tenancy_packet', 'agency_review', 'leaseup_confirmed', 'closed'
  )),
  display_reference text not null,
  search_preferences jsonb not null default '{}'::jsonb,
  assistance_indicator text not null default 'unknown' check (assistance_indicator in (
    'unknown', 'self_reported', 'agency_verified', 'expired', 'revoked'
  )),
  program_type text,
  verification_source text,
  verified_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, display_reference),
  unique (agency_id, id)
);
create index authority_case_assignee_idx
  on authority_housing_case (agency_id, assigned_membership_id, status);

create table authority_case_share (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid not null,
  grantee_party_id uuid not null references party(id),
  scope text[] not null,
  purpose text not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);
create index authority_share_lookup_idx
  on authority_case_share (agency_id, case_id, grantee_party_id);

create table authority_housing_lead (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid not null,
  dwel_listing_id uuid references listing(id),
  provider_party_id uuid references party(id),
  external_listing_reference text,
  listing_source text not null check (listing_source in ('dwel', 'approved_import', 'manual')),
  availability_checked_at timestamptz,
  status text not null check (status in (
    'saved', 'contacted', 'awaiting_provider', 'tour_planned', 'not_pursuing', 'packet_started'
  )),
  reason_code text check (reason_code is null or reason_code in (
    'not_available', 'unresponsive', 'price', 'location_preference', 'missing_info', 'other'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id),
  unique (agency_id, id)
);
create index authority_lead_case_idx
  on authority_housing_lead (agency_id, case_id, status);

create table authority_outreach (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  lead_id uuid not null,
  idempotency_key text not null,
  body text not null,
  created_at timestamptz not null default now(),
  foreign key (agency_id, lead_id) references authority_housing_lead (agency_id, id),
  unique (agency_id, lead_id, idempotency_key)
);

create table authority_tenancy_packet (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid not null,
  lead_id uuid not null,
  form_version text not null,
  status text not null check (status in (
    'draft', 'awaiting_participant', 'awaiting_provider', 'ready_for_agency_review',
    'sent_to_agency', 'agency_acknowledged', 'cancelled'
  )),
  participant_fields jsonb not null default '{}'::jsonb,
  provider_fields jsonb not null default '{}'::jsonb,
  content_hash text,
  agency_ack_reference text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id),
  foreign key (agency_id, lead_id) references authority_housing_lead (agency_id, id),
  unique (agency_id, id)
);

create table authority_appointment (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid not null,
  status text not null check (status in (
    'scheduling_requested', 'appointment_offered', 'scheduled', 'rescheduled',
    'completed_pending_result', 'external_result_recorded'
  )),
  window_start timestamptz,
  window_end timestamptz,
  official_source text,
  official_observation text,
  recorded_by_party_id uuid references party(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);

create table authority_document (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid not null,
  storage_key text not null,
  content_sha256 text,
  mime_type text not null,
  byte_size int not null check (byte_size > 0 and byte_size <= 5000000),
  scan_status text not null check (scan_status in ('quarantine', 'accepted', 'rejected')),
  created_by_party_id uuid not null references party(id),
  created_at timestamptz not null default now(),
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);

create table authority_preview_grant (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references authority_document(id),
  party_id uuid not null references party(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table authority_task (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  case_id uuid,
  assigned_party_id uuid references party(id),
  kind text not null,
  status text not null check (status in ('open', 'completed', 'cancelled')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);

create table authority_event (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  case_id uuid,
  actor_party_id uuid not null references party(id),
  actor_kind text not null check (actor_kind in ('agency', 'participant', 'provider', 'system', 'integration')),
  event_type text not null,
  schema_version int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  request_id text,
  foreign key (agency_id, case_id) references authority_housing_case (agency_id, id)
);
create index authority_event_timeline_idx
  on authority_event (agency_id, case_id, occurred_at desc);

create table authority_idempotency (
  agency_id uuid not null references authority_tenant(id),
  actor_party_id uuid not null references party(id),
  operation text not null,
  idempotency_key text not null,
  payload_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (agency_id, actor_party_id, operation, idempotency_key)
);

create table authority_outbox (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  case_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table authority_import_batch (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references authority_tenant(id),
  mode text not null check (mode in ('preview')),
  checksum text not null,
  row_count int not null,
  error_report jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function authority_party() returns uuid
language sql stable as $$
  select nullif(current_setting('rbit.current_party_id', true), '')::uuid
$$;

create or replace function authority_bypass() returns boolean
language sql stable as $$
  select current_setting('rbit.bypass_rls', true) = 'on'
$$;

-- Reads membership without re-entering its own row policy. Owned by the
-- migration role, which bypasses row security.
create or replace function authority_has_role(agency uuid, roles text[]) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from authority_membership
    where agency_id = agency
      and staff_party_id = authority_party()
      and status = 'active'
      and role = any(roles)
  );
$$;

alter table authority_tenant enable row level security;
alter table authority_tenant force row level security;
alter table authority_membership enable row level security;
alter table authority_membership force row level security;
alter table authority_invitation enable row level security;
alter table authority_invitation force row level security;
alter table authority_housing_case enable row level security;
alter table authority_housing_case force row level security;
alter table authority_case_share enable row level security;
alter table authority_case_share force row level security;
alter table authority_housing_lead enable row level security;
alter table authority_housing_lead force row level security;
alter table authority_outreach enable row level security;
alter table authority_outreach force row level security;
alter table authority_tenancy_packet enable row level security;
alter table authority_tenancy_packet force row level security;
alter table authority_appointment enable row level security;
alter table authority_appointment force row level security;
alter table authority_document enable row level security;
alter table authority_document force row level security;
alter table authority_preview_grant enable row level security;
alter table authority_preview_grant force row level security;
alter table authority_task enable row level security;
alter table authority_task force row level security;
alter table authority_event enable row level security;
alter table authority_event force row level security;
alter table authority_idempotency enable row level security;
alter table authority_idempotency force row level security;
alter table authority_outbox enable row level security;
alter table authority_outbox force row level security;
alter table authority_import_batch enable row level security;
alter table authority_import_batch force row level security;

create policy authority_tenant_read on authority_tenant
  for select using (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_tenant.id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
    )
  );
create policy authority_tenant_insert on authority_tenant
  for insert with check (authority_bypass());

create policy authority_membership_read on authority_membership
  for select using (
    authority_bypass()
    or staff_party_id = authority_party()
    or authority_has_role(agency_id, array['agency_owner', 'agency_supervisor'])
  );
create policy authority_membership_write on authority_membership
  for insert with check (
    authority_bypass()
    or authority_has_role(agency_id, array['agency_owner'])
  );
create policy authority_membership_update on authority_membership
  for update using (
    authority_bypass()
    or staff_party_id = authority_party()
    or authority_has_role(agency_id, array['agency_owner'])
  );

create policy authority_invitation_staff on authority_invitation
  for all using (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_invitation.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role = 'agency_owner'
    )
  )
  with check (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_invitation.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role = 'agency_owner'
    )
  );

create policy authority_case_access on authority_housing_case
  for all using (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_housing_case.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and (
          m.role in ('agency_owner', 'agency_supervisor', 'inspection_coordinator')
          or (m.role = 'caseworker' and m.id = authority_housing_case.assigned_membership_id)
        )
    )
    or exists (
      select 1 from authority_case_share s
      where s.case_id = authority_housing_case.id
        and s.grantee_party_id = authority_party()
        and s.revoked_at is null
        and s.accepted_at is not null
        and s.expires_at > now()
    )
  )
  with check (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_housing_case.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role in ('agency_owner', 'agency_supervisor', 'caseworker')
    )
  );

create policy authority_share_access on authority_case_share
  for all using (
    authority_bypass()
    or grantee_party_id = authority_party()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_case_share.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
    )
  )
  with check (
    authority_bypass()
    or grantee_party_id = authority_party()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_case_share.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role in ('agency_owner', 'agency_supervisor', 'caseworker')
    )
  );

create policy authority_lead_access on authority_housing_lead
  for all using (
    authority_bypass()
    or provider_party_id = authority_party()
    or exists (
      select 1 from authority_housing_case c
      where c.id = authority_housing_lead.case_id
        and c.agency_id = authority_housing_lead.agency_id
    )
  )
  with check (
    authority_bypass()
    or exists (
      select 1 from authority_membership m
      where m.agency_id = authority_housing_lead.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role in ('agency_owner', 'agency_supervisor', 'caseworker', 'navigator')
    )
  );

create policy authority_child_by_case on authority_outreach
  for all using (authority_bypass() or exists (
    select 1 from authority_housing_lead l
    where l.id = authority_outreach.lead_id and l.agency_id = authority_outreach.agency_id
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_housing_lead l
    where l.id = authority_outreach.lead_id and l.agency_id = authority_outreach.agency_id
  ));

create policy authority_packet_access on authority_tenancy_packet
  for all using (
    authority_bypass()
    or exists (
      select 1 from authority_housing_case c
      where c.id = authority_tenancy_packet.case_id
        and c.agency_id = authority_tenancy_packet.agency_id
    )
    or exists (
      select 1 from authority_housing_lead l
      where l.id = authority_tenancy_packet.lead_id
        and l.provider_party_id = authority_party()
    )
  )
  with check (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_tenancy_packet.case_id
      and c.agency_id = authority_tenancy_packet.agency_id
  ) or exists (
    select 1 from authority_housing_lead l
    where l.id = authority_tenancy_packet.lead_id
      and l.provider_party_id = authority_party()
  ));

create policy authority_appointment_access on authority_appointment
  for all using (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_appointment.case_id and c.agency_id = authority_appointment.agency_id
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_appointment.case_id and c.agency_id = authority_appointment.agency_id
  ));

create policy authority_document_access on authority_document
  for all using (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_document.case_id and c.agency_id = authority_document.agency_id
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_document.case_id and c.agency_id = authority_document.agency_id
  ));

create policy authority_preview_self on authority_preview_grant
  for all using (authority_bypass() or party_id = authority_party())
  with check (authority_bypass() or party_id = authority_party());

create policy authority_task_access on authority_task
  for all using (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_task.case_id and c.agency_id = authority_task.agency_id
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_task.case_id and c.agency_id = authority_task.agency_id
  ));

create policy authority_event_access on authority_event
  for all using (authority_bypass() or exists (
    select 1 from authority_housing_case c
    where c.id = authority_event.case_id and c.agency_id = authority_event.agency_id
  ) or (
    authority_event.case_id is null and exists (
      select 1 from authority_membership m
      where m.agency_id = authority_event.agency_id
        and m.staff_party_id = authority_party()
        and m.status = 'active'
        and m.role in ('agency_owner', 'agency_supervisor')
    )
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_membership m
    where m.agency_id = authority_event.agency_id
      and m.staff_party_id = authority_party()
      and m.status = 'active'
  ) or exists (
    select 1 from authority_case_share s
    where s.case_id = authority_event.case_id
      and s.grantee_party_id = authority_party()
      and s.revoked_at is null
      and s.expires_at > now()
  ));

create policy authority_idempotency_self on authority_idempotency
  for all using (authority_bypass() or actor_party_id = authority_party())
  with check (authority_bypass() or actor_party_id = authority_party());

create policy authority_outbox_staff on authority_outbox
  for all using (authority_bypass() or exists (
    select 1 from authority_membership m
    where m.agency_id = authority_outbox.agency_id
      and m.staff_party_id = authority_party()
      and m.status = 'active'
      and m.role in ('agency_owner', 'agency_supervisor')
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_membership m
    where m.agency_id = authority_outbox.agency_id
      and m.staff_party_id = authority_party()
      and m.status = 'active'
  ));

create policy authority_import_owner on authority_import_batch
  for all using (authority_bypass() or exists (
    select 1 from authority_membership m
    where m.agency_id = authority_import_batch.agency_id
      and m.staff_party_id = authority_party()
      and m.status = 'active'
      and m.role = 'agency_owner'
  ))
  with check (authority_bypass() or exists (
    select 1 from authority_membership m
    where m.agency_id = authority_import_batch.agency_id
      and m.staff_party_id = authority_party()
      and m.status = 'active'
      and m.role = 'agency_owner'
  ));

do $$
declare
  rel text;
begin
  foreach rel in array array[
    'authority_tenant', 'authority_membership', 'authority_invitation',
    'authority_housing_case', 'authority_case_share', 'authority_housing_lead',
    'authority_outreach', 'authority_tenancy_packet', 'authority_appointment',
    'authority_document', 'authority_preview_grant', 'authority_task',
    'authority_event', 'authority_idempotency', 'authority_outbox', 'authority_import_batch'
  ]
  loop
    if exists (select 1 from pg_roles where rolname = 'rbit_app') then
      execute format('grant select, insert, update on %I to rbit_app', rel);
    end if;
    if exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
      execute format('grant select, insert, update on %I to rbit_app_user', rel);
    end if;
    if exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
      execute format('grant all on %I to rbit_migrator', rel);
    end if;
  end loop;
end $$;
