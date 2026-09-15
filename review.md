# Build audit request — RBIT backend

Your completion report is **not accepted**. Do not write new code, do not fix anything, and do not refactor until this audit is returned and reviewed.

This is a read-and-report task. If you find a failure, **report it — do not silently repair it.** A repaired failure that was reported as passing is worse than an honest failure.

---

## Why the report was rejected

**1. It contradicts itself.** Phase 0 acceptance criteria include "Terraform applies cleanly to all three accounts from a clean state." You listed Terraform AWS apply as escalated/not done. Phase 0 is declared blocking in §0 and §17 — nothing downstream can be considered complete on an unverified foundation. Explain this discrepancy directly.

**2. 81 tests is implausible for this spec.** There are roughly 76 discrete acceptance criteria across Phases 0–7, plus ~50 tables, a dozen state machines, a deferred-constraint ledger, RLS on every table, nine ingestion adapter kinds, and two scoring engines. A total suite of 81 suggests approximately one shallow assertion per criterion and little else. Justify the count or acknowledge the gap.

---

## Part 1 — Suite inventory

Report, as a table:

| Module | Test files | Test count | Line coverage | Branch coverage |

Then answer:

- Total test count and total coverage, from an actual coverage run. Paste the summary output.
- Which modules have **zero** tests beyond their acceptance criterion.
- Which acceptance criteria are satisfied by a test that exists **only** to satisfy that criterion, with no surrounding unit tests for the module.

---

## Part 2 — Stub inventory

For every module, state explicitly:

| Module | Real implementation | Stubbed | What the stub returns |

"Stubbed" includes: vendor adapters returning fixtures, in-memory substitutes for Postgres, mocked KMS/S3/Secrets Manager, no-op Temporal workers, fake Stripe.

**Vendor stubs are expected and correct per P10 and §17.** Infrastructure stubs are not. Specifically flag anything where an AWS service was mocked rather than exercised — KMS key wrapping, S3 signed URLs, Secrets Manager retrieval, Aurora-specific behavior.

For each such case, state which acceptance criteria passed against the mock and therefore have **not** actually been demonstrated.

---

## Part 3 — Criterion-by-criterion audit

For every acceptance criterion in §17, Phases 0–7, produce a row:

| Phase | Criterion (verbatim) | Status | Evidence artifact (exact file path + line range) | Real or stub | Notes |

Status is one of: `PASS`, `PASS-AGAINST-STUB`, `PARTIAL`, `FAIL`, `NOT-IMPLEMENTED`, `BLOCKED-BY-§18`.

Rules:
- Quote the criterion verbatim from the spec. Do not paraphrase.
- Evidence must be a path and line range in `evidence/` or the test suite. "See evidence/phase3" is not an artifact.
- `PARTIAL` requires a sentence stating exactly which half is unproven.
- Do not mark anything `PASS` that depends on infrastructure that was mocked. That is `PASS-AGAINST-STUB`.

---

## Part 4 — Targeted deep verification

These properties can pass a test while being wrong in production. For each, paste the actual implementation and the actual test, then answer the question.

### 4.1 Placement concurrency — highest priority

§17 Phase 1: "50 parallel accepts on one unit → exactly 1 placement, 49 clean typed rejections."

- Paste the test.
- Is it genuinely concurrent — 50 real connections, 50 real transactions, executing simultaneously — or a sequential loop? A loop passes trivially and proves nothing.
- Paste the `create unique index one_active_placement_per_unit` statement from the migration file.
- Confirm the rejection path surfaces a typed error, not a raw Postgres constraint-violation string leaking to the client.

### 4.2 Ledger balance enforcement

§11.1 specifies a deferred constraint trigger.

- Paste the migration containing `create constraint trigger ledger_balance_check`.
- If balance is validated in application code instead, say so plainly.
- Demonstrate: a **direct SQL insert** of an unbalanced transaction, bypassing all application code, is rejected by the database. Paste the psql output.

