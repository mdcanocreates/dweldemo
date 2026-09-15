# R-2 — §18 provisional values inventory

**No values were changed.** Corrected BLOCKED-BY-§18 count: **8** (reconciled against audit estimate 6–8).

| Decision | Provisional value in code | File path + line | What consumes it | Production behavior if never revisited | Ships silently? |
|---|---|---|---|---|---|
| D-01 | No TTL durations; `purge_after` left null | `pii-manifest.yaml` (retention_class only); party.purge_after unused | Crypto-shred / purge job | Identity never expires; retention obligation unmet | **yes** — null looks intentional |
| D-02 | `report_portability_days: 30` (TEST_ONLY seed) | `tests/helpers/phase2.ts` L24–32; resolved via `src/modules/screening/config.ts` L80–96 | Report grant expiry / re-pull | If a 30-day approved seed ships, portability window is 30d without Jacob/Certn sign-off | **yes** if approved seed lands in prod |
| D-03 | No state coverage list; license gate checks verified_at/expires/coverage rows only | `src/modules/brokerage/profile.ts` / assignment | Lead assignment | Launch markets undefined; empty coverage ⇒ no offers | **partial** — fails closed but markets never configured |
| D-05 | `lead_fee_recognition: 'immediate'` (TEST_ONLY seed) | `tests/helpers/phase3.ts` L89–90; `src/modules/ledger/recognition.ts` L11–22 | Lead purchase journal | Immediate revenue recognition without Dariel decision | **yes** if seed approved in prod |
| D-11 | TEST_ONLY display rule rows (`show_exact_address`, suppress_fields) | `tests/helpers/phase4.ts` L52–66 | Display serializer | Partner-illegal display if TEST rules copied to prod | **yes** if rows promoted |
| D-12 | Adapter kind `reso_aggregator_stub` | `src/modules/ingestion/adapters/registry.ts` L86, L148, L164; `types.ts` L13 | Ingestion adapter registry | Stub never replaced; no real MLS aggregator | **yes** — stub looks like a real kind |
| D-13 | `ALLOWED_RENTER_SEARCH_FILTERS` array (§9.4 verbatim) | `src/modules/matching/placement.ts` L10–20 | Renter search API allowlist | Fair-housing filter set ships without Jacob sign-off | **yes** — code constant |
| D-14 | `StubVaultTokenizer` / `vault_stub` | `src/modules/vendors/stubs.ts` L297+; registry L145 | SSN Path B tokenization | No real vault; Path B non-functional in prod | **yes** if registry defaults to stub |
| D-15 | `risk_insight_auto_adverse_action_enabled: false` | `tests/helpers/phase2.ts` L34; `src/modules/screening/config.ts` L106 | Adverse action routing | Stays false (safe); auto-adverse never enables without config flip | **no** — safe default, but still §18-owned |
| D-16 | Plaid methods + `StubIncomeVerification` / optional `plaid` key | `src/modules/vendors/stubs.ts` L142–158; `pipeline.ts` L176 default `plaid_bank` | Income verification | Stub income or broken Plaid without MSA | **yes** — default method `plaid_bank` |

## Corrected §18 count

| | Count |
|---|---|
| Audit footnote estimate | 6–8 |
| Inventory rows that ship silently or bind prod behavior without decision | **8** (D-01, D-02, D-05, D-11, D-12, D-13, D-14, D-16) |
| Safe-closed but still §18-owned | D-03 (fail closed), D-15 (false) |
| Previously reported BLOCKED-BY-§18 | 0 |
| **Corrected BLOCKED-BY-§18** | **8** |
