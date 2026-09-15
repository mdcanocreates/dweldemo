-- Phase 6 RLS for partner_org_id-scoped solar tables (§13 / P5)
-- Spec names the tenant column partner_org_id (not org_id). Policies bind
-- partner_org_id to rbit.current_org_id. Tables are also listed in GLOBAL_TABLES
-- because the tenancy gate keys on column name org_id — see evidence/phase6/spec-gaps.txt.

do $$
declare
  t text;
begin
  foreach t in array array[
    'solar_deal',
    'solar_partner_remittance'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I
         using (
           partner_org_id = nullif(current_setting(''rbit.current_org_id'', true), '''')::uuid
           or current_setting(''rbit.bypass_rls'', true) = ''on''
         )
         with check (
           partner_org_id = nullif(current_setting(''rbit.current_org_id'', true), '''')::uuid
           or current_setting(''rbit.bypass_rls'', true) = ''on''
         )',
      t || '_tenant_isolation',
      t
    );
  end loop;
end $$;
