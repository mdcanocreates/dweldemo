-- Consented renter interest, mock notification outbox, property claims, and provider access.
-- Live email and live Stripe charges stay disabled until separate authorization.

create table if not exists renter_interest (
  id                      uuid primary key default gen_random_uuid(),
  interest_id             text not null unique,
  party_id                uuid not null references party(id),
  listing_id              uuid not null references listing(id),
  org_id                  uuid references org(id),
  requested_action        text not null check (requested_action in (
                            'request_information', 'ask_availability', 'schedule_tour'
                          )),
  consent_version         text not null,
  contact_share_scope     text[] not null default '{}',
  state                   text not null default 'created' check (state in (
                            'created', 'delivery_pending', 'notified', 'provider_claim_pending',
                            'provider_verified', 'access_pending', 'accessible', 'contacted',
                            'closed', 'failed', 'opted_out', 'revoked'
                          )),
  idempotency_key         text not null,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (party_id, listing_id, requested_action, idempotency_key)
);
create index if not exists renter_interest_listing_idx on renter_interest (listing_id, created_at desc);
create index if not exists renter_interest_party_idx on renter_interest (party_id, created_at desc);

create table if not exists interest_notification_outbox (
  id                      uuid primary key default gen_random_uuid(),
  interest_id             uuid not null references renter_interest(id) on delete cascade,
  channel                 text not null default 'email',
  recipient_fingerprint   text not null,
  template_key            text not null,
  transport               text not null default 'mock'
                            check (transport in ('mock', 'staging', 'live')),
  delivery_status         text not null default 'queued' check (delivery_status in (
                            'queued', 'suppressed', 'sent_mock', 'sent', 'bounced', 'failed'
                          )),
  dedupe_key              text not null unique,
  attempt_count           int not null default 0,
  last_error              text,
  sent_at                 timestamptz,
  created_at              timestamptz not null default now()
);

create table if not exists notification_suppression_contact (
  id                      uuid primary key default gen_random_uuid(),
  address_fingerprint     text not null unique,
  reason                  text not null,
  created_at              timestamptz not null default now()
);

create table if not exists property_listing_claim (
  id                      uuid primary key default gen_random_uuid(),
  listing_id              uuid not null references listing(id),
  party_id                uuid not null references party(id),
  org_id                  uuid references org(id),
  claim_token_hash        text not null unique,
  evidence_summary        text,
  status                  text not null default 'pending' check (status in (
                            'pending', 'verified', 'rejected', 'expired', 'revoked'
                          )),
  expires_at              timestamptz not null,
  verified_at             timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists property_listing_claim_listing_idx
  on property_listing_claim (listing_id, status);

create table if not exists provider_access_plan (
  id                      uuid primary key default gen_random_uuid(),
  plan_key                text not null unique,
  billing_model           text not null check (billing_model in ('per_listing', 'monthly_subscription')),
  amount_cents            int not null check (amount_cents > 0),
  currency                text not null default 'usd',
  active                  boolean not null default true,
  created_at              timestamptz not null default now()
);

-- No default dollar price is seeded. An approved amount must be inserted explicitly
-- before any entitlement can become active.

create table if not exists provider_listing_access (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references org(id),
  listing_id              uuid not null references listing(id),
  plan_id                 uuid not null references provider_access_plan(id),
  billing_model           text not null check (billing_model in ('per_listing', 'monthly_subscription')),
  stripe_mode             text not null default 'test' check (stripe_mode in ('test', 'live')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  entitlement_status      text not null default 'pending' check (entitlement_status in (
                            'pending', 'active', 'revoked', 'refunded', 'expired'
                          )),
  period_start            timestamptz,
  period_end              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, listing_id, billing_model)
);

alter table renter_interest enable row level security;
alter table renter_interest force row level security;
alter table interest_notification_outbox enable row level security;
alter table interest_notification_outbox force row level security;
alter table notification_suppression_contact enable row level security;
alter table notification_suppression_contact force row level security;
alter table property_listing_claim enable row level security;
alter table property_listing_claim force row level security;
alter table provider_access_plan enable row level security;
alter table provider_access_plan force row level security;
alter table provider_listing_access enable row level security;
alter table provider_listing_access force row level security;

create policy renter_interest_party on renter_interest
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

create policy interest_notification_outbox_system on interest_notification_outbox
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

create policy notification_suppression_contact_system on notification_suppression_contact
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

create policy property_listing_claim_party on property_listing_claim
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

create policy provider_access_plan_read on provider_access_plan
  for select using (active = true or current_setting('rbit.bypass_rls', true) = 'on');
create policy provider_access_plan_write on provider_access_plan
  using (current_setting('rbit.bypass_rls', true) = 'on')
  with check (current_setting('rbit.bypass_rls', true) = 'on');

create policy provider_listing_access_org on provider_listing_access
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

grant select, insert, update on renter_interest to rbit_app, rbit_app_user;
grant select, insert, update on interest_notification_outbox to rbit_app, rbit_app_user;
grant select, insert, update on notification_suppression_contact to rbit_app, rbit_app_user;
grant select, insert, update on property_listing_claim to rbit_app, rbit_app_user;
grant select on provider_access_plan to rbit_app, rbit_app_user;
grant select, insert, update on provider_access_plan to rbit_app, rbit_app_user;
grant select, insert, update on provider_listing_access to rbit_app, rbit_app_user;
