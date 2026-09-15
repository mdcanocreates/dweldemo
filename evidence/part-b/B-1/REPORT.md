# B-1 — Shareable renter verification badge — acceptance

| Criterion | Status | Evidence |
|---|---|---|
| Public badge returns correct fields, never identity | PASS | `public-badge.json` |
| Serializer reject email/name/phone via allowlist | PASS | unit assertion in test |
| Disabled badge → 404 not 403 | PASS | `disabled-404.txt` |
| View logged auth + unauth | PASS | `views-and-events.json` |
| Token rotation → old URL 404 | PASS | disable rotates token |
| 61st req/IP/60s → 429 | PASS | `rate-limit-429.txt` |
| Domain events share + disable | PASS | `views-and-events.json` |

Artifacts: migration `0042_badge_share.sql`, module `src/modules/badge/`.
