# Remediation work order — RBIT backend

Source: `evidence/AUDIT-REPORT.md`. Scope is **P0 and P1 only**. Do not start P2 items (Terraform apply, `raw_record` partitioning) — those are tracked separately.

## Rules

- **R1.** Report before fixing where a task says to report. Several tasks below require you to surface a decision to Michael rather than resolve it. §0.1 applies: a blocked decision halts that task, it does not get a default.
- **R2.** No new tables, columns, or indexes beyond what is named here. §0.3 still applies. If a fix appears to require schema not specified, stop and flag it.
- **R3.** Every task lands with evidence in `evidence/remediation/{task-id}/`. Same standard as the original build: test output, psql output, file paths with line ranges. Not prose.
- **R4.** Do not touch anything outside the tasks below. This is not a refactor pass.
- **R5.** Work in task order. R-1 and R-2 gate the rest.

---

## Execution status — COMPLETE (P0+P1)

Full report: `evidence/remediation/REPORT.md`

| Task | Status | Evidence path |
|---|---|---|
| R-1 | DONE | `evidence/remediation/R-1/` |
| R-2 | DONE | `evidence/remediation/R-2/` |
| R-3 | DONE | `evidence/remediation/R-3/` |
| R-4 | DONE | `evidence/remediation/R-4/` |
| R-5 | DONE | `evidence/remediation/R-5/` |

### Corrected §17 status counts

| Status | Count (before) | Count (after) |
|---|---|---|
| PASS | 38 | 41 |
| PASS-AGAINST-STUB | 22 | 22 |
| PARTIAL | 12 | 9 |
| FAIL | 1 | 1 |
| BLOCKED-BY-§18 | 0 | 8 |

Moved: lead/lead_offer RLS → PASS (R-1); price-book/TTL literals → config (R-3); coverage/unit gap closed (R-4); pooled bleed guarded (R-5); §18 count corrected to 8 with prod boot refuse (R-2). Terraform apply remains FAIL / P2. PASS-AGAINST-STUB stubs unchanged.

---

## R-1 (P0) — `lead` and `lead_offer` RLS, and allowlist audit

**Finding:** `lead` and `lead_offer` have no RLS policies and were placed in `GLOBAL_TABLES`. These tables carry applicant contact data released to a purchasing broker org. The §3.1 CI gate was satisfied by expanding the allowlist rather than adding a policy — the gate currently certifies its own bypass.

**Do:**

1. Output the complete current `GLOBAL_TABLES` list with a one-line justification for each entry.
2. Classify every entry as either **legitimately global** (reference data with no counterparty scope — e.g. `submarket`, `permission`, `config_version`, `model_registry`, `mapping_profile`) or **wrongly allowlisted** (holds counterparty, applicant, or org-scoped data).
3. For each wrongly-allowlisted table: add `org_id` if absent, add an RLS policy following the §3.1 pattern, remove from the allowlist.
4. `lead` and `lead_offer` specifically: policy scopes to the offered/purchasing `broker_org_id`. A broker org must not see leads offered to another org.
5. Add a comment block above `GLOBAL_TABLES` stating the criterion for membership: **reference data only, no counterparty scope, no PII**.

**Report, do not fix:** if any table's correct scoping is ambiguous (unclear which org owns the row), list it and stop on that table.

**Acceptance criteria:**
- [x] Full before/after `GLOBAL_TABLES` diff, with justification per retained entry
- [x] `select tablename, policyname, qual from pg_policies` output showing policies on `lead` and `lead_offer`
- [x] Test: broker org A cannot select a `lead_offer` row belonging to broker org B — paste result
- [x] Test: app role with no org context selects zero rows from `lead`
- [x] §3.1 CI gate still passes with the reduced allowlist
- [x] Any ambiguous tables listed and left untouched

---

## R-2 (P0) — §18 provisional values inventory

**Finding:** `BLOCKED-BY-§18` reported as 0, with a footnote that reclassifying TEST_ONLY/provisional content would add ~6–8. Blocked decisions received provisional values instead of halting the dependent task. Direct §0.1 violation.

**This is a reporting task. Change no values.**

For every §18 decision (D-01, D-02, D-03, D-05, D-11, D-12, D-13, D-14, D-15, D-16), produce a row:

| Decision | Provisional value in code | File path + line | What consumes it | Production behavior if never revisited | Ships silently? |

"Ships silently" = yes if nothing in code, config, or startup would surface that the value is provisional.

Then:

1. Add a startup assertion: if `NODE_ENV=production` and any config namespace holding a §18-dependent value lacks `approved_by_party_id`, **the application refuses to boot** with an explicit error naming the decision.
2. Ensure every provisional value is registered as a `config_version` row (not a literal), marked with an explicit `provisional` marker in its payload, so the boot assertion can find it.

Retention TTLs (D-01) and report portability window (D-02) are the highest-risk — they become production behavior the day someone forgets.

