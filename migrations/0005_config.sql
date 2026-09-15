-- §12.4 Versioned effective-dated configuration

create table config_version (
  id                       uuid primary key default gen_random_uuid(),
  namespace                text not null,
  version                  text not null,
  payload                  jsonb not null,
  effective_from           timestamptz not null,
  effective_to             timestamptz,
  proposed_by_party_id     uuid not null references party(id),
  approved_by_party_id     uuid references party(id),
  approved_at              timestamptz,
  dual_approval_request_id uuid references dual_approval_request(id),
  unique (namespace, version)
);
create index on config_version (namespace, effective_from desc);
