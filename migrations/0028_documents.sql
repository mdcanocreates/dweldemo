-- §12.1 Documents

create table document (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references org(id),
  owner_party_id    uuid references party(id),
  doc_type          text not null,
  retention_class   text not null,
  storage_key       text not null,
  content_hash      text not null,
  content_type      text not null,
  size_bytes        bigint not null,
  version           int not null default 1,
  supersedes_id     uuid references document(id),
  scan_status       text not null default 'pending',
  purge_after       date,
  created_at        timestamptz not null default now()
);
create index on document (org_id, created_at desc);
create index on document (purge_after) where purge_after is not null;
create index on document (owner_party_id);

create table document_grant (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references document(id),
  grantee_org_id    uuid references org(id),
  grantee_party_id  uuid references party(id),
  permission        text not null check (permission in ('view','download')),
  granted_at        timestamptz not null default now(),
  expires_at        timestamptz,
  revoked_at        timestamptz
);
create index on document_grant (document_id) where revoked_at is null;
create index on document_grant (grantee_party_id) where revoked_at is null;
create index on document_grant (grantee_org_id) where revoked_at is null;

create table document_access_log (
  id                bigserial primary key,
  document_id       uuid not null,
  actor_party_id    uuid,
  actor_org_id      uuid,
  action            text not null check (action in ('view','download','url_issued')),
  request_id        uuid,
  ip                inet,
  occurred_at       timestamptz not null default now()
);
create index on document_access_log (document_id, occurred_at desc);
