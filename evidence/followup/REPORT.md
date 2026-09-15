# Follow-up report — F-1…F-5

Source: user follow-up work order (reconciliation, R-4 completion, spot-checks).

---

## F-1 — Criteria reconciliation

**Canonical total: 77** (exactly the §17 checkboxes in `mainSpec.md`).

Full table: [`evidence/followup/F-1-criteria-table.md`](F-1-criteria-table.md)

### Why 73 / 81 were wrong

| Claim | Reality |
|---|---|
| Audit tally 38+22+12+1+0 = 73 | Audit **Part 3 already had 77 rows**. The Status tally section miscounted (actual Part 3: PASS 50, PASS-AGAINST-STUB 16, PARTIAL 10, FAIL 1 = **77**). |
| Remediation after 41+22+9+1+8 = 81 | Incorrectly **added** 8 BLOCKED-BY-§18 as new §17 rows. Those are §18 decisions (inventory in R-2), not §17 acceptance criteria. |

**No criteria were missed from the spec.** The audit under-counted in its tally footer, then remediation double-counted by importing §18 into the §17 status table.

### Corrected §17 status sums (after R-1 RLS fix)

| Status | Count |
|---|---|
| PASS | 51 |
| PASS-AGAINST-STUB | 16 |
| PARTIAL | 9 |
| FAIL | 1 |
| BLOCKED-BY-§18 | 0 |
| **TOTAL** | **77** |

Moved vs audit Part 3: Phase 0 RLS criterion PARTIAL→PASS (R-1). §18 remains tracked outside this table.

---

## F-2 — R-4 acceptance criteria

| R-4 criterion | Met? | Evidence |
|---|---|---|
| Baseline coverage reported before new tests | **Yes** | `evidence/remediation/R-4/baseline.md` (4.06% lines before unit tests) |
| Final coverage reported, per module, line and branch | **Yes** | Updated below + `evidence/remediation/R-4/coverage/` |
| Every module listed in R-4 has a dedicated unit-test file | **Yes** | `tests/unit/{matching,ledger,brokerage,screening,ingestion,identity}.test.ts` (+ `state-machines.test.ts`) |
| Every state machine has an invalid-transition test | **Yes (now)** | See machine table; `tests/unit/state-machines.test.ts` (9 tests) |
| RS tier boundaries at every `rent_low` / `rent_high` | **Yes (now)** | `tests/unit/brokerage.test.ts` — 24+ edges, $800/$1,199/$1,200/$45,000, $799 floor |

### State machines — invalid-transition inventory

| State machine | Invalid-transition test? | Illegal case asserted | Typed error |
|---|---|---|---|
| application | **Yes** | `closed → screening_running` | `application_invalid_transition` |
| listing | **Yes** | `rented → confirm` | `listing_invalid_transition` |
| placement | **Yes** | `hold → funded`; lapse from `lease_signed` | `placement_invalid_state` |
| lead | **Yes** | `released → purchased` | `LEAD_INVALID_STATUS` |
| lead_offer | **Yes** | double respond | `OFFER_CLOSED` |
| screening_order | **Yes** | `complete → partial` | `order_invalid_transition` |
| solar_deal | **Yes** | `declined → installed` | `solar_invalid_transition` |
| org_claim | **Yes** | approve twice | `claim_not_pending` |

Guards added where missing: `markLeaseSigned` / `markPlacementFunded`, `purchaseLeadWithBalance`, `confirmListing`, `transitionApplication`, `transitionOrderStatus` (throw).

### Updated coverage (`npx vitest run --coverage tests/unit`)

Overall: **lines 27.99%**, **branches 54.28%**

| Module | Lines | Branches |
|---|---|---|
| matching | 58.0% (189/326) | 62.5% (15/24) |
| ledger | 36.7% (136/371) | 96.8% (30/31) |
| brokerage | 48.0% (486/1013) | 42.1% (32/76) |
| screening | 22.0% (360/1638) | 66.7% (42/63) |
| ingestion | 39.2% (883/2251) | 46.0% (86/187) |
| identity | 60.0% (174/290) | 44.4% (8/18) |

### Updated unit test count

**39** unit tests passed (`tests/unit` — 7 files).

---

## F-3 — R-1 GLOBAL_TABLES spot-check

Membership criterion (file header): **reference data only — no counterparty scope, no PII.**

Complete current list with one-line justification (from R-1 classification + current file):

