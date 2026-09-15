-- Part I: broker payout gate + Stripe Connect account linkage on org

alter table org
  add column if not exists broker_payouts_enabled boolean not null default false,
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_status text
    check (stripe_connect_status is null or stripe_connect_status in
      ('none','pending','restricted','active')),
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false,
  add column if not exists stripe_connect_details_submitted boolean not null default false,
  add column if not exists stripe_connect_updated_at timestamptz;

comment on column org.broker_payouts_enabled is
  'Per-org Part I flag. When false, money-movement payout UI is hidden; Connect onboarding still allowed.';
