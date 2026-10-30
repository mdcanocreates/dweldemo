# Authority Lite implementation matrix

Branch: `feature/dwel-authority-lite`  
Parent: `15e9cbc083a6e62b7f8de21106699b2fbd01c291`  
Worktree: `apps/dwel-authority-lite`  
Date: 2026-10-29

States used below are only ones this pass actually reached. Nothing here is release-ready or deployed.

| Requirement | State | Evidence |
| --- | --- | --- |
| Own branch from the formal-application baseline, not the dirty partner worktree | implemented | `git worktree` at `15e9cbc` |
| Feature flag hides `/v1/authority` when `DWEL_AUTHORITY_LITE` is off | integration-tested | flag-off request returned 404 |
| Sandbox agency create refused unless sandbox flag and non-production `APP_ENV` | implemented | handler checks both; exercised with flags on |
| Agency tenant, membership, invitation accept | integration-tested | owner invite, caseworker and coordinator accept |
| Housing case on an existing Dwel party, no second renter identity | integration-tested | `dwelPartyId` is `party.id` |
| Same display reference allowed in two agencies | integration-tested | both creates returned 201 |
| Guessing another agency's case id | integration-tested and browser-tested | 404; browser alert and the reference is absent |
| Caseworker cannot verify assistance or acknowledge a packet | integration-tested | 404 and 403 |
| Participant cannot forge `agency_verified` | integration-tested | 404; role is not read from JSON |
| Assistance verification is a separate owner/supervisor call | implemented | `POST .../assistance`; success path not separately asserted |
| Search signal uses bedrooms, rent, and area only | unit-tested | inventory order unchanged; no assistance filter |
| Case create idempotency replay and payload conflict | integration-tested | same id replayed; different body 409 |
| Create plus audit event rolls back together | integration-tested | thrown error left no `ROLLBACK-1` row |
| Opt-in share, accept, revoke | integration-tested | list empty, then visible, then empty |
| Listing lead and provider outreach | integration-tested | existing listing id; provider list has no assistance fields |
| RFTA packet sections, submit, agency acknowledgement | integration-tested | `agency_approved` rejected; status `sent_to_agency` then received label |
| Inspection appointment and external result | integration-tested | `passed: true` rejected; label is agency result recorded |
| Document preview of a missing storage key | integration-tested | 404 `This file is not available.` |
| Quarantine scan before preview, and a complete-upload step | not-started | missing keys fail; a quarantine row with a normal key can still preview |
| Lease-up confirmation from an agency source | integration-tested | owner only; label Lease-up confirmed |
| Small-cell lease-up report | integration-tested | `suppressed: true` below 5 |
| CSV import preview does not create cases | integration-tested | `applied: false`, `mode: preview` |
| Agency queue UI, refresh, mobile width | browser-tested | `E2E-CASE-001` survives reload at 390×844 |
| Participant, provider, and report pages | implemented | routes render API data; not a separate browser run |
| Packet, appointment, and document screens | not-started | those flows are API-tested only |
| Tasks, overdue dashboard cards, reschedule status | not-started | `authority_task` exists; no task API |
| Agency-wide audit filter beyond the case timeline | not-started | `GET .../timeline` exists; no agency audit query |
| Column-level hiding of verification fields from the coordinator role | not-started | the API serializer strips fields; SQL as that role can still read them |
| Agency SSO or MFA | not-started | browser scenario skipped. Sessions are the existing Dwel session table |
| Official eligibility, subsidy, HAP, inspection pass/fail | not implemented | kept outside this release |
| Marketplace or PostHog delivery of authority events | not implemented | unit test checks the marketplace allowlist; events stay in `authority_event` |
| Migration 0074 on Aurora, image digest, staging rollback | not-started | local disposable Postgres only |
| Accessibility, retention schedule, privacy review, pilot | not-started | required before any release-ready mark |
| Production deploy | not-started | not requested |

## Test evidence, 2026-10-29

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/authority-lite.test.ts` | 4 passed |
| `npx vitest run tests/integration/authority-lite.integration.test.ts --hookTimeout 180000` | 1 passed |
| `npx vitest run tests/browser/authority-lite.browser.test.ts --hookTimeout 180000` | 1 passed, 1 skipped |

Database: disposable `postgis/postgis:16-3.4` via testcontainers. App-role pool `rbit_app_user`, not the superuser, for HTTP. Node on this machine is not the production Node 22 runtime.

Browser: Chromium, hash route `/#/authority/cases`, bearer session. SSO/MFA scenario is skipped and is not a pass.

`npx tsc -p tsconfig.json --noEmit` still fails on the pre-existing `AddressInfo` import in `tests/integration/formal-application.integration.test.ts` and on `web/src/pages/DiscoverPage.tsx`. Those files were not part of this branch's edits. No authority file was reported.

## Unresolved

- 0074 is not applied anywhere except disposable test databases.
- Document bytes are not stored in S3. Preview tokens point at a storage key only.
- Coordinator and navigator field stripping is application code, not a database view.
- Support break-glass is absent. `supportMayReadHousehold()` returns false and there is no support route.
- Partner-intake dirty files on `release/dwel-partner-intake` were not merged onto this branch.
- Overall Dwel release remains NO GO. This package is NO GO for production.