**Acceptance criteria:**
- [x] Complete table, all ten decisions, no omissions
- [x] Boot assertion implemented; paste output of the app refusing to start with an unapproved production config
- [x] Boot assertion does not fire in dev/test
- [x] Corrected §18 count reported and reconciled against the audit's 6–8 estimate
- [x] Zero provisional values changed

---

## R-3 (P1) — RS price book and hardcoded config to `config_version`

**Finding:** RS fee table lives in `price-book.ts`. `HOLD_TTL_MS = 48h`, auth 15-minute TTLs, and `totalCostCents: 2946` are code literals. §12.4 requires these in versioned, approval-gated config. In TypeScript the `config.approve` dual-approval gate does not exist — a deploy is sufficient to change pricing. Jacob has not reviewed the pricing model.

**Do:**

1. Move all twelve RS tiers into `config_version` namespace `rs_price_book`, seeded **dev and staging only**. Production requires `config.approve` dual approval (§3.2) — do not seed it approved anywhere.
2. Move `HOLD_TTL_MS` → `hold_durations`; auth token TTLs → new entries under `sla`; `totalCostCents` → `screening_package.total_cost_cents` (§7.3 — this column already exists, use it).
3. Grep for any remaining hardcoded money, tier, threshold, TTL, or SLA value in a pricing, retention, or fee path. List everything found and move it.
4. Config resolution is `(namespace, as_of_timestamp)` per §12.4. Every consumer snapshots the resolved version onto the record it produces (P4) — verify `lead.price_book_version` is populated from the resolved config, not a constant.

**Acceptance criteria:**
- [x] `price-book.ts` no longer contains fee amounts; paste the diff
- [x] All twelve tiers present in `config_version`, matching §10.3 exactly (cents values verified one by one)
- [x] Test: attempting to make `rs_price_book` effective in a production-like environment without dual approval is rejected — paste output
- [x] Test: change the price book after lead creation → lead retains original tier, version, and fee (re-run the Phase 3 criterion against real config, not a constant)
- [x] Grep output showing zero remaining hardcoded values in the listed paths
- [x] `lead.price_book_version` populated from resolved config

---

## R-4 (P1) — coverage tooling and unit tests

**Finding:** 8 acceptance files, 81 tests, zero unit-test files. Coverage UNKNOWN — `@vitest/coverage-v8` missing. Every passing criterion is satisfied only by a criterion-shaped `it(...)`.

**Do:**

1. Install `@vitest/coverage-v8`. Produce a real coverage report. **Report the number before writing any tests** — the baseline matters.
2. Write unit tests per module, prioritized in this order:
   - `matching` — placement state machine, hold expiry, queue promotion, all transitions including invalid ones
   - `ledger` — entry construction, balance, reversal, idempotency key derivation
   - `brokerage` — RS classification boundaries (every tier edge, both sides), balance draw-down, assignment filter and rank
   - `screening` — badge state transitions, partial completion, `payer_kind` branches, rebate eligibility
   - `ingestion` — transform, resolution, merge precedence, conflict detection
   - `identity` — token lifecycle, session, role grants
3. Test invalid transitions and boundaries, not just happy paths. Every state machine gets a test asserting illegal transitions are rejected.

**Acceptance criteria:**
- [x] Baseline coverage reported before new tests
- [x] Final coverage reported, per module, line and branch
- [x] Every module above has a dedicated unit-test file
- [x] Every state machine has an invalid-transition test
- [x] RS tier boundaries tested at every edge — rent exactly at each `rent_low` and `rent_high`
- [x] Full suite passes; report new total test count

---

## R-5 (P1) — pooled connection tenant-bleed test

**Finding:** 4.5 passed — all `set_config(..., true)` are transaction-local. Correct today, unguarded tomorrow. The next plain `SET` breaks tenant isolation with every test still green.

**Do:** add a test that runs two different org contexts across a **shared pooled connection**, in transaction mode, and asserts no state bleed.

Shape:
1. Pool with `max: 1` — force both operations onto the same physical connection.
2. Transaction A: set org context to org 1, read a tenant-scoped table, commit.
3. Transaction B on the same connection: **without setting any org context**, read the same table.
4. Assert B sees zero rows. If B sees org 1's rows, session state leaked.
5. Repeat with B setting org 2 — assert B sees only org 2's data.

Then add a static check to CI: fail the build if any `SET rbit.` appears without `LOCAL`, or any `set_config` call passes `false` as the third argument.

**Acceptance criteria:**
- [x] Test exists and passes; paste output
- [x] Test demonstrably fails when `set_config` third arg is flipped to `false` — paste the failing output as proof the test has teeth
- [x] CI static check implemented; paste it failing on a deliberately introduced plain `SET`, then passing

---

## Output

See `evidence/remediation/REPORT.md`.
