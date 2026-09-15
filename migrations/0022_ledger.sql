-- §11.1 Ledger + balance trigger + chart seed

create table ledger_account (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  kind                text not null check (kind in
                        ('asset','liability','equity','revenue','expense')),
  counterparty_org_id uuid references org(id),
  counterparty_party_id uuid references party(id),
  currency            char(3) not null default 'USD',
  is_active           boolean not null default true
);

-- Spec unique uses coalesce expressions — implemented as unique index (§11.1).
create unique index ledger_account_code_counterparty_uidx on ledger_account (
  code,
  coalesce(counterparty_org_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(counterparty_party_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create table ledger_transaction (
  id                uuid primary key default gen_random_uuid(),
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  kind              text not null,
  idempotency_key   text not null unique,
  source_event_id   uuid,
  reverses_txn_id   uuid references ledger_transaction(id),
  memo              text
);

create table ledger_entry (
  id                bigserial primary key,
  transaction_id    uuid not null references ledger_transaction(id),
  account_id        uuid not null references ledger_account(id),
  direction         char(2) not null check (direction in ('dr','cr')),
  amount_cents      bigint not null check (amount_cents > 0)
);
create index on ledger_entry (account_id, transaction_id);

create or replace function assert_ledger_balanced() returns trigger as $$
declare imbalance bigint;
begin
  select coalesce(sum(case when direction='dr' then amount_cents else -amount_cents end),0)
    into imbalance from ledger_entry where transaction_id = new.transaction_id;
  if imbalance <> 0 then
    raise exception 'ledger imbalance % on txn %', imbalance, new.transaction_id;
  end if;
  return null;
end $$ language plpgsql;

create constraint trigger ledger_balance_check
  after insert on ledger_entry
  deferrable initially deferred
  for each row execute function assert_ledger_balanced();

-- §11.2 Chart of accounts — global (no counterparty) seed rows
insert into ledger_account (code, kind) values
  ('asset:cash:stripe', 'asset'),
  ('asset:cash:operating', 'asset'),
  ('asset:receivable:pbc_solar', 'asset'),
  ('liability:broker_prepaid_balance', 'liability'),
  ('liability:unearned_revenue', 'liability'),
  ('liability:payable:solar_homeowner', 'liability'),
  ('liability:payable:screening_rebate', 'liability'),
  ('revenue:lead_fee', 'revenue'),
  ('revenue:profit_share', 'revenue'),
  ('expense:screening_cogs', 'expense'),
  ('expense:screening_rebate', 'expense'),
  ('expense:processing_fees', 'expense'),
  ('expense:disputes', 'expense');
