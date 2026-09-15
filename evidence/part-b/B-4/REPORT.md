# B-4 — Broker performance dashboard — acceptance

| Criterion | Status |
|---|---|
| broker_admin only (others 403) | PASS |
| rank_in_submarket percentile 0–100, no peer names | PASS |
| ev_per_lead changes with config | PASS |
| trend = prior window fields | PASS |
| Reads via ReplicaQueryClient (query log path=replica) | PASS |

Module: `src/modules/brokerage/performance.ts`; migration `0045_broker_performance_dashboard.sql`.
