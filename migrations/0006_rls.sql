-- §3.1 Multi-tenancy RLS on every tenant-scoped table.
-- Global tables are listed in GLOBAL_TABLES.json.

alter table org_claim enable row level security;
alter table org_claim force row level security;

create policy org_claim_tenant_isolation on org_claim
  using (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );
