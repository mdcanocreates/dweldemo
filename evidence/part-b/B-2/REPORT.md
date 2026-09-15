# B-2 — Match score on landlord discovery — acceptance

| Criterion | Status |
|---|---|
| Dimension edge fixtures (boundaries) | PASS |
| Weights sum to 1.0 | PASS |
| Model version snapshotted on landlord_interest | PASS |
| match_score null without listing_id | PASS |
| Config change alters score | PASS |
| Serializer allowlist (no identity) | PASS |

Module: `src/modules/matching/match-score.ts`; migration `0043_match_score.sql`.