### 4.3 Ledger immutability

- Paste `psql` output of the grants on `ledger_entry` and `ledger_transaction` for the application role.
- Demonstrate an `UPDATE` and a `DELETE` attempted as the application role, both denied. Paste the errors.

### 4.4 RLS — real policies, not query-builder filtering

- Paste `select tablename, policyname, qual from pg_policies` output.
- Demonstrate: connect as the application role with **no** `rbit.current_org_id` set, `select * from listing`, and show the result is empty or errors — not a full table scan.
- Confirm tenancy is not being enforced by adding a `where org_id = ?` clause in the query builder. If it is, that is a `FAIL`.

### 4.5 Connection pooling and `SET LOCAL` — the production landmine

`current_setting('rbit.current_org_id')` is session state. Under transaction-mode pooling against Aurora, session state leaks between transactions on the same physical connection unless every set is `SET LOCAL` **inside** the transaction.

A single-connection CI test passes green while production isolation is broken.

- Grep for every `set_config` and `SET rbit.current_org_id`. Paste every occurrence with its file path.
- Confirm each is transaction-scoped (`SET LOCAL`, or `set_config(..., true)`).
- If any is not, mark it `FAIL` and report it. Do not fix it yet.
- State whether a test exists that runs two different org contexts across a **pooled** connection and asserts no bleed. If not, say so.

### 4.6 Crypto-shred

- Demonstrate the full sequence: create party → write identity → destroy DEK → identity unreadable → `party_features` row **still present** → ledger and audit foreign keys still valid.
- Confirm no `ON DELETE CASCADE` exists from `party` to anything. Paste the FK definitions.

### 4.7 Hash chain tamper detection

- Manually `UPDATE` one `admin_action_log` row (as a privileged role, in a test database).
- Run the verifier. Paste output showing it fails and identifies the broken link.

### 4.8 PII redaction

- Run the synthetic request carrying every PII field name.
- Paste the raw log output.
- Confirm zero PII values appear — including in Temporal workflow inputs and SQS payloads, not just application logs.

### 4.9 Score reproducibility

- Take a score record from seeded data.
- Replay its `feature_snapshot` through its recorded `model_version`.
- Paste both the original `raw_score` and the recomputed value.

### 4.10 Solar Equation 2 reference case

§17 Phase 6: the Tier 4 deal producing the $5,000 → $4,150 adjustment.

- Paste the test, its inputs, and its output.
- Confirm the reproduced figure is exactly $4,150 and that `explanation` names the binding constraint.

---

## Part 5 — Spec deviations

List every place the implementation differs from the spec, including:

- Tables, columns, indexes, or constraints that exist in code but not in the spec (§0.3 prohibits silent additions)
- Spec elements not implemented
- Any §18 decision resolved by a default, placeholder, or assumption rather than escalated (§0.1 prohibits this)
- Any `TODO`, `FIXME`, `HACK`, or hardcoded placeholder in a money, pricing, tier, threshold, or retention path

Grep for hardcoded values that §12.4 requires to be config: fee amounts, tier caps, TTLs, SLA durations, thresholds. Paste every occurrence found outside a config seed file.

---

## Part 6 — Phase 7 gate

Report the actual numbers:

- Placements with at least one `placement_outcome` row
- Label coverage at the 90-day horizon, as a percentage
- Confirm the gate is enforced in code and not merely documented — paste the enforcement
- Confirm rules-v0 is registered in `model_registry` with a version, and that its scores carry non-empty `explanation`

---

## Output format

Return Parts 1–6 as separate sections, in order. Tables where specified. No summary paragraph, no "overall the build is in good shape" framing.

End with a single table:

| Status | Count |
| PASS | |
| PASS-AGAINST-STUB | |
| PARTIAL | |
| FAIL | |
| NOT-IMPLEMENTED | |
| BLOCKED-BY-§18 | |

If any number in that table is uncertain, say so rather than guessing.