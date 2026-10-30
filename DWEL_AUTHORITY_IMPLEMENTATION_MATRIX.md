# Authority Lite implementation matrix

Branch: `feature/dwel-authority-lite`  
Parent: `15e9cbc083a6e62b7f8de21106699b2fbd01c291`  
Worktree: `apps/dwel-authority-lite`  
Date: 2026-10-29

States are only ones this pass actually reached. Nothing is release-ready or deployed. Institutional SSO was not verified.

| Requirement | State | Source | Test |
| --- | --- | --- | --- |
| Own branch from `15e9cbc` | implemented | worktree `apps/dwel-authority-lite` | `git rev-parse` |
| Feature flag hides `/v1/authority` | integration-tested | `src/http/authority-handlers.ts` | authority-lite integration, flag off returns 404 |
| Sandbox agency create | integration-tested | `authoritySandboxEnabled` in `src/modules/authority/service.ts` | exercised with flags on; production `APP_ENV` still refused in code |
| Agency tenant, invite, accept | integration-tested | `migrations/0074_authority_lite.sql`, service invite/accept | authority-lite integration |
| Case linked to an existing Dwel party | integration-tested | `authority_housing_case.dwel_party_id` | authority-lite integration |
| Same reference in two agencies; other agency 404 | integration-tested, browser-tested | RLS in `0074` | integration and `/#/authority/cases` |
| Verification source is not a column the app role can read | integration-tested | `migrations/0075_authority_completion.sql` `authority_private_verification`; `authority_read_verification` | app role `SELECT` returns `42501`; coordinator function returns no row; owner function returns the source |
| Caseworker cannot acknowledge or verify | integration-tested | `src/modules/authority/access.ts` | authority-lite integration |
| Forged `agency_verified` on create | unit-tested and integration-tested | `CreateHousingCase` and `authority_init_assistance` | unit test rejects the value |
| Fresh MFA required for acknowledge, verification, and lease-up | integration-tested, browser-tested | `assertFreshMfa`, `authority_mfa_factor`, `session.authority_mfa_until`, `src/modules/authority/totp.ts` | low-assurance acknowledge is `mfa_required`; browser enters a real TOTP code |
| Agency SSO / OIDC | not-started | no IdP adapter | browser scenario skipped. This is not a pass |
| Search signal uses bedrooms, rent, and area only | unit-tested | `src/modules/authority/search-signal.ts` | 4 unit tests passed |
| Idempotent create and rollback | integration-tested | `createHousingCase` | replay, 409, and thrown error leaves no row |
| Share, accept, revoke | integration-tested | `authority_case_share` | list empty, visible, empty |
| Listing lead and provider outreach | integration-tested | existing `listing` id | provider JSON has no assistance fields |
| RFTA packet submit and receipt | integration-tested | `submitPacket`, `acknowledgePacket` | `agency_approved` rejected; receipt label after MFA |
| Packet section screens | not-started | API `PATCH` sections exist; no packet editor page | not browser-tested |
| Inspection result without pass/fail | integration-tested | `recordExternalInspection` | `passed: true` is 403 |
| Appointment reschedule with UTC instant | integration-tested, browser-tested | `rescheduleAppointment`, `authority_appointment_change` | `2026-11-01T01:30:00-05:00` stored as `2026-11-01T06:30:00.000Z`; browser shows Rescheduled |
| Quarantine blocks preview; scan is not a browser flag | integration-tested, browser-tested | document trigger, `authority_apply_scan`, `completeUpload`, `previewDocument` | forged `scan_status` is 400; direct `UPDATE` is `42501`; preview 404 until the scanner token marks the matching hash clean |
| Real S3 quarantine bucket and malware engine | not-started | bytes are stored in `authority_object_bytes` | local scanner token is a test double, not an external engine |
| Tasks and overdue label | integration-tested, browser-tested | `createTask`, `patchTask`, `taskStatusLabel` | rollback leaves no orphan; browser shows Overdue and the title after reload |
| Agency audit without document keys or verification text | integration-tested | `listAudit` selects no metadata | JSON does not contain the verification source; caseworker receives 403 |
| Audit screen | implemented | `web/src/pages/AuthorityAuditPage.tsx` | not a separate browser run |
| Case workspace | browser-tested | `web/src/pages/AuthorityCasePage.tsx` | tasks, visit, file, MFA, lease-up at 390×844 |
| Participant and provider pages | implemented | `AuthorityParticipantPage.tsx`, `AuthorityProviderPage.tsx` | API coverage in the first integration test; pages were not a separate browser run |
| Small-cell lease-up report | integration-tested | `leaseupReport` | `suppressed: true` below 5 |
| CSV import preview does not create cases | integration-tested | `previewImport` | `applied: false` |
| Marketplace or PostHog delivery | not implemented | unit allowlist check | authority names are absent |
| Migration 0074 and 0075 on Aurora | not-started | local disposable Postgres only | not applied |
| Accessibility, retention, privacy review, pilot | not-started | — | required before any release-ready mark |
| Production deploy | not-started | — | not requested |

## Test evidence, 2026-10-29

Node on this machine is not the CI Node 22 runtime. `.github/workflows/ci.yml` already requests Node 22.

| Command | Result |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | passed after the `AddressInfo` import fix |
| `npx tsc -p web/tsconfig.json --noEmit` | passed after the Discover profile revision fix |
| `npx vitest run tests/unit/authority-lite.test.ts` | 4 passed |
| `npx vitest run tests/integration/authority-lite.integration.test.ts --hookTimeout 180000` | 1 passed |
| `npx vitest run tests/integration/authority-security.integration.test.ts --hookTimeout 180000` | 1 passed |
| `npx vitest run tests/browser/authority-lite.browser.test.ts --hookTimeout 180000` | 2 passed, 1 skipped |

Database: disposable `postgis/postgis:16-3.4`. HTTP uses `rbit_app_user`. The skipped browser case is agency single sign-on.

## Unresolved

- No institutional IdP. Native TOTP is covered. SSO remains blocked.
- Document bytes are in Postgres, not a private S3 quarantine bucket. The scanner is a shared token, not an independent malware engine.
- Packet, participant, and provider screens are not browser-tested end to end.
- Coordinator field stripping for verification is the absence of columns plus a security-definer function. A caller who can set `rbit.current_party_id` to an owner party could still call that function. The application sets the party from the session.
- MFA is enforced on the request, not inside the database function.
- 0074 and 0075 are not on Aurora. No image digest, accessibility audit, retention schedule, or pilot.
- Overall Dwel release remains NO GO.
