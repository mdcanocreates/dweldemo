# Checkr Tenant API Integration (Dwel)

## 1. Architecture summary

Checkr Tenant attaches to Dwel’s existing application + screening spine. It does **not** replace the application leasing state machine (`awaiting_consent` → `screening_authorized` → `screening_running` → `screened` → `approved` / `declined`).

| Layer | Role |
|-------|------|
| `checkr_tenant_screening` | Orthogonal screening sub-state (`not_requested` … `canceled`) + Checkr IDs |
| `CheckrTenantClient` | Server-only HTTP adapter (Bearer, pinned version, retries) |
| `initiateCheckrScreening` | Authorized initiation with app-level idempotency |
| `POST /v1/webhooks/checkr` | Signature-verified webhook ingest + authoritative report fetch |
| Vendor registry | `checkr_tenant` when `CHECKR_TENANT_ENABLED=true`; else Certn spine |

Platform orders supply `original_requester` (home provider org) so the report is furnished to the correct end user. Sensitive identity (SSN) is collected on Checkr’s hosted applicant experience — never stored in Dwel.

**Important:** `consider` product results require human review. They must never auto-reject an applicant.

## 2. Files changed / added

### Backend
- `migrations/0067_checkr_tenant_screening.sql`
- `src/modules/vendors/checkr/*` — types, client, availability, adapter, webhook signature
- `src/modules/screening/checkr/*` — state, initiate, webhook, reports
- `src/http/checkr-handlers.ts`
- `src/http/router.ts`, `src/http/handlers.ts`, `src/server.ts`
- `src/modules/vendors/registry.ts`, `src/modules/vendors/index.ts`
- `src/modules/screening/index.ts`
- `.env.example`

### Frontend
- `web/src/api/client.ts` — Checkr API helpers
- `web/src/components/screening/CheckrApplicantContinue.tsx` — renter hosted-applicant CTA
- `web/src/pages/landlord/ApplicantDetailPage.tsx` — HP review section
- Wire `CheckrApplicantContinue` into the renter screening page where that surface lives

### Tests / docs
- `tests/unit/checkr-tenant.test.ts`
- `docs/checkr-tenant-openapi.yaml` (official bundle copy)
- `docs/CHECKR_TENANT_INTEGRATION.md` (this file)

## 3. Database migrations

`0067_checkr_tenant_screening.sql`:
- `checkr_tenant_screening` — linkage + sub-status + idempotency
- Unique partial index: one active screening per application (Dwel-enforced dedup; Checkr test mode does not enforce order idempotency)
- `checkr_report_access_audit` — report/PDF access audit trail

## 4. API routes added

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/applications/:id/checkr-screening/initiate` | Landlord/broker session | Create Checkr order |
| GET | `/v1/applications/:id/checkr-screening` | Renter/HP session | Status (renter) or review DTO (HP) |
| GET | `/v1/applications/:id/checkr-screening/pdf` | Landlord/broker | Proxied report PDF |
| POST | `/v1/webhooks/checkr` | Public + signature | Lifecycle events / empty probe |
| GET | `/v1/admin/integrations/checkr` | (status) | Feature/config readiness |

## 5. UI changes

- **Renter screening page:** Shows Checkr sub-status; “Continue to Checkr” when `application_url` exists (`awaiting_applicant`).
- **Home provider applicant detail → Screening tab:** Progress, product clear/consider, review-required flag, PDF download, initiate CTA. No auto approve/deny/rank.

## 6. Environment variables

```env
CHECKR_TENANT_ENABLED=false
CHECKR_TENANT_API_URL=https://tenant.checkr.com/api
CHECKR_TENANT_API_KEY=
CHECKR_TENANT_WEBHOOK_SECRET=
CHECKR_TENANT_MODE=test
CHECKR_TENANT_API_VERSION=2026-04-29
CHECKR_TENANT_ALLOW_LIVE=false
```

Live keys (`ckr_sk_live_*`) are rejected unless `APP_ENV=production|prod` **and** `CHECKR_TENANT_ALLOW_LIVE=true`.

## 7. Unit / integration test results

Run: `npx vitest run tests/unit/checkr-tenant.test.ts`

Coverage includes:
- Feature flag / missing config fail-closed
- Live key isolation
- Webhook signature verify / replay window / invalid signature
- Bearer + version + idempotency headers
- Test-mode rejection of `payer: applicant`
- Report summary sanitization (no SSN leakage)
- Sub-state transition rules
- Official sandbox profile roster guard

## 8. Sandbox testing instructions

1. Set `CHECKR_TENANT_ENABLED=true` with a `ckr_sk_test_*` key and webhook secret.
2. Register webhook URL `https://<host>/v1/webhooks/checkr` (HTTPS required). Use dashboard “Test” connectivity probe (empty body → 200).
3. Ensure applicant has consent (`pay-consent`) and email on `renter_profile`.
4. As home provider: `POST /v1/applications/{id}/checkr-screening/initiate` with optional `sandbox_applicant` for canned profiles.
5. Use official profiles (DOB `1996-04-27`):

| Profile | SSN | Scenario |
|---------|-----|----------|
| Hudson Green | 555-55-5555 | Hosted applicant UX (`application_url`) |
| Herbert Humphrey | 111-11-1111 | Criminal consider |
| Madelyn Webster | 222-22-2222 | Credit consider |
| Norma Davies | 333-33-3333 | Eviction consider |
| Tim Watkins | 444-44-4444 | Multiple consider |
| Ingrid Vance | 666-66-6666 / 666-66-6667 | Document income |

6. Always use `payer: organization` in test mode.
7. Duplicate initiate must return existing screening (`duplicate: true`) — Dwel dedupes; Checkr test mode does not.
8. Negative cases: invalid signature → 401; missing config → 503; unauthorized PDF → 403.

## 9. Deployment requirements

- Apply migration `0067`.
- Inject Checkr secrets via Secrets Manager / ECS env (never bake into images).
- Public HTTPS webhook endpoint reachable by Checkr.
- Keep `CHECKR_TENANT_ENABLED=false` until sandbox sign-off.
- Separate deployment config for live mode (`CHECKR_TENANT_ALLOW_LIVE`, production `APP_ENV`).
- Do not log API keys or report payloads (client redacts SSN-shaped strings).

## 10. Remaining compliance / production blockers

- [ ] Legal review of FCRA adverse-action workflows before using `consider` outcomes in production decisions
- [ ] State/local screening fee caps and disclosure localization
- [ ] Documented retention / deletion schedule for `checkr_tenant_screening.report_summary` and access audits
- [ ] Production webhook endpoint registration + live key rotation runbook
- [ ] Confirm `original_requester` address fields if Checkr requires them for your org type
- [ ] End-to-end sandbox evidence pack for all six canned profiles + webhook ordering/dedup
- [ ] Explicit product decision: Certn vs Checkr dual-run vs cutover (registry currently prefers Checkr when enabled)
