# R-4 final

## Baseline (before unit tests)

See `baseline.md` — Statements/Lines **4.06%** on phase0 acceptance sample; **0** unit-test files; coverage tooling was missing (now installed `@vitest/coverage-v8@3.0.8`).

## Unit tests added

| File | Focus |
|---|---|
| `tests/unit/matching.test.ts` | allowlist, serializer, invalid lapse, placement conflict |
| `tests/unit/ledger.test.ts` | unbalanced/non-positive, idempotency, reversal link, recognition lines |
| `tests/unit/brokerage.test.ts` | all RS tier edges + gaps, rank order, capacity filter |
| `tests/unit/screening.test.ts` | terminal order lock, payer_kind parity, badge transitions, rebate on funded |
| `tests/unit/ingestion.test.ts` | transform, quality gates, median rent shift |
| `tests/unit/identity.test.ts` | HMAC, roles, dual-approval SELF, token lifecycle/expiry |

**New unit tests:** 28 passed (`evidence/remediation/R-4/unit-results.json`)

## Final coverage (`npx vitest run --coverage tests/unit`)

Overall: **lines 20.81%**, **branches 57.17%**

| Module | Lines | Branches |
|---|---|---|
| matching | 50.0% (156/312) | 68.4% (13/19) |
| ledger | 35.0% (130/371) | 96.6% (28/29) |
| brokerage | 2.7% (27/1008) | 64.3% (9/14) |
| screening | 16.7% (265/1589) | 69.0% (40/58) |
| ingestion | 36.1% (812/2251) | 45.6% (82/180) |
| identity | 60.0% (174/290) | 44.4% (8/18) |

Full HTML/text under `evidence/remediation/R-4/coverage/`.
