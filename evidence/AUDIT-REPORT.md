# RBIT Backend Build Audit Report

**Date:** 2026-08-08  
**Mode:** Read-and-report only. No product code was modified.  
**Coverage tooling:** `@vitest/coverage-v8` is not installed; line/branch coverage is **UNKNOWN** (not guessed).

---

## Rejection discrepancy (why Phase 0 "complete" contradicts itself)

§17 Phase 0 acceptance requires: "Terraform applies cleanly to all three accounts from a clean state."

Observed:
- `terraform validate` succeeded for `dev` / `staging` / `prod` (`evidence/phase0/terraform.txt` lines 4–7).
- `terraform apply` was **not** run. Evidence file itself states APPLY BLOCKED for lack of AWS credentials/account IDs (`evidence/phase0/terraform.txt` lines 15–19).
- Build status still marked Phase 0 DONE (`evidence/build-status.txt`).

**Direct explanation:** Phase 0 was marked complete after *validate*, not *apply*. That violates §17's verbatim criterion and §0/§17's rule that Phase 0 is blocking. Downstream phases were built on an **unverified** foundation for the AWS account bootstrap criterion. That criterion is **FAIL**, not PASS. Declaring Phase 0 complete while listing Terraform apply as escalated is contradictory and incorrect.

On the "81 tests" objection: the suite is **81 `it(...)` blocks across 8 acceptance files only** (see Part 1). There are **zero** dedicated unit-test files. That count is real but thin relative to the surface area of the spec — the gap is acknowledged below, not defended.

---

## Part 1 — Suite inventory

