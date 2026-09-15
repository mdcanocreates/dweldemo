-- Phase 6 — Solar vertical (§13) + model_registry for solar_underwriting (§8.1 / §13.3)

-- §8.1 model_registry (required by §13.3; scoring tables beyond this remain Phase 7)
create table model_registry (
  id                 uuid primary key default gen_random_uuid(),
  model_key          text not null,
  version            text not null,
  kind               text not null check (kind in ('rules','ml')),
  artifact_ref       text,
  feature_spec       jsonb not null,
  trained_at         timestamptz,
  training_window    tstzrange,
  training_row_count int,
  activated_at       timestamptz,
  retired_at         timestamptz,
  unique (model_key, version)
);

insert into model_registry (model_key, version, kind, feature_spec, activated_at)
values (
  'solar_underwriting',
  'rules-v1',
  'rules',
  '{
    "inputs": [
      "system_size_kw",
      "gross_project_cost_cents",
      "sale_price_cents",
      "redline_cents",
      "tier",
      "tier_cap_cents"
    ],
    "config_namespaces": ["solar_underwriting", "solar_tiers"]
  }'::jsonb,
  now()
);

-- §11.2 gap: expense:solar_cashback used in §13.5 but absent from chart seed — add here.
insert into ledger_account (code, kind)
select 'expense:solar_cashback', 'expense'
where not exists (
  select 1 from ledger_account
  where code = 'expense:solar_cashback'
    and counterparty_org_id is null
    and counterparty_party_id is null
);

-- §13.3 solar_deal
create table solar_deal (
  id                       uuid primary key default gen_random_uuid(),
  homeowner_party_id       uuid not null references party(id),
  rep_party_id             uuid references party(id),
  partner_org_id           uuid not null references org(id),
  external_project_ref     text,
  address_id               uuid references address(id),
  system_size_kw           numeric(6,2) not null,
  gross_project_cost_cents bigint not null,
  redline_cents            bigint,
  sale_price_cents         bigint not null,
  status                   text not null check (status in
                             ('submitted','underwriting','approved','declined',
                              'installed','partner_paid','homeowner_paid','cancelled')),
  submitted_at             timestamptz not null default now(),
  decided_at               timestamptz,
  installed_at             timestamptz,
  created_at               timestamptz not null default now()
);
create index on solar_deal (status, submitted_at desc);
create index on solar_deal (partner_org_id, status);

-- §13.3 solar_underwriting_decision (insert-only)
create table solar_underwriting_decision (
  id                           uuid primary key default gen_random_uuid(),
  solar_deal_id                uuid not null references solar_deal(id),
  engine_version               text not null,
  config_version_id            uuid not null references config_version(id),
  tier                         int not null check (tier between 1 and 4),
  tier_cap_cents               int not null,
  equation_1_passed            boolean not null,
  equation_1_net_to_rbit_cents bigint not null,
  equation_2_applied           boolean not null,
  adjusted_cap_cents           int,
  approved_cashback_cents      int not null,
  net_to_rbit_cents            bigint not null,
  decision                     text not null check (decision in ('approved','declined')),
  decline_reason               text,
  input_snapshot               jsonb not null,
  explanation                  jsonb not null,
  computed_at                  timestamptz not null default now()
);
create index on solar_underwriting_decision (solar_deal_id, computed_at desc);

-- §13.5 remittance
create table solar_partner_remittance (
  id                    uuid primary key default gen_random_uuid(),
  partner_org_id        uuid not null references org(id),
  period_start          date not null,
  period_end            date not null,
  expected_amount_cents bigint not null,
  received_amount_cents bigint,
  received_at           timestamptz,
  variance_cents        bigint,
  status                text not null check (status in
                          ('expected','received','variance','disputed')),
  statement_document_id uuid references document(id)
);
create index on solar_partner_remittance (partner_org_id, period_start desc);

create table solar_deal_remittance (
  solar_deal_id uuid not null references solar_deal(id),
  remittance_id uuid not null references solar_partner_remittance(id),
  amount_cents  bigint not null,
  primary key (solar_deal_id, remittance_id)
);
