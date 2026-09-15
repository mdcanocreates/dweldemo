# Remediation execution report (P0 + P1)

## Per-task

### R-1 — lead/lead_offer RLS + allowlist
- Migration `0038_rls_remediation_r1.sql`; shrunk `GLOBAL_TABLES.json`
- Evidence: `evidence/remediation/R-1/`
- Acceptance: broker isolation, no-org zero rows, tenancy gate pass

### R-2 — §18 inventory + boot assertion
- Inventory: corrected **BLOCKED-BY-§18 = 8**
- Provisional config rows: `migrations/0039_section18_provisional_config.sql`
- Boot refuse: `src/modules/config/boot-assert.ts`, `scripts/boot-check.ts`
- Evidence: `evidence/remediation/R-2/` (incl. `boot-production-refuse.txt`)
- Zero provisional numeric values changed

### R-3 — pricing/TTLs → config_version
- `migrations/0040_r3_config_seeds.sql` — unapproved `rs_price_book` (12 tiers), `hold_durations`, `sla`, `screening_package.total_cost_cents=2946`
- Fee amounts removed from `src/modules/brokerage/price-book.ts`
- Consumers resolve config (placement hold, auth TTLs, rebate TTL, package cost)
- Evidence: `evidence/remediation/R-3/`

### R-4 — coverage + unit tests
- Installed `@vitest/coverage-v8`; baseline then final reports in `evidence/remediation/R-4/`
- 6 unit files, **28** unit tests

### R-5 — pooled bleed + static CI
- `tests/acceptance/remediation-r5.test.ts` — max:1 pool isolation + teeth demo (`set_config(..., false)` leaks)
- Gate: `ci/gates/tenant-session-local.ts` wired into `ci:gates`
- Evidence: `evidence/remediation/R-5/`
- Fixed phase3 unbalanced test to use `set_config(..., true)` inside the txn

## Status table

| Task | Status | Evidence path |
|---|---|---|
| R-1 | DONE | `evidence/remediation/R-1/` |
| R-2 | DONE | `evidence/remediation/R-2/` |
| R-3 | DONE | `evidence/remediation/R-3/` |
| R-4 | DONE | `evidence/remediation/R-4/` |
| R-5 | DONE | `evidence/remediation/R-5/` |

## Corrected §17 status counts

| Status | Count (before audit) | Count (after remediation) |
|---|---|---|
| PASS | 38 | 41 |
| PASS-AGAINST-STUB | 22 | 22 |
| PARTIAL | 12 | 9 |
| FAIL | 1 | 1 |
| BLOCKED-BY-§18 | 0 | 8 |

### Criteria that moved

| Criterion | Before | After | Why |
|---|---|---|---|
| Phase 0 RLS on every non-allowlisted table (lead/lead_offer) | PARTIAL | **PASS** | R-1 policies + allowlist shrink |
| Phase 3 price book dual-approval / no hardcoded fee path | PARTIAL / code literal | **PASS** | R-3 config_version + unapproved seed |
| Phase 1 passwordless TTL / hold TTL as deploy literals | PARTIAL | **PASS** (config-resolved) | R-3 `sla` / `hold_durations` |
| Coverage UNKNOWN / zero unit tests | gap | **addressed** | R-4 tooling + 28 unit tests (not a §17 row but audit Part 1) |
| Pooled tenant bleed unguarded | gap | **PASS** (new guard) | R-5 test + CI static check |
| BLOCKED-BY-§18 reporting | 0 | **8** | R-2 inventory + production boot refuse |

**Unchanged FAIL:** Terraform apply (P2 — out of scope).  
**Unchanged PASS-AGAINST-STUB:** LocalKms, MemoryObjectStore, vendor stubs, InProcess saga/queue.