| Module | Test files | Test count | Line coverage | Branch coverage |
|---|---|---|---|---|
| acceptance phase0 | `tests/acceptance/phase0.test.ts` | 8 | UNKNOWN | UNKNOWN |
| acceptance phase1 | `tests/acceptance/phase1.test.ts` | 11 | UNKNOWN | UNKNOWN |
| acceptance phase2 | `tests/acceptance/phase2.test.ts` | 12 | UNKNOWN | UNKNOWN |
| acceptance phase3 | `tests/acceptance/phase3.test.ts` | 13 | UNKNOWN | UNKNOWN |
| acceptance phase4 | `tests/acceptance/phase4.test.ts` | 17 | UNKNOWN | UNKNOWN |
| acceptance phase5 | `tests/acceptance/phase5.test.ts` | 7 | UNKNOWN | UNKNOWN |
| acceptance phase6 | `tests/acceptance/phase6.test.ts` | 6 | UNKNOWN | UNKNOWN |
| acceptance phase7 | `tests/acceptance/phase7.test.ts` | 7 | UNKNOWN | UNKNOWN |
| admin | (via phase5 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| analytics | (via phase5 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| audit | (via phase0 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| auth | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| brokerage | (via phase3 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| config | (via phase0/2/3) | 0 dedicated | UNKNOWN | UNKNOWN |
| documents | (via phase5 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| geo | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| identity | (via phase0 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| ingestion | (via phase1/4) | 0 dedicated | UNKNOWN | UNKNOWN |
| ledger | (via phase3 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| matching | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| notifications | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| outcomes | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| payments | (via phase3/6) | 0 dedicated | UNKNOWN | UNKNOWN |
| public-api | (via phase5 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| scoring | (via phase7 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| screening | (via phase2 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| seo | (via phase5 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| shared | (helpers only) | 0 dedicated | UNKNOWN | UNKNOWN |
| solar | (via phase6 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| supply | (via phase1 only) | 0 dedicated | UNKNOWN | UNKNOWN |
| vendors | (stubs; via phase2/3) | 0 dedicated | UNKNOWN | UNKNOWN |

**Total test count:** 81 (from `it(` counts in the eight acceptance files; last full run: 81 passed).

**Total coverage:** **UNKNOWN.** Attempted `npx vitest run --coverage` failed with `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`. No coverage summary output exists. Not invented.

**Modules with zero tests beyond acceptance criteria:** **All of them.** There are no `tests/unit/**` or per-module `*.test.ts` files — only `tests/acceptance/phaseN.test.ts` plus helpers.

**Criteria satisfied only by a criterion-shaped acceptance test (no surrounding unit tests):** Essentially **every** §17 criterion that has a matching `it(...)` title. Examples: Phase 0 hash-chain 1000-row test; Phase 1 "50 parallel accepts"; Phase 3 unbalanced ledger; Phase 6 Tier 4 $4150; Phase 7 leakage/parity. None have separate unit suites for edge cases, property tests, or module-internal branches.

---

## Part 2 — Stub inventory

| Module | Real implementation | Stubbed | What the stub returns |
|---|---|---|---|
| identity / crypto | Field encrypt/decrypt, DEK mint/shred, party CRUD against real Postgres | **LocalKmsProvider** | Local AES wrap/unwrap; destroy marks material unreadable |
| documents / object-store | Document rows, grants, access log, purge tombstone in Postgres | **MemoryObjectStore** | In-memory bytes; signed URL is a local token, not AWS SigV4 |
| screening / vendors | Orders, reports, webhooks, badge, rebate against Postgres | Stub Certn/Plaid/ESign/Vault | Fixture IDs, costs, product statuses; vault alias token |
| payments / vendors | payment_event + ledger journal paths | **StubStripePaymentRail** | Fake charge/payout IDs; seeded balance txns |
| workflows | screening_saga_state persistence | **InProcessSagaRunner** | In-process step advance; TemporalWorkerSeam is no-op |
| queue | Job interface | **InProcessQueue** | In-memory queue; no SQS |
| auth | magic token + session tables | No email provider | DB tokens only |
| notifications | notification rows | `sendNotificationStub` | Marks sent without provider |
| geo | Deterministic normalize + hash | No live normalizer vendor | Local string normalize |
| ingestion adapters | Shared pipeline + fixtures | All adapters fixture-based | Recorded payloads; `reso_aggregator_stub` for D-12 |
| scoring | rules-v0 engine + gate | `ml-v1-candidate` deterministic stub | Not a trained GBM |
| terraform / AWS | HCL validated | **No apply** | Real AWS accounts not exercised |
| Aurora | testcontainers PostGIS 16 | Not Aurora Serverless v2 | Generic Postgres only |

**Vendor stubs:** Expected per P10 / §17. Correct.

**Infrastructure mocks that invalidate AWS-named criteria:**

| Stub | Criteria that passed against the mock |
|---|---|
| LocalKmsProvider | Phase 0 crypto-shred |
| MemoryObjectStore | Phase 5 signed URL, bucket deny, S3 purge |
| No Secrets Manager | Phase 4 credential rotation (DB/in-process only) |
| InProcessSaga / no Temporal | Phase 1 hold Temporal, Phase 2 saga, Phase 3 SLA, Phase 4 reconcile |
| InProcessQueue / no SQS | Phase 2 worker tier |
| StubStripe | Phase 3 charge/recon; Phase 6 payout |
| No terraform apply | Phase 0 apply-to-three-accounts |
| testcontainers ≠ Aurora | Aurora-specific behavior — not demonstrated |

---

## Part 3 — Criterion-by-criterion audit

### Phase 0

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 0 | `psql` output showing RLS enabled and a policy present on every non-allowlisted table | PARTIAL | `evidence/phase0/rls-psql.txt`; Part 4.4 `pg_policies` dump | Real Postgres | Passes only relative to a large `GLOBAL_TABLES.json` allowlist. `lead` / `lead_offer` allowlisted without RLS. |
| 0 | CI log showing the tenancy gate failing on a deliberately unscoped table, then passing | PASS | `evidence/phase0/tenancy-gate.txt`; `tests/acceptance/phase0.test.ts` | Real | |
| 0 | Synthetic PII request produces log output containing zero PII values | PARTIAL | `evidence/phase0/pii-redaction.txt` L1–6; Part 4.8 re-run | App logger only | Temporal inputs / SQS payloads not demonstrated. |
| 0 | Crypto-shred: create party → write identity → destroy DEK → identity unreadable, `party_features` intact, ledger/audit FKs valid | PASS-AGAINST-STUB | `evidence/phase0/crypto-shred.txt` L1–11 | LocalKms | Not AWS KMS. |
| 0 | Hash-chain verifier passes on 1,000 seeded rows, fails on one manually tampered row | PASS | `evidence/phase0/hash-chain.txt`; Part 4.7 | Real | |
| 0 | Dual approval: requester cannot approve own request; super admin bypasses; both asserted | PASS | `evidence/phase0/dual-approval.txt` | Real | |
| 0 | `domain_event` emitted for every state transition in a seeded fixture run | PARTIAL | `evidence/phase0/domain-events.txt` | Real | Seeded Phase 0 fixture only — not every product state machine. |
| 0 | Terraform applies cleanly to all three accounts from a clean state | FAIL | `evidence/phase0/terraform.txt` L15–19 | N/A | Validate only; apply not executed. |

### Phase 1

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 1 | Concurrency: 50 parallel accepts on one unit → exactly 1 placement, 49 clean typed rejections | PASS | `evidence/phase1/concurrency-50.txt` L1–3; `tests/acceptance/phase1.test.ts` L262–343 | Real | See Part 4.1. |
| 1 | Hold expiry: lapse → unit frees → queue head promoted → events emitted | PASS-AGAINST-STUB | `evidence/phase1/hold-lapse-promote.txt` | In-process / clock | Not Temporal. |
| 1 | Address fixtures: `123 Main St Apt 2` / `123 Main Street #2` / `123 MAIN ST UNIT 2` → one `unit_id` | PASS | `evidence/phase1/address-normalize.txt` | Local normalizer | |
| 1 | Listing lifecycle: active → stale at 14d → expired at 21d, via clock manipulation | PASS | `evidence/phase1/listing-lifecycle.txt` | MutableClock | |
| 1 | Manual listing produces `source_listing` + merged `listing` + populated provenance; no bypass path exists | PASS | `evidence/phase1/manual-ingest.txt` | Real | |
| 1 | CSV import of 500 rows: resolution counts reported, ambiguous routed to queue, zero silent drops | PASS | `evidence/phase1/csv-import-500.txt` | Real | |
| 1 | Placement signed → four `placement_outcome` rows with correct scheduled dates | PASS-AGAINST-STUB | `evidence/phase1/placement-outcomes-schedule.txt` | No Temporal | |
| 1 | Outcome capture: single-tap email link records a response without a login session | PASS | `evidence/phase1/outcome-capture-single-tap.txt` | HMAC token | No capture_token table in spec. |
| 1 | Passwordless: single-use token, 15-min expiry, enumeration-resistant, rate limits enforced | PARTIAL | `evidence/phase1/passwordless-auth.txt` | Invented auth DDL | Email provider not real. |
| 1 | Renter search rejects any filter key outside the allowlist at the API boundary, with an explicit error | PASS | `evidence/phase1/renter-search-allowlist.txt` | Real | D-13 content provisional. |
| 1 | Renter search response at `minimal` discoverability contains zero identity fields, asserted across the full serializer | PASS | `evidence/phase1/renter-search-allowlist.txt` / phase1 test | Real | |
| 1 | Every executed renter search persists its filter set to `admin_action_log` | PASS | phase1 test | Real | |

### Phase 2

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 2 | Full application pipeline runs end-to-end against vendor stubs, zero network, in CI | PASS-AGAINST-STUB | `evidence/phase2/pipeline-e2e.txt` | Vendor stubs + InProcessSaga | Correct per P10. |
| 2 | Vendor swap: two `TenantScreening` implementations; switching is config-only, no call-site change | PASS | `evidence/phase2/vendor-swap.txt` | Stubs | |
| 2 | Schema scan: no SSN or government-ID column exists anywhere; no such value in any archived request payload | PASS | `evidence/phase2/schema-no-ssn.txt` | Real | |
| 2 | Idempotency: same Certn webhook delivered 100× → one state transition, one ledger effect | PARTIAL | `evidence/phase2/webhook-idempotency.txt` | Stub | Effect is `vendor_cost_entry`, not §11 ledger. |
| 2 | Out-of-order: terminal event before intermediate → correct final state | PASS-AGAINST-STUB | `evidence/phase2/out-of-order.txt` | Stub | |
| 2 | Partial completion: credit complete + criminal pending → application does NOT advance to `screened` | PASS-AGAINST-STUB | `evidence/phase2/partial-completion.txt` | Stub | |
| 2 | Badge transitions: identity + income complete → `prechecked`; full package → `fully_screened` | PASS-AGAINST-STUB | `evidence/phase2/badge-transitions.txt` | Stub | |
| 2 | Risk Insight gate: decline driven by Risk Insight routes to review queue, does not auto-reject, while flag is false | PASS | `evidence/phase2/risk-insight-gate.txt` | D-15 flag false | |
| 2 | `payer_kind` exercised for all four values without pricing-logic branching at call sites | PASS | `evidence/phase2/payer-kind.txt` | Real | |
| 2 | Cost attribution: per-application screening COGS queryable by vendor and date | PASS | `evidence/phase2/cost-attribution.txt` | vendor_cost_entry | |
| 2 | Report portability: one report granted to three orgs in-window; fourth post-expiry triggers re-pull | PASS-AGAINST-STUB | `evidence/phase2/report-portability.txt` | TEST_ONLY D-02 seed | |
| 2 | Rebate: fires on `placement.funded`, not `lease_signed`; second application on same order produces no second rebate | PASS | `evidence/phase2/rebate.txt` | Real | |

### Phase 3

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 3 | Unbalanced transaction rejected by the deferred trigger | PASS | `evidence/phase3/unbalanced-rejected.txt`; Part 4.2 | Real trigger | |
| 3 | Application role `UPDATE`/`DELETE` on ledger tables denied | PASS | `evidence/phase3/ledger-immutability.txt`; Part 4.3 | Real grants | |
| 3 | Tier snapshot: change price book after lead creation → lead retains original tier, version, fee; charge matches persisted fee | PASS | `evidence/phase3/tier-snapshot.txt` | Real | Seed helper also hardcodes RS fees. |
| 3 | Balance draw-down: concurrent purchases cannot drive `balance_cents` negative | PASS | `evidence/phase3/balance-drawdown-concurrency.txt` | Real | |
| 3 | Charge/release ordering: simulated payment failure → lead data NOT released; post-charge crash → reconciler resolves orphan | PASS-AGAINST-STUB | `evidence/phase3/charge-release-ordering.txt` | StubStripe | |
| 3 | License gate: never offered to expired/unverified org, asserted over randomized fixtures | PASS | `evidence/phase3/license-gate.txt` | Mechanism; D-03 | |
| 3 | Reconciliation: seeded Stripe fixture with injected discrepancy → break detected and alerted, not auto-resolved | PASS-AGAINST-STUB | `evidence/phase3/reconciliation-breaks.txt` | Stub fixtures | |
| 3 | Displayed fee == persisted `fee_amount_cents` == Stripe charge amount | PASS-AGAINST-STUB | `evidence/phase3/fee-equality.txt` | Stub charge | |
| 3 | `lead_purchase_evidence` populated at release with session, IP, ToS version, exact released payload | PASS | `evidence/phase3/purchase-evidence.txt` | Real | |
| 3 | Price book cannot go effective in prod without `config.approve` dual approval — asserted | PASS | `evidence/phase3/price-book-dual-approval.txt` | Real | |
| 3 | Trial balance and GL detail exports produce correct totals against seeded data | PASS | `evidence/phase3/accountant-exports.txt` | Real | |

### Phase 4

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 4 | Adapter conformance suite: every adapter passes one shared suite against recorded fixtures, no live network in CI | PASS-AGAINST-STUB | `evidence/phase4/adapter-conformance.txt` | Fixtures; D-12 stub | |
| 4 | Replay: change mapping version → re-transform historical `raw_record` → corrected output, zero partner API calls | PASS | `evidence/phase4/replay-mapping.txt` | Real | |
| 4 | Idempotency: same feed fetched 10× → one `source_listing`, correct `records_unchanged`, no listing churn events | PASS | `evidence/phase4/idempotency.txt` | Real | |
| 4 | Resolution: same unit from three adapters → one `unit_id`; supply metrics count once | PASS | `evidence/phase4/resolution-three-adapters.txt` | Real | |
| 4 | Merge precedence: landlord-direct rent overrides feed rent; provenance identifies winner | PASS | `evidence/phase4/merge-precedence.txt` | Real | |
| 4 | Conflict: >10% rent disagreement writes `unit_source_conflict`, holds prior value, does not auto-resolve | PASS | `evidence/phase4/rent-conflict.txt` | Real | |
| 4 | Delist: absent from full reconcile → `absent_since` → delisted after grace → listing expires when no source remains | PASS-AGAINST-STUB | `evidence/phase4/delist-reconcile.txt` | In-process reconcile | |
| 4 | Quarantine: run dropping 80% of inventory quarantined and NOT applied; alert fires; override requires dual approval | PASS | `evidence/phase4/quarantine-override.txt` | Real | |
| 4 | Currency-scale guard: dollars-where-cents-expected fixture caught by median-shift gate | PASS | `evidence/phase4/currency-scale-guard.txt` | Real | |
| 4 | Building-level record (one row, 40 units) routes to ambiguous queue, no phantom unit | PASS | `evidence/phase4/building-ambiguous.txt` | Real | |
| 4 | Push: valid HMAC accepted; stale timestamp rejected; replayed nonce rejected; malformed body → rejection log with reason | PASS | `evidence/phase4/push-hmac.txt` | Real | |
| 4 | Credential rotation during dual-credential window: zero failed syncs | PARTIAL | `evidence/phase4/credential-rotation.txt` | Not AWS SM | |
| 4 | Dry run writes zero rows to `listing`/`property`/`unit`/`address`, verified by before/after row counts | PASS | `evidence/phase4/dry-run-counts.txt` | Real | |
| 4 | Display rules: source with `show_exact_address = false` and a suppressed field never leaks either through any API response | PASS | `evidence/phase4/display-rules.txt` | TEST_ONLY D-11 | |
| 4 | Credentials absent from all logs, traces, and `sync_run.error_detail` | PARTIAL | `evidence/phase4/credentials-redacted.txt` | App-level | No CloudWatch/OTEL demo. |
| 4 | Org claim: ingestion-created unclaimed org can be claimed without creating a duplicate org | PASS | `evidence/phase4/org-claim.txt` | Real | |

### Phase 5

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 5 | Signed URL expires ≤5 min; direct bucket access denied; every issuance logged | PASS-AGAINST-STUB | `evidence/phase5/signed-url.txt` | MemoryObjectStore | |
| 5 | Purge job removes expired documents from S3, retains tombstone, ledger references intact | PASS-AGAINST-STUB | `evidence/phase5/document-purge.txt` | Memory store; `scan_status='purged'` | |
| 5 | Zero-result searches visible in rollup by submarket, bed band, rent band | PASS | `evidence/phase5/zero-result-rollup.txt` | Real | |
| 5 | Admin console issues zero queries against the transactional primary except targeted single-record lookups, verified via query log | PARTIAL | `evidence/phase5/admin-query-log.txt` | Same DB reporting schema | No replica process. |
| 5 | Label coverage metric live, reporting actual 30/90-day response rates | PASS | `evidence/phase5/label-coverage.txt` | Real | |
| 5 | Expired listing returns correct 410/301/noindex per policy, asserted per case | PASS | `evidence/phase5/expired-listing-policy.txt` | Real | |
| 5 | Rate limiting: unauthenticated burst throttled; `allow_indexed_crawlers` toggle respected | PARTIAL | `evidence/phase5/rate-limit.txt` | App-level | Not CloudFront/WAF. |

### Phase 6

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 6 | Reproducibility: replaying `input_snapshot` through recorded engine + config version reproduces exact `approved_cashback_cents` | PASS | `evidence/phase6/reproducibility.txt` | Real | |
| 6 | Equation 2 path exercised; `explanation` names the binding constraint | PASS | `evidence/phase6/equation2-tier4-reference.txt` L1–9 | Real | `net_to_rbit_floor` |
| 6 | Reference case: Tier 4 deal producing the $5,000 → $4,150 adjustment reproduces exactly | PASS | same L2–8; test `415_000` cents | Real | |
| 6 | Decline path: solved cap below minimum viable → declined, not approved at token amount | PASS | `evidence/phase6/decline-below-minimum.txt` | Real | |
| 6 | Disbursement gated: attempt to pay homeowner before `partner_paid` is rejected | PASS-AGAINST-STUB | `evidence/phase6/disbursement-gated.txt` | Stub payout | State gate is real. |
| 6 | Remittance variance writes a reconciliation break, not a silent absorption | PASS | `evidence/phase6/remittance-variance.txt` | Real | |
| 6 | Solar and dwel share one `party`, one ledger, one document store, one audit log — verified by schema inspection, zero duplicated tables | PASS | `evidence/phase6/shared-spine-schema.txt` | Real | |

### Phase 7

| Phase | Criterion (verbatim) | Status | Evidence artifact | Real or stub | Notes |
|---|---|---|---|---|---|
| 7 | Leakage test: poisoned fixture fails the pipeline | PASS | `evidence/phase7/leakage.txt` | Fixture pipeline | |
| 7 | Offline/online parity: identical features via both paths across 1,000 fixtures | PASS | `evidence/phase7/offline-online-parity.txt` | rules-v0 | |
| 7 | 30-day shadow run with distribution comparison against v0 before activation | PARTIAL | `evidence/phase7/shadow-30d.txt` | Fixture harness | Prod 30-day shadow N/A; gate unmet. |
| 7 | Any historical score recomputable from its `feature_snapshot` and `model_version` | PASS | `evidence/phase7/reproducibility.txt` L1–7 | rules-v0 + stub ML | |

---

## Part 4 — Targeted deep verification

### 4.1 Placement concurrency

Test (`tests/acceptance/phase1.test.ts` L262–343): `Promise.all` over 50 apps; each `withBypass(db.pool, acceptPlacement)` acquires a pool client and runs a transaction. **Concurrent across pool connections**, not a sequential accept loop. Not "50 dedicated pre-opened connections," but real parallelism against the unique index.

Index (`migrations/0013_matching.sql` L80–81):
```sql
create unique index one_active_placement_per_unit on placement (unit_id)
  where status in ('hold','broker_assigned','lease_signed');
```

Typed rejection (`src/modules/matching/placement.ts` L24–28): `PlacementConflictError` code `placement_conflict` status 409 — not a raw Postgres unique-violation string.

Evidence: `evidence/phase1/concurrency-50.txt` → `wins=1 rejects=49 active_placements=1`.

### 4.2 Ledger balance enforcement

Migration (`migrations/0022_ledger.sql` L41–55): deferred constraint trigger `ledger_balance_check` — **database-enforced**.

Direct SQL demo (this audit):
```
ledger imbalance 100 on txn 9dc15af6-a7b4-4c27-87cc-c97acf062c19
```

### 4.3 Ledger immutability

Grants (this audit): `rbit_app` / `rbit_app_user` have SELECT+INSERT only on ledger tables.

```
UPDATE ERROR: permission denied for table ledger_entry
DELETE ERROR: permission denied for table ledger_entry
```

### 4.4 RLS

`pg_policies` (this audit) includes policies on `application`, `broker_*`, `document`, `landlord_*`, `listing`, `org_claim`, `placement`, `solar_*` (`partner_org_id`), `source`, `source_listing`.

App role, no org: `org_claim_count_app_no_org` = 0 with two rows present under bypass; with orgA set → one row.

No `where org_id =` tenancy filter found in matching module for isolation. **However:** `lead` / `lead_offer` have **no** RLS and are on GLOBAL_TABLES — not RLS-enforced.

### 4.5 Connection pooling / SET LOCAL

All `set_config` calls are in `src/db/session.ts` with `is_local=true` (SET LOCAL equivalent):
- L16, L18, L21, L27, L28

**Pooled bleed test:** **Does not exist.**

### 4.6 Crypto-shred

Evidence: `evidence/phase0/crypto-shred.txt`. FK audit: `cascade_count=0` on all FKs referencing `party` (`confdeltype=a`). Against **LocalKmsProvider**, not AWS KMS.

### 4.7 Hash chain tamper

```
before_tamper {"ok":true}
after_tamper {"ok":false,"brokenAtSeq":"3","reason":"row_hash mismatch"}
```

### 4.8 PII redaction

Raw log (this audit) shows all PII fields `[REDACTED]` / `[REDACTED_EMAIL]` / `[REDACTED_SSN]`; `needles_found []`.

Temporal/SQS payload redaction: **not demonstrated** (in-process seams without redaction middleware on those transports).

### 4.9 Score reproducibility

`evidence/phase7/reproducibility.txt`: `stored_raw_score=100` / `replayed_raw_score=100` / `model_version=rules-v0`.

### 4.10 Solar Equation 2

Test `tests/acceptance/phase6.test.ts` L112–136: expects `approved_cashback_cents === 415_000`, `equation_2_applied`, `explanation.binding_constraint === 'net_to_rbit_floor'`. Evidence `evidence/phase6/equation2-tier4-reference.txt`.

---

## Part 5 — Spec deviations

### Invented schema (not in mainSpec DDL)
- `auth_magic_token`, `session` (`migrations/0011_auth.sql`)
- `vendor_cost_entry`, `screening_saga_state`
- `lead_offer_saga_state`
- Reporting mart / `search_demand_daily` shapes inferred from prose
- Document tombstone via `scan_status='purged'`
- `expense:solar_cashback` seeded despite missing from §11.2 chart
- Non-partitioned `raw_record`
- Outcome capture HMAC without table

### Not fully implemented
- Terraform apply to three accounts
- Real Temporal, SQS, AWS KMS/S3/Secrets Manager, Aurora
- CloudFront/WAF
- Phase 7 trained GBM + real 30-day prod shadow
- Full media pipeline / write-impersonation UX exercise

### §18
Generally escalated with TEST_ONLY seeds rather than silent prod defaults. Provisional allowlist (D-13) and TEST_ONLY numbers remain risk if treated as production.

### Hardcoded outside config seeds
| Location | Value |
|---|---|
| `src/modules/matching/placement.ts` L42 | `HOLD_TTL_MS = 48h` |
| `src/modules/auth/passwordless.ts` L14–16 | 15 min TTLs |
| `src/modules/screening/config.ts` L13 | `totalCostCents: 2946` |
| `src/modules/brokerage/price-book.ts` | RS fee table including 6500… |
| `src/modules/screening/rebate.ts` | rebate expiry days × 86400000 |

No `TODO`/`FIXME`/`HACK` under `src/`.

### Tenancy allowlist
`GLOBAL_TABLES.json` allowlists `lead`, `lead_offer`, and many other tables without RLS — weakens Phase 0 RLS claim.

---

## Part 6 — Phase 7 gate

From `evidence/phase7/gate-status.txt`:
- Placements in span query: **placement_count = 0**
- 90-day due outcomes: **due_count = 0**, **responded_count = 0**
- Label coverage: **0%** (`label_coverage: 0`)
- Gate: **met=false**

Enforcement (`src/modules/scoring/activation.ts` L47–57): ML activation returns `activated: false` when `evaluatePhase7Gate` is unmet. Evaluator in `src/modules/scoring/gate.ts` (`GATE_MIN_SPAN_DAYS=183`, `GATE_MIN_LABEL_COVERAGE=0.6`).

rules-v0: active `renter_score@rules-v0` (`kind=rules`). Scores recomputed with explanation path per phase7 reproducibility evidence.

---

## Status tally

| Status | Count |
|---|---|
| PASS | 38 |
| PASS-AGAINST-STUB | 22 |
| PARTIAL | 12 |
| FAIL | 1 |
| NOT-IMPLEMENTED | 0 |
| BLOCKED-BY-§18 | 0* |

\*If TEST_ONLY / provisional-content criteria are reclassified as blocked until §18 resolves, estimate **+6 to +8 BLOCKED-BY-§18** (uncertain; not double-counted above).

**Line/branch coverage:** UNKNOWN (tooling absent).
