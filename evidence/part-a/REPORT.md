# Part A — GLOBAL_TABLES RLS remediation — evidence

Gate status: **COMPLETE**. Do not start Part B/C until this package is accepted.

## A-1 Classification

See [`A-1-classification.md`](./A-1-classification.md).

Halt to Michael: **none**.

## A-2 Policies + allowlist + session

| Artifact | Path |
|---|---|
| Migration | `migrations/0041_rls_part_a_remediation.sql` (copy: [`0041_rls_part_a_remediation.sql`](./0041_rls_part_a_remediation.sql)) |
| Allowlist | `GLOBAL_TABLES.json` (copy: [`GLOBAL_TABLES.json`](./GLOBAL_TABLES.json)) |
| Party session GUC | `src/db/session.ts` — sets `rbit.current_party_id` with org + bypass |
| Auth redeem | `src/modules/auth/passwordless.ts` — binds party before `session` insert |
| Notify enqueue | `src/modules/notifications/notify.ts` — temporary party bind for WITH CHECK |

### Remediating tables (removed from GLOBAL_TABLES)

`sync_run`, `raw_record`, `listing_field_provenance`, `unit_source_conflict`, `placement_queue_entry`, `placement_outcome`, `screening_order`, `screening_report`, `screening_rebate`, `income_verification`, `fraud_signal`, `solar_underwriting_decision`, `solar_deal_remittance`, `document_grant`, `document_access_log`, `notification`, `notification_preference`, `renter_profile`, `score`, `feature_snapshot`, `session`.

Policies: [`pg_policies.txt`](./pg_policies.txt).

### Remain GLOBAL (justification per entry in JSON)

Platform / reference / pre-auth: `auth_magic_token`, `notification_suppression`, vendor_* archives, saga states, ledger_*, `payment_event`, `reconciliation_run`, `search_event*` partitions, `search_demand_daily`, `screening_package`, plus prior reference spine (`org`, `party`, `config_version`, …).

## A-3 Tenancy CI gate

```
tenancy-gate: PASS
checked 94 tables; allowlist size 53
```

Full output: [`tenancy-gate-pass.txt`](./tenancy-gate-pass.txt).

Deliberate inject (`TENANCY_INJECT_VIOLATION=1`): [`tenancy-gate-inject-fail.txt`](./tenancy-gate-inject-fail.txt) — fails on `deliberate_unscoped`.

Gate updates (`ci/gates/tenancy.ts`): accepts party tenant columns and policies binding `rbit.current_party_id`.

## A-4 Isolation (app role `rbit_app_user`)

From acceptance test `tests/acceptance/part-a-rls.test.ts` → [`isolation-checks.txt`](./isolation-checks.txt):

| Context | Result |
|---|---|
| No org/party | **0 rows** on all 21 remediating tables |
| Org A | Sees own JOIN/DUAL rows (sync_run, placement_outcome, screening_*, document_*, score, discoverable renter_profile) |
| Org B | Sees own sync_run; **cannot** see Org A sync_run or placement_outcome |
| Party A | Sees own notification, session, rebate, income, feature_snapshot, score, profile |
| Party B | Sees own notification/profile; **cannot** see Party A session |
| Solar partner org | Sees underwriting_decision + deal_remittance for own deals |

## Acceptance

```
npm test -- tests/acceptance/part-a-rls.test.ts
→ 3 passed
```
