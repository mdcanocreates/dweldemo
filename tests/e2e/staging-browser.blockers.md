# Browser E2E (staging) — environment blockers

Scenarios required by the engineering continue brief:

1. Renter synthetic account → interest → missing-info upload → quarantine → clean
2. Home provider review accept/return missing info
3. Admin Control Center case workspace against staging internal API
4. Fake/test-mode scan vendor (no prod Certn)

## Current blockers

1. No disposable staging hostname or seeded synthetic accounts in AWS yet.
2. Local Docker daemon unavailable in the engineering continue environment (disposable migrate + browser E2E against compose Postgres blocked). CI `staging-prep` / `disposable-migrate` job is the automated path.
3. Local UI preview adapters are not a substitute for authenticated cross-role E2E against staging API.

## CI posture

- Job draft: `.github/workflows/staging-prep.yml` runs static TF + gates + disposable migrate against service Postgres when available.
- Browser E2E job remains **manual / environment-blocked** until staging URL + secrets exist.
- Do not fabricate a green E2E verdict.
