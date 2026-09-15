-- Phase 2: no new org_id-scoped tables in §7 screening DDL.
-- screening_report_access uses granted_to_org_id (not org_id) — GLOBAL_TABLES.
-- Placeholder migration keeps expand/contract numbering; RLS policies for any
-- future org-scoped Phase 2 tables would land here.

-- Ensure application RLS from Phase 1 remains; no-op assert.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'application'
      and policyname = 'application_tenant_isolation'
  ) then
    raise exception 'Phase 1 application RLS missing — Phase 2 depends on it';
  end if;
end $$;
