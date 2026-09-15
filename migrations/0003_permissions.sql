-- §3.2 Permission model

create table permission (
  key                    text primary key,
  description            text not null,
  requires_dual_approval boolean not null default false
);

create table role_permission (
  role           text not null,
  permission_key text not null references permission(key),
  primary key (role, permission_key)
);

create table dual_approval_request (
  id                   uuid primary key default gen_random_uuid(),
  permission_key       text not null references permission(key),
  requested_by_party_id uuid not null references party(id),
  payload              jsonb not null,
  target_type          text,
  target_id            uuid,
  status               text not null check (status in ('pending','approved','rejected','expired')),
  approved_by_party_id uuid references party(id),
  requested_at         timestamptz not null default now(),
  resolved_at          timestamptz,
  expires_at           timestamptz not null
);

create table impersonation_session (
  id                       uuid primary key default gen_random_uuid(),
  admin_party_id           uuid not null references party(id),
  target_party_id          uuid not null references party(id),
  reason_code              text not null,
  ticket_ref               text,
  dual_approval_request_id uuid references dual_approval_request(id),
  started_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  ended_at                 timestamptz,
  is_read_only             boolean not null default true
);

insert into permission (key, description, requires_dual_approval) values
  ('config.approve', 'Approve a config_version to go effective', true),
  ('impersonation.write', 'Write-enabled impersonation', true),
  ('ledger.refund', 'Issue a ledger refund', true),
  ('ledger.manual_entry', 'Post a manual ledger entry', true),
  ('ingestion.quarantine_override', 'Override ingestion quarantine', true),
  ('screening.adverse_action_override', 'Override adverse action review', true),
  ('party.purge_immediate', 'Immediate party crypto-shred', true),
  ('config.propose', 'Propose a config version', false),
  ('impersonation.read', 'Read-only impersonation', false);

insert into role_permission (role, permission_key) values
  ('rbit_admin', 'config.propose'),
  ('rbit_admin', 'config.approve'),
  ('rbit_admin', 'impersonation.read'),
  ('rbit_admin', 'impersonation.write'),
  ('rbit_admin', 'ledger.refund'),
  ('rbit_admin', 'ledger.manual_entry'),
  ('rbit_admin', 'ingestion.quarantine_override'),
  ('rbit_admin', 'screening.adverse_action_override'),
  ('rbit_admin', 'party.purge_immediate'),
  ('rbit_support', 'impersonation.read'),
  ('rbit_super_admin', 'config.propose'),
  ('rbit_super_admin', 'config.approve'),
  ('rbit_super_admin', 'impersonation.read'),
  ('rbit_super_admin', 'impersonation.write'),
  ('rbit_super_admin', 'ledger.refund'),
  ('rbit_super_admin', 'ledger.manual_entry'),
  ('rbit_super_admin', 'ingestion.quarantine_override'),
  ('rbit_super_admin', 'screening.adverse_action_override'),
  ('rbit_super_admin', 'party.purge_immediate');
