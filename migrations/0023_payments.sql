-- §11.4 Webhooks and reconciliation

create table payment_event (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  raw_payload       jsonb not null,
  is_signature_valid boolean not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  process_attempts  int not null default 0,
  process_error     text,
  unique (provider, provider_event_id)
);

create table reconciliation_run (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  matched_count     int not null default 0,
  unmatched_count   int not null default 0,
  amount_mismatch_count int not null default 0,
  status            text not null,
  ran_at            timestamptz not null default now()
);
