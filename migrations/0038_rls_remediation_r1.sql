-- R-1 remediation: RLS for wrongly-allowlisted broker-scoped lead tables.
-- lead_offer: tenant column is broker_org_id (spec §10.3).
-- lead: no org column in spec; visibility is via lead_offer.broker_org_id
--   (offered/purchasing broker). Policy uses EXISTS — no invented org_id column.
-- screening_report_access: granted_to_org_id.
-- solar_* already have partner_org_id policies (0034); removed from allowlist only.

alter table lead_offer enable row level security;
alter table lead_offer force row level security;

drop policy if exists lead_offer_tenant_isolation on lead_offer;
create policy lead_offer_tenant_isolation on lead_offer
  using (
    broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

alter table lead enable row level security;
alter table lead force row level security;

drop policy if exists lead_tenant_isolation on lead;
create policy lead_tenant_isolation on lead
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or exists (
      select 1 from lead_offer o
      where o.lead_id = lead.id
        and o.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
  );

-- Inserts of lead (pre-offer) require bypass or a matching offer row.
-- Application paths that create leads run with bypass or immediately create an offer.
create policy lead_tenant_insert on lead
  for insert
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or exists (
      select 1 from lead_offer o
      where o.lead_id = lead.id
        and o.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
  );

alter table lead_purchase_evidence enable row level security;
alter table lead_purchase_evidence force row level security;

drop policy if exists lead_purchase_evidence_tenant_isolation on lead_purchase_evidence;
create policy lead_purchase_evidence_tenant_isolation on lead_purchase_evidence
  using (
    current_setting('rbit.bypass_rls', true) = 'on'
    or exists (
      select 1 from lead_offer o
      where o.lead_id = lead_purchase_evidence.lead_id
        and o.broker_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
        and o.response = 'accepted'
    )
  );

alter table screening_report_access enable row level security;
alter table screening_report_access force row level security;

drop policy if exists screening_report_access_tenant_isolation on screening_report_access;
create policy screening_report_access_tenant_isolation on screening_report_access
  using (
    granted_to_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    granted_to_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );
