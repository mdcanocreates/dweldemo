-- Sandbox Stripe PaymentIntents. These rows are not real cash and cannot
-- point at a ledger transaction.

create table stripe_sandbox_payment (
  id                    uuid primary key default gen_random_uuid(),
  mode                  text not null check (mode = 'test'),
  purpose               text not null check (purpose in ('applicant_screening_fee', 'ny_path2_screening')),
  application_id        uuid,
  party_id              uuid,
  amount_cents          int not null check (amount_cents > 0),
  currency              text not null default 'usd',
  payment_intent_id     text not null unique,
  status                text not null,
  livemode              boolean not null default false check (livemode = false),
  ledger_transaction_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stripe_sandbox_payment_no_real_ledger check (ledger_transaction_id is null)
);

create index stripe_sandbox_payment_party_idx
  on stripe_sandbox_payment (party_id, created_at desc);

create table stripe_webhook_event (
  id                 uuid primary key default gen_random_uuid(),
  mode               text not null check (mode = 'test'),
  provider_event_id  text not null unique,
  event_type         text not null,
  payment_intent_id  text,
  livemode           boolean not null,
  disposition        text not null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);

alter table stripe_sandbox_payment enable row level security;
alter table stripe_sandbox_payment force row level security;
alter table stripe_webhook_event enable row level security;
alter table stripe_webhook_event force row level security;

create policy stripe_sandbox_payment_party on stripe_sandbox_payment
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

create policy stripe_webhook_event_system on stripe_webhook_event
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

grant select, insert, update on stripe_sandbox_payment to rbit_app;
grant select, insert, update on stripe_sandbox_payment to rbit_app_user;
grant select, insert, update on stripe_webhook_event to rbit_app;
grant select, insert, update on stripe_webhook_event to rbit_app_user;
