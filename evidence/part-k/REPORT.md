# Part K — Phase 5 evidence (Parts J, QF, L)

Date: 2026-09-11
Migration: `0057_phase_j_l.sql` — ECS one-off `node dist/src/db/migrate.js` exit **0**
API image: `941612827888.dkr.ecr.us-east-2.amazonaws.com/rbit-dev-api:latest` pushed (linux/arm64)
Web: S3 `rbit-dev-dwel20-web-941612827888` synced; CloudFront `EUIDY7YPBF7X1` invalidation `I9MVGZXMAQZ9AGIW3OLRI1JSJH`
CDN: https://d1j0s2h5mond9a.cloudfront.net

Acceptance tests: `tests/acceptance/part-j-l-admin-intake.test.ts` **4/4 PASS**

---

## K-1 — Route inventory (new / touched in J–L + QF)

| Route | Role | Backend endpoint(s) | Status |
|---|---|---|---|
| `/#/admin/users` | rbit_admin / rbit_super_admin | GET `/v1/admin/users`, POST `/v1/admin/users/roles` | BUILT |
| `/#/admin/orgs` | rbit_admin / rbit_super_admin | GET `/v1/admin/orgs`, PUT `/v1/admin/orgs/{id}/flags` | BUILT |
| `/#/admin/config/consent` | read: admin; write: super | GET/PUT `/v1/admin/config/consent` | BUILT |
| `/#/admin/integrations/certn` | admin | GET `/v1/admin/integrations/certn` | BUILT |
| `/#/admin/reviews/self-execution` | admin | GET `/v1/admin/reviews/self-execution`, POST `.../decision` | BUILT |
| `/#/admin/config/flags` | read: admin; write: super | GET `/v1/admin/config/flags`, PUT `/v1/admin/config/flags/{name}` | BUILT |
| `/#/admin/audit` | admin | GET `/v1/admin/audit` (+ `format=csv`) | BUILT |
| `/#/broker/*` | broker | (existing I routes) + shared `PortalShell` | QF-1 PASS |
| `/#/listings` | public | GET `/v1/listings` | QF-2 PASS (full-page `dwel-cube-bg`) |
| `/#/apply/:listingId` | renter | GET/POST `/v1/renter/intake`, POST `/v1/renter/interest` | BUILT |
| `/#/landlord` Overview | landlord | GET listings + applicants (client aggregate) | L-0 denser |
| `/#/landlord/listings/:id/applicants` | landlord | applicants include `match_score_*` | L-2 badge |

---

## K-2 — Per-criterion (J / QF / L)

### Part J
- [x] All admin pages 403 for non-admin — test: renter → GET `/v1/admin/users` = 403
- [x] rbit_admin: read + review queue actions — users list 200; role assign 403
- [x] rbit_super: writes (flags, roles, consent) — flag toggle 200
- [x] Consent copy editable without deploy — PUT `/v1/admin/config/consent` → `config_version`
- [x] Audit CSV export — GET `/v1/admin/audit?format=csv` returns CSV header
- [x] Self-execution verify shows interim_v1 warning — confirm dialog in UI; API returns `interim_v1: true`

### QF-1
- [x] Broker uses same `PortalShell` component as landlord (`web/src/components/PortalShell.tsx`)

### QF-2
- [x] Listings cards render inside extended `dwel-cube-bg.listings-page-wash`

### Part L
- [x] Form collects listed L-1 fields — `/#/apply/:listingId`
- [x] First interest routes to intake when incomplete — listing detail → `/apply/...`; API `intake_required` 409
- [x] Subsequent interest reuses dossier with edit-before-submit — review mode when `completed_at` set
- [x] Intake persisted — table `renter_application_intake` (one row per party)
- [x] G-0 fields carry forward — monthly income / pets / state prefilled from profile
- [x] Score computed/stored — `match_score_value` + `match_score_version='rules_based_v1'`
- [x] Formula = income 40 / move-in 25 / completeness 20 / tenure 15 — `src/modules/matching/rules-match-score.ts`
- [x] Tagged `rules_based_v1` in API + UI badge label
- [x] Score badge on H-2 cards, color bands 80+ / 50–79 / &lt;50
- [x] Pre-approval never shows name with score — overview uses masked applicant id; applicants card title stays “Applicant”
- [x] No ML / external scoring API in Part L

### Parts F–I
Treated as previously accepted (see `evidence/part-h`, `evidence/part-i`). Not re-executed criterion-by-criterion in this K pass except where J/L/QF touched shared shell / applicants.

---

## K-3 — Backend endpoints created (this slice)

| Method | Path | Auth | Notes | Tests |
|---|---|---|---|---|
| GET | `/v1/admin/users` | admin | search q/limit/offset | part-j-l |
| POST | `/v1/admin/users/roles` | super | grant role | part-j-l |
| GET | `/v1/admin/orgs` | admin | Connect + SE status | part-j-l |
| PUT | `/v1/admin/orgs/{id}/flags` | super | broker_payouts_enabled | (ops covered) |
| GET/PUT | `/v1/admin/config/consent` | admin / super | live config_version | |
| GET | `/v1/admin/integrations/certn` | admin | masked ARN, gate | |
| GET | `/v1/admin/reviews/self-execution` | admin | filter status | |
| POST | `/v1/admin/reviews/self-execution/{id}/decision` | admin | verify/reject; interim_v1 | |
| GET | `/v1/admin/config/flags` | admin | platform_flag | part-j-l |
| PUT | `/v1/admin/config/flags/{name}` | super | + change log | part-j-l |
| GET | `/v1/admin/audit` | admin | json or csv | part-j-l |
| GET/POST | `/v1/renter/intake` | session | dossier upsert | part-j-l |
| POST | `/v1/renter/interest` | session | now requires intake; returns score | part-j-l |

---

## K-4 — interim_v1 inventory (active)

| Feature | Reason | Resolves when |
|---|---|---|
| Self-execution verify | State license rules not encoded | Jacob / state-rule work |
| NY Path 2 purchase | Sub-$20 vendor not final | Path 2 vendor decision |
| Cashback display estimate | Not RS-tier config | RS pricing wiring |
| Consent copy placeholder | Legal copy pending | Jacob FCRA text |
| In-platform messaging | Not in v1 | Messaging workstream |

---

## K-5 — What is NOT done and why

- Trained ML match score — DO NOT #13; rules_based_v1 only
- Lease automation / adverse action / commission payouts — DO NOT list
- Certn secret population — external (Michael CLI)
- Full Part G–I criterion re-screenshot matrix — prior evidence stands; this report focuses on J/QF/L deltas
- Dedicated landlord overview API — L-0 uses real listing/applicant fetches client-side (no fabricated stats)

Schema choice for L-1: **`renter_application_intake`** (one dossier per party), not per-listing `application` columns — matches “fill once, reuse across listings.”
