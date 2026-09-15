-- §12.3 Domain event log + tamper-evident admin action log

create table domain_event (
  id             uuid primary key default gen_random_uuid(),
  seq            bigserial,
  aggregate_type text not null,
  aggregate_id   uuid not null,
  event_type     text not null,
  event_version  int not null default 1,
  payload        jsonb not null,
  actor_party_id uuid,
  actor_kind     text check (actor_kind in ('user','system','vendor','admin')),
  request_id     uuid,
  occurred_at    timestamptz not null default now()
);
create index on domain_event (aggregate_type, aggregate_id, seq);
create index on domain_event (event_type, occurred_at);

create table admin_action_log (
  id                       uuid primary key default gen_random_uuid(),
  seq                      bigserial,
  actor_party_id           uuid not null,
  impersonation_session_id uuid references impersonation_session(id),
  dual_approval_request_id uuid references dual_approval_request(id),
  action                   text not null,
  target_type              text,
  target_id                uuid,
  before_state             jsonb,
  after_state              jsonb,
  reason_code              text,
  request_id               uuid,
  ip                       inet,
  user_agent               text,
  occurred_at              timestamptz not null default now(),
  prev_hash                bytea,
  row_hash                 bytea not null
);
create index on admin_action_log (seq);
create index on admin_action_log (actor_party_id, occurred_at desc);
