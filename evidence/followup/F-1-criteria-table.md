# F-1 Reconciled §17 criterion list

| # | Phase | Criterion (verbatim from spec) | Status |
|---|---|---|---|
| 1 | 0 | `psql` output showing RLS enabled and a policy present on every non-allowlisted table | PASS |
| 2 | 0 | CI log showing the tenancy gate failing on a deliberately unscoped table, then passing | PASS |
| 3 | 0 | Synthetic PII request produces log output containing zero PII values | PARTIAL |
| 4 | 0 | Crypto-shred: create party → write identity → destroy DEK → identity unreadable, `party_features` intact, ledger/audit FKs valid | PASS-AGAINST-STUB |
| 5 | 0 | Hash-chain verifier passes on 1,000 seeded rows, fails on one manually tampered row | PASS |
| 6 | 0 | Dual approval: requester cannot approve own request; super admin bypasses; both asserted | PASS |
| 7 | 0 | `domain_event` emitted for every state transition in a seeded fixture run | PARTIAL |
| 8 | 0 | Terraform applies cleanly to all three accounts from a clean state | FAIL |
| 9 | 1 | Concurrency: 50 parallel accepts on one unit → exactly 1 placement, 49 clean typed rejections | PASS |
| 10 | 1 | Hold expiry: lapse → unit frees → queue head promoted → events emitted | PASS-AGAINST-STUB |
| 11 | 1 | Address fixtures: `123 Main St Apt 2` / `123 Main Street #2` / `123 MAIN ST UNIT 2` → one `unit_id` | PASS |
| 12 | 1 | Listing lifecycle: active → stale at 14d → expired at 21d, via clock manipulation | PASS |
| 13 | 1 | Manual listing produces `source_listing` + merged `listing` + populated provenance; no bypass path exists | PASS |
| 14 | 1 | CSV import of 500 rows: resolution counts reported, ambiguous routed to queue, zero silent drops | PASS |
| 15 | 1 | Placement signed → four `placement_outcome` rows with correct scheduled dates | PASS-AGAINST-STUB |
| 16 | 1 | Outcome capture: single-tap email link records a response without a login session | PASS |
| 17 | 1 | Passwordless: single-use token, 15-min expiry, enumeration-resistant, rate limits enforced | PARTIAL |
| 18 | 1 | Renter search rejects any filter key outside the allowlist at the API boundary, with an explicit error | PASS |
| 19 | 1 | Renter search response at `minimal` discoverability contains zero identity fields, asserted across the full serializer | PASS |
| 20 | 1 | Every executed renter search persists its filter set to `admin_action_log` | PASS |
| 21 | 2 | Full application pipeline runs end-to-end against vendor stubs, zero network, in CI | PASS-AGAINST-STUB |
| 22 | 2 | Vendor swap: two `TenantScreening` implementations; switching is config-only, no call-site change | PASS |
| 23 | 2 | Schema scan: no SSN or government-ID column exists anywhere; no such value in any archived request payload | PASS |
| 24 | 2 | Idempotency: same Certn webhook delivered 100× → one state transition, one ledger effect | PARTIAL |
| 25 | 2 | Out-of-order: terminal event before intermediate → correct final state | PASS-AGAINST-STUB |
| 26 | 2 | Partial completion: credit complete + criminal pending → application does NOT advance to `screened` | PASS-AGAINST-STUB |
| 27 | 2 | Badge transitions: identity + income complete → `prechecked`; full package → `fully_screened` | PASS-AGAINST-STUB |
| 28 | 2 | Risk Insight gate: decline driven by Risk Insight routes to review queue, does not auto-reject, while flag is false | PASS |
| 29 | 2 | `payer_kind` exercised for all four values without pricing-logic branching at call sites | PASS |
| 30 | 2 | Cost attribution: per-application screening COGS queryable by vendor and date | PASS |
| 31 | 2 | Report portability: one report granted to three orgs in-window; fourth post-expiry triggers re-pull | PASS-AGAINST-STUB |
| 32 | 2 | Rebate: fires on `placement.funded`, not `lease_signed`; second application on same order produces no second rebate | PASS |
| 33 | 3 | Unbalanced transaction rejected by the deferred trigger | PASS |
| 34 | 3 | Application role `UPDATE`/`DELETE` on ledger tables denied | PASS |
| 35 | 3 | Tier snapshot: change price book after lead creation → lead retains original tier, version, fee; charge matches persisted fee | PASS |
| 36 | 3 | Balance draw-down: concurrent purchases cannot drive `balance_cents` negative | PASS |
| 37 | 3 | Charge/release ordering: simulated payment failure → lead data NOT released; post-charge crash → reconciler resolves orphan | PASS-AGAINST-STUB |
| 38 | 3 | License gate: never offered to expired/unverified org, asserted over randomized fixtures | PASS |
| 39 | 3 | Reconciliation: seeded Stripe fixture with injected discrepancy → break detected and alerted, not auto-resolved | PASS-AGAINST-STUB |
| 40 | 3 | Displayed fee == persisted `fee_amount_cents` == Stripe charge amount | PASS-AGAINST-STUB |
| 41 | 3 | `lead_purchase_evidence` populated at release with session, IP, ToS version, exact released payload | PASS |
| 42 | 3 | Price book cannot go effective in prod without `config.approve` dual approval — asserted | PASS |
| 43 | 3 | Trial balance and GL detail exports produce correct totals against seeded data | PASS |
| 44 | 4 | Adapter conformance suite: every adapter passes one shared suite against recorded fixtures, no live network in CI | PASS-AGAINST-STUB |
| 45 | 4 | Replay: change mapping version → re-transform historical `raw_record` → corrected output, zero partner API calls | PASS |
| 46 | 4 | Idempotency: same feed fetched 10× → one `source_listing`, correct `records_unchanged`, no listing churn events | PASS |
| 47 | 4 | Resolution: same unit from three adapters → one `unit_id`; supply metrics count once | PASS |
| 48 | 4 | Merge precedence: landlord-direct rent overrides feed rent; provenance identifies winner | PASS |
| 49 | 4 | Conflict: >10% rent disagreement writes `unit_source_conflict`, holds prior value, does not auto-resolve | PASS |
| 50 | 4 | Delist: absent from full reconcile → `absent_since` → delisted after grace → listing expires when no source remains | PASS-AGAINST-STUB |
| 51 | 4 | Quarantine: run dropping 80% of inventory quarantined and NOT applied; alert fires; override requires dual approval | PASS |
| 52 | 4 | Currency-scale guard: dollars-where-cents-expected fixture caught by median-shift gate | PASS |
| 53 | 4 | Building-level record (one row, 40 units) routes to ambiguous queue, no phantom unit | PASS |
| 54 | 4 | Push: valid HMAC accepted; stale timestamp rejected; replayed nonce rejected; malformed body → rejection log with reason | PASS |
| 55 | 4 | Credential rotation during dual-credential window: zero failed syncs | PARTIAL |
| 56 | 4 | Dry run writes zero rows to `listing`/`property`/`unit`/`address`, verified by before/after row counts | PASS |
| 57 | 4 | Display rules: source with `show_exact_address = false` and a suppressed field never leaks either through any API response | PASS |
| 58 | 4 | Credentials absent from all logs, traces, and `sync_run.error_detail` | PARTIAL |
| 59 | 4 | Org claim: ingestion-created unclaimed org can be claimed without creating a duplicate org | PASS |
| 60 | 5 | Signed URL expires ≤5 min; direct bucket access denied; every issuance logged | PASS-AGAINST-STUB |
| 61 | 5 | Purge job removes expired documents from S3, retains tombstone, ledger references intact | PASS-AGAINST-STUB |
| 62 | 5 | Zero-result searches visible in rollup by submarket, bed band, rent band | PASS |
| 63 | 5 | Admin console issues zero queries against the transactional primary except targeted single-record lookups, verified via query log | PARTIAL |
| 64 | 5 | Label coverage metric live, reporting actual 30/90-day response rates | PASS |
| 65 | 5 | Expired listing returns correct 410/301/noindex per policy, asserted per case | PASS |
| 66 | 5 | Rate limiting: unauthenticated burst throttled; `allow_indexed_crawlers` toggle respected | PARTIAL |
| 67 | 6 | Reproducibility: replaying `input_snapshot` through recorded engine + config version reproduces exact `approved_cashback_cents` | PASS |
| 68 | 6 | Equation 2 path exercised; `explanation` names the binding constraint | PASS |
| 69 | 6 | Reference case: Tier 4 deal producing the $5,000 → $4,150 adjustment reproduces exactly | PASS |
| 70 | 6 | Decline path: solved cap below minimum viable → declined, not approved at token amount | PASS |
| 71 | 6 | Disbursement gated: attempt to pay homeowner before `partner_paid` is rejected | PASS-AGAINST-STUB |
| 72 | 6 | Remittance variance writes a reconciliation break, not a silent absorption | PASS |
| 73 | 6 | Solar and dwel share one `party`, one ledger, one document store, one audit log — verified by schema inspection, zero duplicated tables | PASS |
| 74 | 7 | Leakage test: poisoned fixture fails the pipeline | PASS |
| 75 | 7 | Offline/online parity: identical features via both paths across 1,000 fixtures | PASS |
| 76 | 7 | 30-day shadow run with distribution comparison against v0 before activation | PARTIAL |
| 77 | 7 | Any historical score recomputable from its `feature_snapshot` and `model_version` | PASS |

**Total: 77**

## Status sums

| Status | Count |
|---|---|
| FAIL | 1 |
| PARTIAL | 9 |
| PASS | 51 |
| PASS-AGAINST-STUB | 16 |
| **TOTAL** | **77** |

## Reconciliation notes

- Spec §17 has **77** checkbox acceptance criteria (8+12+12+11+16+7+7+4).
- Original audit Part 3 listed all 77 rows, but its Status tally (38/22/12/1/0=73) was **wrong arithmetic** vs its own tables (actual Part 3 sum was PASS 50 + PASS-AGAINST-STUB 16 + PARTIAL 10 + FAIL 1 = 77).
- Remediation REPORT incorrectly **added** 8 BLOCKED-BY-§18 rows. Those are §18 decisions (D-01…D-16 inventory), **not** §17 acceptance criteria. They must not inflate the §17 total.
- After R-1: Phase 0 RLS criterion PARTIAL→PASS (lead/lead_offer policies).
- Canonical total going forward: **77**. BLOCKED-BY-§18 count in §17 table: **0** (track §18 separately).