| Table | Justification |
|---|---|
| schema_migrations | Migration bookkeeping |
| org | Tenant root entity |
| party | Identity spine; person-scoped |
| data_encryption_key | Per-party key material |
| party_identity | Encrypted identity half |
| external_identity_ref | Vendor subject ids; party-scoped |
| party_features | De-identified retained half |
| party_role | Cross-cutting roles |
| permission | Reference catalog |
| role_permission | Reference role map |
| dual_approval_request | Platform admin workflow |
| impersonation_session | Platform admin session |
| domain_event | Append-only spine |
| admin_action_log | Tamper-evident admin log |
| config_version | Versioned config catalog |
| submarket | Geo reference |
| address | Shared normalized address |
| property | Physical asset (multi-source) |
| unit | Physical unit (multi-source) |
| mapping_profile | Ingestion mapping reference |
| source_display_rule | Display rule template |
| sync_run | **Ambiguous** — via `source.org_id` join |
| raw_record | **Ambiguous** — via `source_id` |
| listing_field_provenance | **Ambiguous** — via listing / multi-source |
| unit_source_conflict | **Ambiguous** — shared unit / multi-org |
| auth_magic_token | **Ambiguous** — party-scoped PII |
| session | **Ambiguous** — party-scoped |
| renter_profile | **Ambiguous** — party-scoped |
| score | **Ambiguous** — party-scoped |
| placement_queue_entry | **Ambiguous** — dual parties |
| placement_outcome | **Ambiguous** — via placement |
| notification / notification_preference / notification_suppression | **Ambiguous** — party recipient |
| spatial_ref_sys | PostGIS catalog |
| screening_package | Package catalog |
| screening_order | **Ambiguous** — party primary |
| screening_report | **Ambiguous** — party-scoped |
| income_verification | **Ambiguous** — party-scoped |
| screening_rebate | **Ambiguous** — party-scoped |
| fraud_signal | **Ambiguous** — party-scoped |
| vendor_webhook_event / vendor_request_archive / vendor_response_archive / vendor_cost_entry | **Ambiguous** — platform/vendor ops |
| screening_saga_state / lead_offer_saga_state | **Ambiguous** — workflow state |
| ledger_account / ledger_transaction / ledger_entry | Chart / immutable journal |
| payment_event / reconciliation_run | Provider landing / batch meta |
| document_grant / document_access_log | **Ambiguous** — mixed party/org |
| search_event (+ partitions) / search_demand_daily | Analytics stream / rollup |
| model_registry / feature_snapshot | Model catalog / party features |
| solar_underwriting_decision / solar_deal_remittance | **Ambiguous** — child of solar_deal |

**Ambiguous tables flagged during R-1 and left untouched:** yes — the full ambiguous set is listed in `evidence/remediation/R-1/allowlist-classification.md` (sync_run, raw_record, listing_field_provenance, unit_source_conflict, auth_magic_token, session, renter_profile, score/feature_snapshot, placement_queue_entry, placement_outcome, notification*, screening_order/report/rebate/income/fraud, vendor_*, saga states, document_grant/access_log, solar_underwriting_decision, solar_deal_remittance). **Not “none.”**

Removed from allowlist in R-1 (got RLS): `lead`, `lead_offer`, `lead_purchase_evidence`, `screening_report_access`, `solar_deal`, `solar_partner_remittance`.

---

## F-4 — R-3 price-book snapshot spot-check

**Re-run:** Phase 3 acceptance test + remediation R-3 test both pass against config-resolved pricing.

Phase 3 output (`evidence/phase3/tier-snapshot.txt` after re-run):

```json
{
  "originalFee": 14000,
  "originalTier": "RS-4",
  "originalVersion": "test-seed-v1",
  "afterFee": 14000,
  "afterTier": "RS-4",
  "afterVersion": "test-seed-v1",
  "charged": 14000,
  "stripeAmount": 14000,
  "displayed": 14000
}
```

`price_book_version` is `test-seed-v1` from approved `config_version`, not a TypeScript fee constant.

**Assignment from resolved config** (`src/modules/brokerage/lead.ts`):

```46:63:src/modules/brokerage/lead.ts
  const classified = await classifyLeadFee(client, rent, { clock });
  // ...
       price_book_version, fee_amount_cents, status, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'classified',$10)`,
    [
      // ...
      classified.priceBookVersion,
      classified.feeAmountCents,
```

`classifyLeadFee` → `resolvePriceBook` reads `config_version` where `namespace='rs_price_book'` and `approved_by_party_id is not null`; `classified.priceBookVersion` is that row’s `version`.

---

## F-5 — R-5 unbalanced-ledger scope deviation

**Re-run output** (`evidence/phase3/unbalanced-rejected.txt`):

```json
{
  "rejected": true,
  "message": "ledger imbalance 1000 on txn 4ca69fa3-a620-4a26-a70e-23196f401135"
}
```

Current test (`tests/acceptance/phase3.test.ts` L77–112): begins a txn, `set_config('rbit.bypass_rls','on', true)`, inserts unbalanced `ledger_entry` (debit only), commits → deferred trigger raises `ledger imbalance`.

**Did the R-5 fix change what the test proves?** **No.** It still proves database-level deferred-trigger rejection of unbalanced inserts. R-5 only moved `set_config(..., true)` inside the transaction (same local GUC semantics for the duration of the txn); it does not replace the trigger with app-level validation.

---

## Corrected status table (same total as F-1)

| Status | Count |
|---|---|
| PASS | 51 |
| PASS-AGAINST-STUB | 16 |
| PARTIAL | 9 |
| FAIL | 1 |
| BLOCKED-BY-§18 | 0 |
| **TOTAL** | **77** |
