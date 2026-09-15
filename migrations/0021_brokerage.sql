-- §10 Brokerage and lead marketplace

create table broker_profile (
  org_id              uuid primary key references org(id),
  license_state       char(2) not null,
  license_number      text,
  license_verified_at timestamptz,
  license_expires_at  date,
  status              text not null,
  credit_tier         text not null default 'new' check (credit_tier in
                        ('new','established','invoiced','suspended')),
  max_open_leads      int not null default 10,
  is_auto_accept      boolean not null default false
);

create table broker_coverage (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references org(id),
  submarket_id      uuid not null references submarket(id),
  priority          int not null default 100,
  is_active         boolean not null default true,
  unique (org_id, submarket_id)
);

create table broker_performance (
  org_id                    uuid primary key references org(id),
  window_days               int not null default 90,
  leads_offered             int not null default 0,
  leads_accepted            int not null default 0,
  median_response_seconds   int,
  placements_closed         int not null default 0,
  close_rate                numeric,
  leakage_rate              numeric,
  dispute_count             int not null default 0,
  updated_at                timestamptz not null default now()
);

create table broker_balance (
  org_id            uuid primary key references org(id),
  balance_cents     bigint not null default 0 check (balance_cents >= 0),
  updated_at        timestamptz not null default now()
);

create table broker_balance_txn (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references org(id),
  kind              text not null check (kind in
                      ('funding','lead_purchase','refund','adjustment')),
  amount_cents      bigint not null,
  balance_after_cents bigint not null,
  ledger_transaction_id uuid,
  lead_id           uuid,
  idempotency_key   text not null unique,
  created_at        timestamptz not null default now()
);

create table lead (
  id                        uuid primary key default gen_random_uuid(),
  application_id            uuid not null references application(id),
  listing_id                uuid not null references listing(id),
  party_id                  uuid not null references party(id),
  rs_tier                   text not null,
  classifier_version        text not null,
  rent_amount_cents_at_class int not null,
  price_book_version        text not null,
  fee_amount_cents          int not null,
  status                    text not null check (status in
                              ('created','classified','offered','purchased',
                               'released','reoffered','expired','closed','resolved')),
  created_at                timestamptz not null default now()
);

create table lead_offer (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references lead(id),
  broker_org_id     uuid not null references org(id),
  offered_at        timestamptz not null default now(),
  sla_expires_at    timestamptz not null,
  responded_at      timestamptz,
  response          text check (response in ('accepted','declined','expired')),
  decline_reason    text
);
create unique index one_open_offer_per_lead on lead_offer (lead_id)
  where responded_at is null;

create table lead_purchase_evidence (
  lead_id           uuid primary key references lead(id),
  purchased_by_party_id uuid not null,
  session_id        uuid not null,
  ip                inet not null,
  user_agent        text,
  tos_version       text not null,
  payload_released  jsonb not null,
  released_at       timestamptz not null
);

-- In-process SLA saga state (Temporal seam; same pattern as screening_saga_state)
create table lead_offer_saga_state (
  lead_id           uuid primary key references lead(id),
  workflow_id       text not null unique,
  run_id            uuid not null,
  status            text not null,
  step              text not null,
  state_payload     jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);
