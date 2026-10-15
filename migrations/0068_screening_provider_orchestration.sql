-- Provider-agnostic screening orchestration.
-- Historical orders stay bound to their originating provider permanently.
-- Admin selects default provider; env vars gate infrastructure enablement.

-- Default provider selection (singleton row id = 'default')
create table screening_provider_setting (
  id                   text primary key default 'default' check (id = 'default'),
  selected_provider    text not null default 'disabled'
                         check (selected_provider in ('certn', 'checkr_tenant', 'disabled')),
  updated_at           timestamptz not null default now(),
  updated_by_party_id  uuid references party(id)
);

insert into screening_provider_setting (id, selected_provider)
values ('default', 'disabled')
on conflict (id) do nothing;

create table screening_provider_setting_change (
  id                   uuid primary key default gen_random_uuid(),
  previous_value       text not null,
  new_value            text not null,
  actor_party_id       uuid not null references party(id),
  created_at           timestamptz not null default now()
);
create index on screening_provider_setting_change (created_at desc);

-- Canonical provider-agnostic screening record (new orders)
create table provider_screening (
  id                      uuid primary key default gen_random_uuid(),
  application_id          uuid not null references application(id),
  -- Permanently bound at create time — never rewritten when default provider changes
  provider                text not null check (provider in ('certn', 'checkr_tenant')),
  provider_order_id       text,
  provider_report_id      text,
  environment             text not null check (environment in ('test', 'live', 'sandbox')),
  status                  text not null default 'not_requested'
                            check (status in (
                              'not_requested',
                              'awaiting_applicant',
                              'processing',
                              'completed',
                              'failed',
                              'canceled'
                            )),
  product_statuses        jsonb not null default '{}'::jsonb,
  -- Permitted summary only — never full SSN / raw dumps in logs
  result_summary          jsonb,
  application_url         text,
  idempotency_key         text not null,
  screening_order_id      uuid references screening_order(id),
  property_id             uuid references property(id),
  listing_id              uuid references listing(id),
  applicant_party_id      uuid not null references party(id),
  requester_party_id      uuid references party(id),
  requester_org_id        uuid not null references org(id),
  -- Opaque provider metadata ref / sanitized bag (not logged verbatim)
  provider_metadata       jsonb not null default '{}'::jsonb,
  last_error_code         text,
  last_webhook_at         timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  completed_at            timestamptz,
  unique (application_id, idempotency_key)
);

create unique index provider_screening_one_active_per_app
  on provider_screening (application_id)
  where status in ('not_requested', 'awaiting_applicant', 'processing');

create index provider_screening_provider_order
  on provider_screening (provider, provider_order_id)
  where provider_order_id is not null;

create index provider_screening_application
  on provider_screening (application_id, created_at desc);

create index provider_screening_requester_org
  on provider_screening (requester_org_id, created_at desc);

-- Durable provider column on screening_order for historical Certn/saga rows
alter table screening_order
  add column if not exists provider text;

update screening_order so
set provider = coalesce(
  (select sp.vendor from screening_package sp where sp.id = so.package_id),
  'certn'
)
where provider is null;

alter table screening_order
  alter column provider set default 'certn';

-- Webhook processing history (provider-agnostic view over vendor_webhook_event)
-- Comparison / sandbox test runs (synthetic applicants only)
create table screening_comparison_run (
  id                         uuid primary key default gen_random_uuid(),
  scenario_key               text not null,
  provider                   text not null check (provider in ('certn', 'checkr_tenant')),
  provider_screening_id      uuid references provider_screening(id),
  screening_status           text,
  applicant_flow_completed   boolean not null default false,
  request_latency_ms         int,
  webhook_received           boolean not null default false,
  report_available           boolean not null default false,
  error_code                 text,
  -- Sanitized metadata only — no SSN / raw PII
  provider_response_metadata jsonb not null default '{}'::jsonb,
  actor_party_id             uuid references party(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index on screening_comparison_run (provider, scenario_key, created_at desc);
create index on screening_comparison_run (created_at desc);

-- Platform flags for infrastructure-level enablement mirrors (admin visibility)
insert into platform_flag (name, enabled, compliance_tag, description) values
  ('checkr_tenant_screening_enabled', false, null, 'Env+admin gate for Checkr Tenant screening'),
  ('screening_provider_orchestration', true, null, 'Use provider-agnostic screening orchestration')
on conflict (name) do nothing;

comment on table provider_screening is
  'Provider-agnostic screening. provider column is immutable after create. Retention per FCRA/org policy.';
comment on table screening_provider_setting is
  'Admin-selected default provider for NEW screenings only. Env must enable the provider.';
comment on table screening_comparison_run is
  'Internal sandbox comparison runs — synthetic applicants only; never production PII.';
