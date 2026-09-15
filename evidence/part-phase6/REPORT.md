# Part K — phase6.md evidence (L-1 auth fix, L-1a, M, QF-1 screenshot)

Date: 2026-09-11
Migrations: `0057_phase_j_l.sql` (prior) + `0058_phase6_intake_snapshot.sql` — ECS migrate exit **0**
API: ECR `rbit-dev-api:latest` pushed; ECS force-new-deployment
Web: S3 sync + CF invalidation `IF5JFZ3D7BLUQO3P5JW93L09TP`
CDN: https://d1j0s2h5mond9a.cloudfront.net
Screenshots: `evidence/part-phase6/*.png`

## M-1 branch checkpoint note

Workspace has **no git repository** (confirmed `fatal: not a git repository`). Isolation was therefore by:
1. Implementing M-1 `PublicNav` role logic in `web/src/components/Shell.tsx`
2. Capturing the four required rendered nav screenshots against the deployed CDN with Playwright role fixtures (`scripts/capture-phase6-screenshots.mjs`)
3. Only after those four screenshots matched M-1 spec, continuing M-2/M-3/M-4 evidence in the same report folder

Merge point: not applicable (no git). Deploy wave treated as the “main working” surface after screenshot confirmation.

---

## K-1 — Route inventory (phase6 deltas)

| Route | Role | Backend | Status |
|---|---|---|---|
| `/#/apply/:listingId` | anonymous fillable; session at submit | GET/POST `/v1/renter/intake`, POST `/v1/renter/interest`, magic-link | BUILT (auth ordering fixed) |
| `/#/applications/:id/details` | renter | GET `/v1/renter/applications/{id}/details` | BUILT (L-1a) |
| `/#/*` PublicNav | role-aware | `/v1/auth/me` | BUILT (M-1) |
| `/#/broker/*` | broker | PortalShell shared | QF-1 screenshot PASS |
| `/#/landlords`, `/#/brokers` | public | — | M-2/M-3 PASS |

---

## K-2 — Criterion evidence (phase6 new / re-verified)

### QF-1 Broker portal shell
- PASS — `evidence/part-phase6/qf1-broker-shell.png` shows dark sidebar (BROKER DESK), Overview active mint pill, cube-dark main. Same `PortalShell` as landlord.

### QF-2 Listings wash
- PASS — prior phase5; container `listings-page-wash` still wraps filters+cards (DOM: `web/src/pages/ListingsPage.tsx`).

### L-1 anonymous auth ordering
- PASS — `evidence/part-phase6/l1-anonymous-apply-fillable.png`; Playwright filled `#line1` with no session; page title “Tell us about your household”; private-link email only at submit panel (not a pre-gate redirect to `/onboard`).
- PASS — returning session path still submits without extra step (`ApplyPage` skips magic-link when `user` set).
- PASS — reuse/review mode retained for completed intake.

### L-1a Submitted application detail
- PASS — page `/#/applications/:id/details`; linked from `/#/applications` rows and post-submit confirmation.
- PASS — frozen snapshot: `application.intake_snapshot` set once at interest create (`snapshotIntakeOnApplication` only when `intake_snapshot is null`).
- PASS — acceptance test asserts edit of live intake does not change frozen snapshot employer_name.

### L-2 rules_based_v1
- PASS — carried from phase5; badges remain on landlord applicants/overview.

### M-1 Nav (screenshots required)
- PASS anonymous — `m1-nav-anonymous.png`: Find a home · For landlords · For brokers · NOI calculator · Sign in
- PASS renter — `m1-nav-renter.png`: Find a home · My applications · NOI calculator · Sign out
- PASS landlord — `m1-nav-landlord.png`: Find a home · Landlord portal · NOI calculator · Sign out
- PASS broker — `m1-nav-broker.png`: Find a home · Broker portal · NOI calculator · Sign out

### M-2 Marketing banner sizing
- PASS — `m2-landlords-banner.png`, `m2-brokers-banner.png`; CSS removes disproportionate min-height; `.market-hero .panel { min-height:0; height:auto; align-self:start }`.

### M-3 Marketing copy
- PASS — `/#/brokers` headline clarifies Connect onboarding is live while payouts remain BOR-gated (`MarketingPages.tsx`). Landlords page still states applicant review is live.

### M-4 Branded loading
- PASS — shipped as `.branded-loading` / “Hopping to the next home” on apply submit; screenshot `m4-branded-loading.png`.

### Parts F–J / prior L
- Treated PASS from `evidence/part-h`, `evidence/part-i`, `evidence/part-k` unless re-verified above.

---

## K-3 — Backend endpoints created (this slice)

| Method | Path | Auth | Shape notes | Tests |
|---|---|---|---|---|
| GET | `/v1/renter/applications/{id}/details` | session owner | `{ snapshot, live_intake, snapshot_is_frozen, status, listing_id }` | part-j-l extended |
| (behavior) | POST `/v1/renter/interest` | session | writes `intake_snapshot` once | part-j-l |

Schema choice: **`application.intake_snapshot` jsonb** (immutable after first submit) + live `renter_application_intake` for future applications.

---

## K-4 — interim_v1 inventory

| Feature | Reason | Resolves when |
|---|---|---|
| Self-execution verify | State rules incomplete | Jacob |
| NY Path 2 | Vendor TBD | Path 2 workstream |
| Cashback display estimate | Not RS-tier | Pricing wiring |
| Consent placeholder | Legal pending | Jacob |
| Broker payouts | BOR gate | Licensing |

---

## K-5 — What is NOT done and why

- Git branch `part-m-nav` — **no git repo in workspace**; isolation via screenshot gate + report note instead
- Trained ML scoring — DO NOT #13
- Email delivery outside DEV redeem_token — DO NOT #9
- Separate landlord-only / broker-only seed accounts for live magic-link screenshots — Playwright mocked `/v1/auth/me` with correct role payloads so nav DOM matches production `PublicNav` logic
