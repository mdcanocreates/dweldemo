-- Part A — GLOBAL_TABLES RLS remediation
-- Policies for tables classified SIMPLE / JOIN / PARTY / DUAL in A-1.
-- No new business columns except none required (all join/party paths exist).

-- ---------------------------------------------------------------------------
-- Helper: empty string from unset GUC must not cast to uuid
-- Pattern: nullif(current_setting('rbit.current_*', true), '')::uuid
-- ---------------------------------------------------------------------------

-- JOIN: sync_run via source.org_id
alter table sync_run enable row level security;
alter table sync_run force row level security;
drop policy if exists sync_run_tenant_isolation on sync_run;
create policy sync_run_tenant_isolation on sync_run
  using (
    exists (
      select 1 from source s
      where s.id = sync_run.source_id
        and s.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from source s
      where s.id = sync_run.source_id
        and s.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: raw_record via source.org_id
alter table raw_record enable row level security;
alter table raw_record force row level security;
drop policy if exists raw_record_tenant_isolation on raw_record;
create policy raw_record_tenant_isolation on raw_record
  using (
    exists (
      select 1 from source s
      where s.id = raw_record.source_id
        and s.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from source s
      where s.id = raw_record.source_id
        and s.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: listing_field_provenance via listing.org_id
alter table listing_field_provenance enable row level security;
alter table listing_field_provenance force row level security;
drop policy if exists listing_field_provenance_tenant_isolation on listing_field_provenance;
create policy listing_field_provenance_tenant_isolation on listing_field_provenance
  using (
    exists (
      select 1 from listing l
      where l.id = listing_field_provenance.listing_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from listing l
      where l.id = listing_field_provenance.listing_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: unit_source_conflict via listing on unit
alter table unit_source_conflict enable row level security;
alter table unit_source_conflict force row level security;
drop policy if exists unit_source_conflict_tenant_isolation on unit_source_conflict;
create policy unit_source_conflict_tenant_isolation on unit_source_conflict
  using (
    exists (
      select 1 from listing l
      where l.unit_id = unit_source_conflict.unit_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from listing l
      where l.unit_id = unit_source_conflict.unit_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: placement_queue_entry via listing.org_id
alter table placement_queue_entry enable row level security;
alter table placement_queue_entry force row level security;
drop policy if exists placement_queue_entry_tenant_isolation on placement_queue_entry;
create policy placement_queue_entry_tenant_isolation on placement_queue_entry
  using (
    exists (
      select 1 from listing l
      where l.id = placement_queue_entry.listing_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from listing l
      where l.id = placement_queue_entry.listing_id
        and l.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: placement_outcome via placement.org_id
alter table placement_outcome enable row level security;
alter table placement_outcome force row level security;
drop policy if exists placement_outcome_tenant_isolation on placement_outcome;
create policy placement_outcome_tenant_isolation on placement_outcome
  using (
    exists (
      select 1 from placement p
      where p.id = placement_outcome.placement_id
        and p.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from placement p
      where p.id = placement_outcome.placement_id
        and p.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- DUAL: screening_order — applicant party, payer org, or listing landlord org
alter table screening_order enable row level security;
alter table screening_order force row level security;
drop policy if exists screening_order_tenant_isolation on screening_order;
create policy screening_order_tenant_isolation on screening_order
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or payer_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or exists (
      select 1 from application a
      where a.id = screening_order.application_id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or payer_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or exists (
      select 1 from application a
      where a.id = screening_order.application_id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- DUAL: screening_report — subject party or org with access grant / payer
alter table screening_report enable row level security;
alter table screening_report force row level security;
drop policy if exists screening_report_tenant_isolation on screening_report;
create policy screening_report_tenant_isolation on screening_report
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or exists (
      select 1 from screening_report_access sra
      where sra.report_id = screening_report.id
        and sra.revoked_at is null
        and sra.granted_to_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or exists (
      select 1 from screening_order so
      where so.id = screening_report.screening_order_id
        and (
          so.payer_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
          or so.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: screening_rebate
alter table screening_rebate enable row level security;
alter table screening_rebate force row level security;
drop policy if exists screening_rebate_party_isolation on screening_rebate;
create policy screening_rebate_party_isolation on screening_rebate
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: income_verification
alter table income_verification enable row level security;
alter table income_verification force row level security;
drop policy if exists income_verification_party_isolation on income_verification;
create policy income_verification_party_isolation on income_verification
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- DUAL: fraud_signal
alter table fraud_signal enable row level security;
alter table fraud_signal force row level security;
drop policy if exists fraud_signal_tenant_isolation on fraud_signal;
create policy fraud_signal_tenant_isolation on fraud_signal
  using (
    (
      party_id is not null
      and party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    )
    or exists (
      select 1 from application a
      where a.id = fraud_signal.application_id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    current_setting('rbit.bypass_rls', true) = 'on'
    or (
      party_id is not null
      and party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    )
    or exists (
      select 1 from application a
      where a.id = fraud_signal.application_id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
  );

-- JOIN: solar_underwriting_decision via solar_deal.partner_org_id
alter table solar_underwriting_decision enable row level security;
alter table solar_underwriting_decision force row level security;
drop policy if exists solar_underwriting_decision_tenant_isolation on solar_underwriting_decision;
create policy solar_underwriting_decision_tenant_isolation on solar_underwriting_decision
  using (
    exists (
      select 1 from solar_deal d
      where d.id = solar_underwriting_decision.solar_deal_id
        and d.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from solar_deal d
      where d.id = solar_underwriting_decision.solar_deal_id
        and d.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN: solar_deal_remittance via solar_deal.partner_org_id
alter table solar_deal_remittance enable row level security;
alter table solar_deal_remittance force row level security;
drop policy if exists solar_deal_remittance_tenant_isolation on solar_deal_remittance;
create policy solar_deal_remittance_tenant_isolation on solar_deal_remittance
  using (
    exists (
      select 1 from solar_deal d
      where d.id = solar_deal_remittance.solar_deal_id
        and d.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from solar_deal d
      where d.id = solar_deal_remittance.solar_deal_id
        and d.partner_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- DUAL: document_grant
alter table document_grant enable row level security;
alter table document_grant force row level security;
drop policy if exists document_grant_tenant_isolation on document_grant;
create policy document_grant_tenant_isolation on document_grant
  using (
    grantee_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or grantee_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    grantee_org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    or grantee_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- JOIN/DUAL: document_access_log via document
alter table document_access_log enable row level security;
alter table document_access_log force row level security;
drop policy if exists document_access_log_tenant_isolation on document_access_log;
create policy document_access_log_tenant_isolation on document_access_log
  using (
    exists (
      select 1 from document d
      where d.id = document_access_log.document_id
        and (
          d.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
          or d.owner_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    exists (
      select 1 from document d
      where d.id = document_access_log.document_id
        and (
          d.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
          or d.owner_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
        )
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: notification
alter table notification enable row level security;
alter table notification force row level security;
drop policy if exists notification_party_isolation on notification;
create policy notification_party_isolation on notification
  using (
    recipient_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    recipient_party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: notification_preference
alter table notification_preference enable row level security;
alter table notification_preference force row level security;
drop policy if exists notification_preference_party_isolation on notification_preference;
create policy notification_preference_party_isolation on notification_preference
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY + discoverable SELECT for landlords: renter_profile
alter table renter_profile enable row level security;
alter table renter_profile force row level security;
drop policy if exists renter_profile_party_isolation on renter_profile;
drop policy if exists renter_profile_owner on renter_profile;
drop policy if exists renter_profile_discoverable_read on renter_profile;
create policy renter_profile_owner on renter_profile
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );
-- Landlord discoverability search (§9.4) — SELECT only when org context set
create policy renter_profile_discoverable_read on renter_profile
  for select
  using (
    is_discoverable = true
    and nullif(current_setting('rbit.current_org_id', true), '') is not null
  );

-- DUAL: score — subject party or landlord org on the application
alter table score enable row level security;
alter table score force row level security;
drop policy if exists score_party_isolation on score;
create policy score_party_isolation on score
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or exists (
      select 1 from application a
      where a.id = score.application_id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: feature_snapshot
alter table feature_snapshot enable row level security;
alter table feature_snapshot force row level security;
drop policy if exists feature_snapshot_party_isolation on feature_snapshot;
create policy feature_snapshot_party_isolation on feature_snapshot
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );

-- PARTY: session
alter table session enable row level security;
alter table session force row level security;
drop policy if exists session_party_isolation on session;
create policy session_party_isolation on session
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  )
  with check (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    or current_setting('rbit.bypass_rls', true) = 'on'
  );
