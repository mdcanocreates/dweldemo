# A-1 — Ambiguous GLOBAL_TABLES classification

Do not write policies yet. Scoping from schema + §3.1 / Part A guidance.

| Table | Has org_id | Policy type | Join path or justification |
|---|---|---|---|
| sync_run | no | JOIN | `source_id → source.org_id` |
| raw_record | no | JOIN | `source_id → source.org_id` |
| listing_field_provenance | no | JOIN | `listing_id → listing.org_id` |
| unit_source_conflict | no | JOIN | `unit_id → listing.unit_id` where `listing.org_id` (landlord who owns a listing on the unit) |
| placement_queue_entry | no | JOIN | `listing_id → listing.org_id` |
| placement_outcome | no | JOIN | `placement_id → placement.org_id` |
| landlord_interest | **yes** | SIMPLE | Already has RLS in `0016_rls_phase1.sql` — not on allowlist; N/A for A-2 |
| screening_order | no (`payer_org_id` nullable) | DUAL | `party_id = current_party` **or** `payer_org_id = current_org` **or** `application.org_id = current_org` |
| screening_report | no | DUAL | `party_id = current_party` **or** EXISTS grant via `screening_report_access.granted_to_org_id` / order payer org |
| screening_rebate | no | PARTY | `party_id = current_party` |
| income_verification | no | PARTY | `party_id = current_party` |
| fraud_signal | no | DUAL | `party_id = current_party` **or** `application.org_id = current_org` (nullable party allowed only with bypass / matching org app) |
| solar_underwriting_decision | no | JOIN | `solar_deal_id → solar_deal.partner_org_id` |
| solar_deal_remittance | no | JOIN | `solar_deal_id → solar_deal.partner_org_id` |
| document_grant | no | DUAL | `grantee_org_id = current_org` **or** `grantee_party_id = current_party` |
| document_access_log | no | JOIN | `document_id → document` where `document.org_id = current_org` **or** `document.owner_party_id = current_party` |
| notification | no | PARTY | `recipient_party_id = current_party` |
| notification_preference | no | PARTY | `party_id = current_party` |
| notification_suppression | no | GLOBAL | Platform suppression list keyed by `address_hmac` — no party/org column; not tenant UI |
| renter_profile | no | PARTY (+ discoverable SELECT) | Owner: `party_id = current_party`. Extra SELECT policy: `is_discoverable` when `current_org` set (§9.4 landlord search) |
| score | no | DUAL | `party_id = current_party` **or** EXISTS `application.org_id = current_org` (landlord decision path) |
| feature_snapshot | no | PARTY | `party_id = current_party` |
| session | no | PARTY | `party_id = current_party` |
| auth_magic_token | no | GLOBAL | Pre-auth: redeem looks up by `token_hash` **before** party context exists; RLS would break login. Platform token store. |
| vendor_webhook_event | no | GLOBAL | Platform webhook landing; no tenant key; processed by workers under bypass |
| vendor_request_archive | no | GLOBAL | Platform vendor archive; no tenant key; workers under bypass |
| vendor_response_archive | no | GLOBAL | Same as request archive |
| vendor_cost_entry | no | GLOBAL | Temporary platform cost attribution; Phase 3 journals to ledger |
| screening_saga_state | no | GLOBAL | Platform Temporal/in-process workflow state; workers under bypass |
| lead_offer_saga_state | no | GLOBAL | Platform SLA workflow state; workers under bypass |
| ledger_account | no (`counterparty_org_id` optional) | GLOBAL | Platform chart of accounts / journal; isolation via grants (SELECT+INSERT), not row RLS |
| ledger_transaction | no | GLOBAL | Immutable platform journal header |
| ledger_entry | no | GLOBAL | Immutable platform journal lines |
| payment_event | no | GLOBAL | Provider webhook landing zone |
| reconciliation_run | no | GLOBAL | Platform reconciliation batch metadata |
| search_event (+ partitions) | no (`party_id` optional) | GLOBAL | Analytics async buffer; not tenant UI; ETL under bypass |
| search_demand_daily | no | GLOBAL | Aggregate rollup; no tenant column |
| screening_package | n/a | GLOBAL | Package catalog reference (already legitimate) |

## Halt items for Michael

**None.** Closest judgment calls documented as GLOBAL with explicit justification:
1. `auth_magic_token` — pre-auth redeem path cannot set `current_party_id`
2. Ledger / payment / vendor / saga / search analytics — platform spine without a single owning org

## A-2 action set

Write policies + remove from allowlist for:  
`sync_run`, `raw_record`, `listing_field_provenance`, `unit_source_conflict`, `placement_queue_entry`, `placement_outcome`, `screening_order`, `screening_report`, `screening_rebate`, `income_verification`, `fraud_signal`, `solar_underwriting_decision`, `solar_deal_remittance`, `document_grant`, `document_access_log`, `notification`, `notification_preference`, `renter_profile`, `score`, `feature_snapshot`, `session`.

Remain GLOBAL (with justifications): auth_magic_token, notification_suppression, vendor_*, saga states, ledger_*, payment_event, reconciliation_run, search_event*, search_demand_daily, screening_package (+ existing reference tables).
