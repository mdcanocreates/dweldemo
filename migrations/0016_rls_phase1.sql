-- Phase 1 RLS for org_id-scoped tables

do $$
declare
  t text;
begin
  foreach t in array array[
    'listing',
    'source',
    'source_listing',
    'application',
    'landlord_interest',
    'landlord_decision',
    'placement'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I
         using (
           org_id = nullif(current_setting(''rbit.current_org_id'', true), '''')::uuid
           or current_setting(''rbit.bypass_rls'', true) = ''on''
         )
         with check (
           org_id = nullif(current_setting(''rbit.current_org_id'', true), '''')::uuid
           or current_setting(''rbit.bypass_rls'', true) = ''on''
         )',
      t || '_tenant_isolation',
      t
    );
  end loop;
end $$;
