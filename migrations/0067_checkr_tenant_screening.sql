-- Checkr Tenant screening — sub-state separate from application leasing status.
-- Application status machine (awaiting_consent → screening_authorized → …) is unchanged.

create table checkr_tenant_screening (
  id                      uuid primary key default gen_random_uuid(),
  application_id          uuid not null references application(id),
  property_id             uuid references property(id),
  listing_id              uuid references listing(id),
  applicant_party_id      uuid not null references party(id),
  requester_party_id      uuid references party(id),
  requester_org_id        uuid not null references org(id),
  screening_order_id      uuid references screening_order(id),
  -- Checkr Tenant resource ids (never log full report payloads)
  checkr_order_id         text,
  checkr_report_id        text,
  checkr_applicant_id     text,
  checkr_property_id      text,
  package_slug            text not null default 'essential',
  payer                   text not null default 'organization'
                            check (payer in ('organization', 'applicant')),
  environment             text not null check (environment in ('test', 'live')),
  -- Screening sub-state (orthogonal to application.status)
  status                  text not null default 'not_requested'
                            check (status in (
                              'not_requested',
                              'awaiting_applicant',
                              'processing',
                              'completed',
                              'failed',
                              'canceled'
                            )),
  application_url         text,
  idempotency_key         text not null,
  -- Permitted summary for review UI — never full SSN / raw provider dumps
  report_summary          jsonb,
  product_statuses        jsonb not null default '{}'::jsonb,
  last_webhook_at         timestamptz,
  last_error_code         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  completed_at            timestamptz,
  unique (application_id, idempotency_key)
);

-- At most one non-terminal Checkr screening per application (app-level dedup;
-- Checkr test mode does not enforce order idempotency).
create unique index checkr_tenant_screening_one_active_per_app
  on checkr_tenant_screening (application_id)
  where status in ('not_requested', 'awaiting_applicant', 'processing');

create index checkr_tenant_screening_order_id
  on checkr_tenant_screening (checkr_order_id)
  where checkr_order_id is not null;

create index checkr_tenant_screening_report_id
  on checkr_tenant_screening (checkr_report_id)
  where checkr_report_id is not null;

create index checkr_tenant_screening_applicant
  on checkr_tenant_screening (applicant_party_id, created_at desc);

create index checkr_tenant_screening_requester_org
  on checkr_tenant_screening (requester_org_id, created_at desc);

-- Audit trail for report / document access (permissible purpose + actor)
create table checkr_report_access_audit (
  id                uuid primary key default gen_random_uuid(),
  screening_id      uuid not null references checkr_tenant_screening(id),
  actor_party_id    uuid references party(id),
  actor_org_id      uuid references org(id),
  access_kind       text not null check (access_kind in (
                      'summary_view', 'report_fetch', 'pdf_download',
                      'document_download', 'documents_zip'
                    )),
  permissible_purpose text,
  ip                text,
  user_agent        text,
  created_at        timestamptz not null default now()
);
create index on checkr_report_access_audit (screening_id, created_at desc);
create index on checkr_report_access_audit (actor_party_id, created_at desc);

comment on table checkr_tenant_screening is
  'Checkr Tenant order/report linkage. Sub-status is separate from application leasing status. Retention: follow FCRA + org policy; delete via crypto-shred / retention jobs — never log report payloads.';
comment on table checkr_report_access_audit is
  'Audit of who viewed/downloaded Checkr screening artifacts. Retain per compliance policy.';
