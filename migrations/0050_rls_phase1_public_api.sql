-- RLS for Phase 1 public API tables (application-scoped via join)

alter table application_access_token enable row level security;
alter table application_access_token force row level security;
drop policy if exists application_access_token_tenant_isolation on application_access_token;
create policy application_access_token_tenant_isolation on application_access_token
  using (
    exists (
      select 1 from application a
      where a.id = application_access_token.application_id
        and (
          a.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
          or a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from application a
      where a.id = application_access_token.application_id
        and (
          a.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
          or a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

alter table screening_consent enable row level security;
alter table screening_consent force row level security;
drop policy if exists screening_consent_tenant_isolation on screening_consent;
create policy screening_consent_tenant_isolation on screening_consent
  using (
    exists (
      select 1 from application a
      where a.id = screening_consent.application_id
        and (
          a.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
          or a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from application a
      where a.id = screening_consent.application_id
        and (
          a.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
          or a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );
