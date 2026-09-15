-- §12.2 Notifications

create table notification (
  id                 uuid primary key default gen_random_uuid(),
  recipient_party_id uuid not null references party(id),
  channel            text not null check (channel in ('in_platform','email','sms')),
  event_type         text not null,
  template_key       text not null,
  template_version   text not null,
  payload            jsonb not null,
  status             text not null check (status in
                       ('queued','sent','delivered','bounced','failed','read')),
  provider_message_id text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  read_at            timestamptz
);
create index on notification (recipient_party_id, status, created_at desc);

create table notification_preference (
  party_id   uuid not null references party(id),
  event_type text not null,
  channel    text not null,
  is_enabled boolean not null default true,
  primary key (party_id, event_type, channel)
);

create table notification_suppression (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null,
  address_hmac  bytea not null,
  reason        text not null check (reason in
                  ('hard_bounce','complaint','unsubscribe','manual')),
  suppressed_at timestamptz not null default now()
);
