-- §7 Screening + Phase 2 operational tables (archival, cost, webhooks)
-- vendor_cost_entry is a TEMPORARY cost-attribution store; Phase 3 journals into the real ledger.

create table screening_package (
  id                  uuid primary key default gen_random_uuid(),
  package_key         text not null,
  version             text not null,
  vendor              text not null default 'certn',
  product_codes       text[] not null,
  applies_to_rs_tiers text[],
  total_cost_cents    int not null,
  is_active           boolean not null default true,
  unique (package_key, version)
);

create table screening_order (
  id                   uuid primary key default gen_random_uuid(),
  party_id             uuid not null references party(id),
  application_id       uuid references application(id),
  package_id           uuid not null references screening_package(id),
  payer_kind           text not null check (payer_kind in
                         ('applicant','landlord','broker','rbit_promotional')),
  payer_party_id       uuid references party(id),
  payer_org_id         uuid references org(id),
  amount_charged_cents int not null,
  vendor_order_ref     text,
  status               text not null check (status in
                         ('pending_payment','paid','submitted','partial',
                          'complete','failed','cancelled')),
  is_rebate_eligible   boolean not null default true,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);
create index on screening_order (party_id, created_at desc);
create index on screening_order (application_id) where application_id is not null;
create index on screening_order (vendor_order_ref) where vendor_order_ref is not null;

create table screening_report (
  id                 uuid primary key default gen_random_uuid(),
  screening_order_id uuid not null references screening_order(id),
  party_id           uuid not null references party(id),
  vendor             text not null,
  vendor_report_id   text not null,
  report_kind        text not null check (report_kind in
                       ('identity','credit','criminal','risk_insight','income')),
  issued_at          timestamptz,
  expires_at         timestamptz,
  payload_ref        text,
  payload_hash       text,
  derived_summary    jsonb,
  cost_cents         int,
  status             text not null check (status in
                       ('pending','complete','failed','expired')),
  unique (vendor, vendor_report_id)
);
create index on screening_report (screening_order_id);
create index on screening_report (party_id, report_kind);

create table screening_report_access (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references screening_report(id),
  granted_to_org_id uuid not null references org(id),
  application_id    uuid references application(id),
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  first_viewed_at   timestamptz,
  view_count        int not null default 0
);
create index on screening_report_access (report_id);
create index on screening_report_access (granted_to_org_id);

create table income_verification (
  id                   uuid primary key default gen_random_uuid(),
  party_id             uuid not null references party(id),
  method               text not null check (method in
                         ('plaid_bank','plaid_payroll','vendor_payroll','document','stated')),
  confidence           numeric not null,
  monthly_income_cents int,
  verified_at          timestamptz not null,
  expires_at           timestamptz,
  vendor_ref           text,
  evidence_ref         text
);
create index on income_verification (party_id, verified_at desc);

create table screening_rebate (
  id                 uuid primary key default gen_random_uuid(),
  screening_order_id uuid not null unique references screening_order(id),
  party_id           uuid not null references party(id),
  placement_id       uuid not null references placement(id),
  amount_cents       int not null,
  status             text not null check (status in
                       ('eligible','payout_details_requested','processing',
                        'paid','failed','expired')),
  payout_method_ref  text,
  eligible_at        timestamptz not null default now(),
  paid_at            timestamptz,
  expires_at         timestamptz not null
);
create index on screening_rebate (party_id);

create table fraud_signal (
  id                   uuid primary key default gen_random_uuid(),
  party_id             uuid references party(id),
  application_id       uuid references application(id),
  signal_kind          text not null,
  severity             text not null check (severity in ('low','medium','high')),
  detail               jsonb not null,
  detected_at          timestamptz not null default now(),
  review_status        text not null default 'pending' check (review_status in
                         ('pending','confirmed_fraud','cleared','ignored')),
  reviewed_by_party_id uuid,
  reviewed_at          timestamptz
);
create index on fraud_signal (review_status, detected_at desc)
  where review_status = 'pending';
create index on fraud_signal (application_id) where application_id is not null;
create index on fraud_signal (party_id) where party_id is not null;

-- Phase 2 operational: webhook raw store (§3.5) — unique on vendor event id
create table vendor_webhook_event (
  id               uuid primary key default gen_random_uuid(),
  vendor           text not null,
  vendor_event_id  text not null,
  event_type       text not null,
  payload          jsonb not null,
  signature_valid  boolean not null default true,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  processing_error text,
  unique (vendor, vendor_event_id)
);

-- Phase 2 operational: request/response archival (no SSN/gov-id values)
create table vendor_request_archive (
  id                 uuid primary key default gen_random_uuid(),
  vendor             text not null,
  capability         text not null,
  correlation_id     text not null,
  screening_order_id uuid references screening_order(id),
  application_id     uuid references application(id),
  request_payload    jsonb not null,
  created_at         timestamptz not null default now()
);
create index on vendor_request_archive (vendor, created_at);
create index on vendor_request_archive (correlation_id);

create table vendor_response_archive (
  id                 uuid primary key default gen_random_uuid(),
  vendor             text not null,
  capability         text not null,
  correlation_id     text not null,
  screening_order_id uuid references screening_order(id),
  application_id     uuid references application(id),
  response_payload   jsonb not null,
  http_status        int,
  created_at         timestamptz not null default now()
);
create index on vendor_response_archive (vendor, created_at);
create index on vendor_response_archive (correlation_id);

-- TEMPORARY cost attribution store (Phase 3 will journal into real ledger)
create table vendor_cost_entry (
  id                 uuid primary key default gen_random_uuid(),
  vendor             text not null,
  capability         text not null,
  screening_order_id uuid references screening_order(id),
  application_id     uuid references application(id),
  amount_cents       int not null,
  currency           text not null default 'USD',
  occurred_at        timestamptz not null default now(),
  correlation_id     text,
  webhook_event_id   uuid references vendor_webhook_event(id),
  note               text
);
create index on vendor_cost_entry (vendor, occurred_at);
create index on vendor_cost_entry (application_id) where application_id is not null;
create index on vendor_cost_entry (screening_order_id) where screening_order_id is not null;

-- In-process durable saga simulator state (Temporal worker seam target)
create table screening_saga_state (
  id                 uuid primary key default gen_random_uuid(),
  screening_order_id uuid not null unique references screening_order(id),
  workflow_id        text not null unique,
  run_id             text not null,
  status             text not null check (status in
                       ('running','completed','failed','cancelled')),
  step               text not null,
  state_payload      jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
