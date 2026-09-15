-- B-9 Notification sequences

create table notification_sequence (
  id              uuid primary key default gen_random_uuid(),
  sequence_key    text not null unique,
  description     text not null,
  trigger_event   text not null,
  is_active       boolean not null default true,
  version         text not null
);

create table notification_sequence_step (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references notification_sequence(id),
  step_number     int not null,
  delay_hours     int not null,
  template_key    text not null,
  channel         text not null check (channel in ('email','in_platform','sms')),
  cancel_if       text,
  unique (sequence_id, step_number)
);

create table notification_sequence_instance (
  id               uuid primary key default gen_random_uuid(),
  sequence_id      uuid not null references notification_sequence(id),
  party_id         uuid not null references party(id),
  trigger_event_id uuid,
  context          jsonb not null,
  current_step     int not null default 1,
  status           text not null check (status in
                     ('active','completed','cancelled','failed')),
  started_at       timestamptz not null default now(),
  next_step_at     timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text
);
create index on notification_sequence_instance (status, next_step_at)
  where status = 'active';

-- Seed launch sequences
insert into notification_sequence (id, sequence_key, description, trigger_event, version)
values
  ('a1000000-0000-4000-8000-000000000001', 'renter_application_abandoned',
   'Nudge renters who submitted but did not authorize screening',
   'application.status_changed', 'v1'),
  ('a1000000-0000-4000-8000-000000000002', 'landlord_viewed_no_action',
   'Nudge landlords who viewed interest without deciding',
   'landlord_interest.viewed', 'v1'),
  ('a1000000-0000-4000-8000-000000000003', 'broker_lead_inactive',
   'Nudge brokers with no lead_offer response',
   'lead_offer.offered', 'v1');

insert into notification_sequence_step (sequence_id, step_number, delay_hours, template_key, channel, cancel_if)
values
  ('a1000000-0000-4000-8000-000000000001', 1, 24, 'renter_app_waiting', 'email', 'screening_authorized'),
  ('a1000000-0000-4000-8000-000000000001', 2, 72, 'renter_badge_almost', 'email', 'screening_authorized'),
  ('a1000000-0000-4000-8000-000000000001', 3, 168, 'renter_last_chance', 'email', 'application_closed'),
  ('a1000000-0000-4000-8000-000000000002', 1, 48, 'landlord_viewed_nudge', 'email', 'landlord_decision.created'),
  ('a1000000-0000-4000-8000-000000000002', 2, 96, 'landlord_submarket_nudge', 'email', 'landlord_decision.created'),
  ('a1000000-0000-4000-8000-000000000003', 1, 168, 'broker_inactive_summary', 'email', 'lead_offer.accepted'),
  ('a1000000-0000-4000-8000-000000000003', 2, 336, 'broker_missing_submarket', 'email', 'lead_offer.accepted');

-- Party-scoped instances
alter table notification_sequence_instance enable row level security;
alter table notification_sequence_instance force row level security;
create policy notification_sequence_instance_party on notification_sequence_instance
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- Catalog tables are reference
grant select on notification_sequence, notification_sequence_step to rbit_app, rbit_app_user;
grant select, insert, update on notification_sequence_instance to rbit_app, rbit_app_user;
