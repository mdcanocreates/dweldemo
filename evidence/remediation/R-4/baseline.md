# R-4 baseline (BEFORE new unit tests)

Collected: 2026-08-08 via `npx vitest run --coverage tests/acceptance/phase0.test.ts`
Unit-test files present: 0
Acceptance-only suite exercise of `src/modules`:

| Metric | Value |
|---|---|
| Statements | 4.06% (422/10385) |
| Branches | 57.06% (105/184) |
| Functions | 56.55% (69/122) |
| Lines | 4.06% (422/10385) |

Target modules (matching, ledger, brokerage, screening, ingestion, identity) largely uncovered by unit tests at baseline (0 dedicated `tests/unit` files).
