# R-1 — GLOBAL_TABLES classification (before)

Criterion for legitimate membership (to be enforced): **reference data only, no counterparty scope, no PII**.

| Table | Classification | One-line justification |
|---|---|---|
| schema_migrations | legitimately global | Migration bookkeeping; no tenant data |
| org | legitimately global | Tenant root entity (is the org) |
| party | legitimately global | Identity spine; person-scoped, not org-tenant (§3.4) |
| data_encryption_key | legitimately global | Per-party key material; identity half |
| party_identity | legitimately global | Encrypted PII half of party; not org-scoped |
| external_identity_ref | legitimately global | Vendor subject ids; party-scoped |
| party_features | legitimately global | De-identified retained half; no org_id by design |
| party_role | legitimately global | Cross-cutting roles; org_id nullable |
| permission | legitimately global | Reference permission catalog |
| role_permission | legitimately global | Reference role map |
| dual_approval_request | legitimately global | Platform admin workflow |
| impersonation_session | legitimately global | Platform admin session |
| domain_event | legitimately global | Append-only spine; payloads by reference |
| admin_action_log | legitimately global | Tamper-evident admin log |
| config_version | legitimately global | Versioned config catalog |
| submarket | legitimately global | Geo reference |
| address | legitimately global | Shared normalized address; not org-owned |
| property | legitimately global | Physical asset shared across sources |
| unit | legitimately global | Physical unit; multi-source merge |
| mapping_profile | legitimately global | Ingestion mapping reference |
| source_display_rule | legitimately global | Display rule template reference |
| spatial_ref_sys | legitimately global | PostGIS catalog |
| screening_package | legitimately global | Package catalog reference |
| model_registry | legitimately global | Model catalog reference |
| ledger_account | legitimately global | Chart of accounts (optional counterparty on row) |
| ledger_transaction | legitimately global | Immutable financial journal header |
| ledger_entry | legitimately global | Immutable financial journal lines |
| payment_event | legitimately global | Provider webhook landing (not org RLS) |
| reconciliation_run | legitimately global | Reconciliation batch metadata |
| search_event | legitimately global | Analytics event stream (async; not tenant UI) |
| search_event_default | legitimately global | Partition of search_event |
| search_event_y2026m01–y2027m01 | legitimately global | Partitions of search_event |
| search_demand_daily | legitimately global | Aggregate rollup |
| **lead** | **wrongly allowlisted** | Applicant lead; broker-scoped via offers — MUST RLS |
| **lead_offer** | **wrongly allowlisted** | Has `broker_org_id`; MUST RLS |
| **lead_purchase_evidence** | **wrongly allowlisted** | Released PII payload to purchasing broker |
| **solar_deal** | **wrongly allowlisted** | Already has RLS on `partner_org_id`; remove from allowlist |
| **solar_partner_remittance** | **wrongly allowlisted** | Already has RLS on `partner_org_id`; remove from allowlist |
| **screening_report_access** | **wrongly allowlisted** | Has `granted_to_org_id`; MUST RLS |

## Ambiguous — REPORT, DO NOT FIX (left on allowlist)

| Table | Why ambiguous |
|---|---|
| sync_run | Scoped via `source.org_id` join, no own org column |
| raw_record | Scoped via `source_id` join |
| listing_field_provenance | Via listing; multi-source |
| unit_source_conflict | Unit is shared physical; multi-org conflict |
| auth_magic_token | Party-scoped PII; not org tenancy |
| session | Party-scoped |
| renter_profile | Party-scoped discoverability |
| score / feature_snapshot | Party-scoped scoring |
| placement_queue_entry | Via listing/application; dual parties |
| placement_outcome | Via placement; landlord vs broker reporter |
| notification* | Party recipient, not org |
| screening_order | payer_org_id nullable; party_id primary |
| screening_report | Party-scoped portable report |
| income_verification / screening_rebate / fraud_signal | Party-scoped |
| vendor_* / vendor_cost_entry / screening_saga_state | Platform/vendor ops |
| lead_offer_saga_state | Workflow state keyed by lead_id only |
| document_grant / document_access_log | grantee_org_id nullable; mixed party/org |
| solar_underwriting_decision / solar_deal_remittance | Child of solar_deal; no tenant column |
