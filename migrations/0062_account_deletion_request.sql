-- Tracked account deletion requests (no cascading wipe of retained records).
create table if not exists account_deletion_request (
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid not null references party(id),
  status      text not null check (status in ('pending', 'in_review', 'completed', 'rejected')),
  reason      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists account_deletion_request_party_idx
  on account_deletion_request (party_id, created_at desc);

alter table account_deletion_request enable row level security;
alter table account_deletion_request force row level security;

drop policy if exists account_deletion_request_party on account_deletion_request;
create policy account_deletion_request_party on account_deletion_request
  using (party_id = nullif(current_setting('app.party_id', true), '')::uuid);
