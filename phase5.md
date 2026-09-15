# RBIT — dwel.20 v2 frontend + screening integration + admin console
# Combined Cursor prompt: design port from Replit prototype, wired to real AWS backend.
# Produces: production-grade frontend across four surfaces + NY compliance module.

All §0 operating rules from the backend spec remain binding.
Report criterion-by-criterion with evidence. Do not summarise.

Execution order — strict:
  PART F — Status check (gate before any build)
  PART G — Renter-facing flow (onboarding, browse, apply, consent, status)
  PART G-NY — New York compliance gate
  PART H — Landlord portal (settings, listings, applicant review, self-execution)
  PART I — Broker dashboard + Stripe Connect onboarding
  PART J — RBIT internal admin console
  QUICK FIXES — broker portal shell, listings page background wash
  PART L — Rental application intake + rules-based match score
  PART K — Evidence and reporting

## Note on "must be built" items in §ROUTES

The endpoints listed under "Routes that must be BUILT" in §ROUTES
are in-scope build tasks assigned to their corresponding part —
they are not external prerequisites blocking that part. Example:
`/v1/renter/profile` is listed as must-build and is used by G-0 —
build it as part of executing G-0, do not halt waiting for it to
already exist. The same applies to all H/I/J endpoints listed there.
Only the items in F-2 (Certn secrets) and any explicit §18 business
decision are genuine external blockers. If uncertain whether
something is a build task or a real blocker, it is a build task
unless this prompt or the backend §18 list says otherwise.

Similarly, §DESIGN is a build task for Parts G onward — port the
Replit patterns as you build each page, not as a separate
prerequisite phase. Do not halt because "the visual system is not
yet imported" — importing it IS the work of Parts G–J.

## Schema-correct role and org names (confirmed via F-7, use throughout)

This prompt was drafted before the live schema was confirmed.
Wherever role or org-type names below appear anywhere in this
document (§ROUTES, Parts G–J, acceptance criteria), use the RIGHT
column — the LEFT column does not exist as a value and will fail
CHECK constraints.

| As written in this prompt | Actual schema value |
|---|---|
| `landlord_admin` | `landlord` |
| `rbit_super` | `rbit_super_admin` (org_id NULL = platform role) |
| `broker_admin` | `broker_admin` (unchanged — already correct) |
| `rbit_admin` | `rbit_admin` (unchanged — already correct) |
| org.type = 'landlord' | org.kind = 'landlord' (column is `kind`, not `type`) |
| org.type = 'broker' | org.kind = 'brokerage' (value is `brokerage`, not `broker`) |
| org.name | org.display_name |
| party.email (direct column) | resolved via `external_identity_ref` |

Full valid party_role.role CHECK values, for reference:
`renter | landlord | agent | broker | broker_admin | solar_* |
rbit_admin | rbit_support | rbit_super_admin`

If any other role/org field name in this prompt doesn't match what
you find in the live schema, use the live schema and report the
discrepancy — don't halt, don't guess, just remap and note it in
your K-report the same way F-7 did.

---

# §DESIGN — Visual system (from Replit prototype)

The Replit prototype at `artifacts/dwel20-rental-platform/` is the
visual target. Port its design system — do NOT invent a new one.

## Typefaces
  - Display / headings: Space Grotesk (weights 500, 600, 700)
    CSS class: font-display
  - Body: DM Sans (weights 400, 500, 600, 700)
    CSS class: font-sans
  - Monospace / data: DM Mono (weights 400, 500)
    CSS class: font-mono
  - Import: https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap

## Color tokens (HSL, light mode)
  --primary: 158 94% 64%        /* RBIT mint green */
  --primary-foreground: 215 46% 12%
  --secondary: 215 46% 12%      /* near-black, hero panels + landlord sidebar */
  --secondary-foreground: 165 34% 96%
  --background: 165 34% 96%     /* light mint-tinted white */
  --card: 0 0% 100%             /* pure white cards */
  --muted: 164 30% 91%
  --muted-foreground: 215 17% 43%
  --accent: 41 96% 67%          /* warm gold, alerts/warnings */
  --destructive: 0 65% 52%
  --teal: 177 42% 48%           /* secondary accent, link color */

## Layout patterns (port from Replit, do not reinvent)
  - Listing cards: rounded-2xl, property photo with cashback badge
    overlay (top-right, bg-primary, font-mono), property-type tag
    (bottom-left, bg-secondary/85), hover: -translate-y-1 + scale-105 on image
  - Landlord workspace: fixed dark sidebar (bg-secondary, w-64) +
    main content area with warm grid background (dwel-cube-bg-dark class)
  - Section headings: font-mono eyebrow (10px, uppercase, tracking-[.18em],
    text-teal) above font-display title (text-4xl, tracking-[-.06em])
  - Buttons: rounded-xl, primary = bg-primary text-secondary with
    shadow-[0_8px_20px_hsl(var(--primary)/.18)]
  - Cards: rounded-2xl border border-border bg-card, subtle shadow
  - Background: dwel-cube-bg class (isometric cube pattern via CSS gradients)
  - Empty states: rounded-2xl dashed border, compass icon, centered copy
  - Skeleton loading: rounded-2xl bg-muted animate-pulse, 3-column grid

## Component patterns to reuse from Replit source
  Path: whatever F-6 reports as the located reference repo, subpath
  to the frontend package (likely artifacts/dwel20-rental-platform/src
  or similar — confirm via F-6, don't assume).

  Within that package's App.tsx, reuse these patterns:
  - ListingCard (property photo, cashback badge overlay, property-type tag)
  - TenantHeader with notification dropdown
  - LandlordShell with dark sidebar nav
  - SectionHeading with font-mono eyebrow above font-display title
  - QueryState for loading/error/empty states
  - StatusPill for listing status badges
  - Button variants: primary, outline, ghost, dark, soft
  - Field component for form inputs

  These were identified by name/purpose, not fixed line numbers,
  since the exact file may shift slightly once added to this repo.
  Find the matching components by their JSX structure and function
  name — they're straightforward to locate in a ~320-line App.tsx.

  If the reference repo is not found or these components aren't
  present in the form described: do not halt. The color tokens,
  typefaces, and layout patterns already spelled out above in
  §DESIGN are sufficient on their own to build every page in this
  prompt. The file reference is a convenience, not a dependency.

## What NOT to port from Replit reference repo

The reference repo contains multiple packages — only the tenant/
landlord frontend UI (the one with routes like /listings, /apply,
/landlord) is the design target. Specifically excluded:

  - `api-server` package (if present) — this is a mock Express server
    with hardcoded mock data. Do NOT port its routes, its mock-data.ts,
    or use it as a reference for the real backend contract. The real
    backend contract is §ROUTES above, confirmed against the actual
    deployed AWS backend, not this mock server.
  - `rbit-ops-console` package (if present) — this is a separate
    internal economics calculator tool, unrelated to the admin
    console being built in Part J. Do not confuse the two or port
    its patterns into J.
  - `mockup-sandbox` package (if present) — unrelated scratch work.
  - The hardcoded "Jordan Reed" user — use real auth
  - The fake card input in any Apply page — use real Stripe Elements
  - The "Dwel guide" 3-step chat — replace with form-based onboard
    (the chat was a Replit demo, not a product decision)

Only port: visual design tokens, typography, color system, layout
patterns, and component structure/JSX patterns from the tenant/
landlord frontend package. Never port its data layer, its mock
server, or its auth stand-in.

---

# §ROUTES — Backend route contract (from Part F findings)

The deployed backend is at CloudFront → ALB/ECS. These are the
CONFIRMED routes. Use these exact paths — do not rename.

## Routes that exist and work
  POST /v1/auth/magic-link        → 200 {ok, message, redeem_token (DEV)}
  POST /v1/auth/redeem             → 200 {session_id, party_id}
  GET  /v1/auth/me                 → current session
  POST /v1/auth/logout             → end session
  GET  /v1/listings                → 200 {listings[], pagination}
  GET  /v1/listings/{id}           → 200 {listing}
  POST /v1/applications            → 201 {application_id, status, access_token}
  GET  /v1/applications/{id}       → 200 {application_id, status, screening}
  POST /v1/applications/{id}/consent → 201 {consent_id}
  POST /v1/landlord/listings       → create listing (auth required)
  POST /v1/landlord/listings/{id}/status → update listing status only
  GET  /v1/landlord/listings       → list landlord's own listings
  GET  /v1/broker/overview         → broker balance read

## Routes that must be BUILT (do not exist yet)
  GET  /v1/renter/profile          → renter profile read
  POST /v1/renter/profile          → renter profile create/update
  PUT  /v1/landlord/listings/{id}  → full listing update (not just status)
  GET  /v1/landlord/listings/{id}/applicants → applicant list per listing
  POST /v1/landlord/listings/{id}/applicants/{app_id}/decision
                                    → approve/decline with contact_revealed_at
  GET  /v1/landlord/settings       → org settings (screening_mode etc)
  PUT  /v1/landlord/settings       → update org settings
  POST /v1/landlord/self-execution → submit evidence
  GET  /v1/landlord/self-execution → get submission status
  POST /v1/stripe/connect/account  → create Express account for org
  GET  /v1/stripe/connect/account  → account status
  POST /v1/stripe/connect/onboarding-link → Stripe onboarding URL
  GET  /v1/stripe/connect/dashboard-link  → Stripe dashboard URL
  GET  /v1/admin/users             → list all parties (admin)
  GET  /v1/admin/orgs              → list all orgs (admin)
  PUT  /v1/admin/orgs/{id}/flags   → toggle per-org feature flags
  GET  /v1/admin/config/consent    → read consent copy config
  PUT  /v1/admin/config/consent    → update consent copy config (super only)
  GET  /v1/admin/integrations/certn → Certn status dashboard
  GET  /v1/admin/reviews/self-execution → review queue
  POST /v1/admin/reviews/self-execution/{id}/decision → verify/reject
  GET  /v1/admin/config/flags      → list all feature flags
  PUT  /v1/admin/config/flags/{name} → toggle global flag
  GET  /v1/admin/audit             → audit log (filterable, paginated)
  GET  /v1/broker/performance      → broker dashboard summary (window param: 30/60/90)
  GET  /v1/broker/performance/leads → paginated lead history
  GET  /v1/broker/performance/submarkets → submarket breakdown

## Schema note
  The consent table is `screening_consent` (migration 0048), NOT
  `consent_record`. Use `screening_consent` throughout.

---

# §PRICING — State-keyed screening fee

The screening fee is NOT a single global number.
Build it as a config map: `screening_fee_by_state`.

  Default (all states unless overridden): 2900 cents ($29)
  NY override: 2000 cents ($20) — capped by RPL §238-a

  Config shape:
  {
    "default_cents": 2900,
    "state_overrides": {
      "NY": { "max_cents": 2000, "note": "RPL §238-a cap" }
    }
  }

  The frontend reads the applicable fee from this config based on
  the applicant's state (from renter profile or listing state).
  Display the correct amount on the consent/payment screen.

  If the applicant's state has an override with max_cents < default_cents,
  use max_cents.

  The $29 screening fee is nonrefundable but CREDITED toward first
  month's rent if the applicant is placed via dwel.20.

---

# PART F — STATUS CHECK

Before writing any code, confirm and report all of the following.
Halt and report if any item contradicts assumptions in Parts G–K.

## F-1 — Backend routes
For each route in §ROUTES "exists and works": call it, paste HTTP
status and response shape. If any fails, halt.

## F-2 — Certn credentials
  Run: aws secretsmanager describe-secret for both:
    arn:aws:secretsmanager:us-east-2:941612827888:secret:rbit-dev/certn-api-key-KCuxLc
    arn:aws:secretsmanager:us-east-2:941612827888:secret:rbit-dev/certn-webhook-secret-GrL7Tb
  Report VersionIdsToStages. If AWSCURRENT missing: report and continue.
  Do NOT populate secrets.

## F-3 — Stripe Connect
  Confirm Stripe secret key populated (rbit-dev/stripe-secret-key).
  Confirm Connect active: list connected accounts via Stripe API.

## F-4 — Schema tables
  Confirm exist: party, org, party_role, listing, application,
  screening_consent, screening_order, renter_profile, landlord_interest,
  broker_performance, ledger_account, ledger_transaction, ledger_entry

## F-5 — Frontend framework
  Report: framework, routing, styling, auth integration, deploy target.
  Current expectation: Vite React SPA, HashRouter, global CSS, cookie auth, CloudFront.

## F-6 — Replit design reference availability
  The Replit prototype repo has been added to this project for
  design reference. Locate it (search the repo tree for a folder
  containing App.tsx with routes like /listings, /landlord,
  /apply/:id — the dwel.20 rental platform prototype). Report the
  path you find it at.

  If found: use that exact path for all §DESIGN component references
  below (ListingCard, TenantHeader, LandlordShell, etc.) instead of
  the placeholder path written in this prompt.

  If not found: proceed using the written §DESIGN spec (colors,
  fonts, layout patterns) — not a blocker, just report it.

Produce a status table. Halt for Michael's review before Part G.

## F-7 — Seed test accounts (prerequisite for E2E testing in H/I/J)

Fresh magic-link parties have `roles: []` — there is no way to test
the landlord or broker portals end-to-end without role/org grants.
Build a seed script (not manual SQL — this should be re-runnable
and checked into the repo as scripts/seed-test-accounts.ts or
equivalent) that does the following:

  1. For email `info@rbitfinancial.com`:
     - Create party if not exists (via magic-link flow or direct insert)
     - Create org `RBIT Financial` (type: landlord) if not exists
     - Create org `RBIT Financial Brokerage` (type: broker) if not exists
     - Grant party_role: landlord_admin on the landlord org
     - Grant party_role: broker_admin on the broker org

  2. For email `michaeldcnao@gmail.com`:
     - Create party if not exists
     - Grant party_role: rbit_super (org_id null or platform-level,
       whichever the schema uses for platform roles — check the
       party_role table constraints and report which pattern applies)

  3. Run the script against the dev database and confirm via query:
     SELECT party.email, party_role.role, org.name, org.type
     FROM party_role
     JOIN party ON party.id = party_role.party_id
     JOIN org ON org.id = party_role.org_id
     WHERE party.email IN ('info@rbitfinancial.com', 'michaeldcnao@gmail.com');

  4. Report the query output as evidence.

This is a build task, not a manual SQL request — write it as a
proper idempotent seed script since it will need to run again in
staging/production with different accounts.

### F-7 acceptance criteria
- [ ] Seed script is idempotent (safe to re-run, does not duplicate orgs/roles)
- [ ] info@rbitfinancial.com has landlord_admin AND broker_admin roles
- [ ] michaeldcnao@gmail.com has rbit_super role
- [ ] Query output confirms all grants, pasted as evidence
- [ ] Script checked into repo, not run as one-off manual SQL

---

# PART G — RENTER-FACING FLOW

## G-0 — Applicant onboarding

### Page: /onboard

Single-page form (NOT a chat widget — the Replit guide was a demo pattern).
Collect:
  - Full legal name (first, last) — required
  - Phone number — required (E.164 on submit)
  - Email — required (also used for magic-link auth)
  - Annual gross income — required, stored as annual_income_cents
  - Move-in urgency: dropdown
      'immediate' | 'within_30_days' | 'within_60_days' |
      'within_90_days' | 'flexible'
  - Desired bedrooms (min) — required
  - Desired rent max (monthly dollars) — required, stored as rent_max_cents
  - State — required (drives NY compliance gate and fee calculation)
  - Has pets — boolean toggle
  - Household size — integer

On submit:
  1. POST /v1/auth/magic-link with email → creates party if new
  2. POST /v1/renter/profile with all fields
  3. If state = 'NY': redirect to /screening-choice (G-NY)
  4. Else: redirect to /listings

Design notes:
  - One column, generous spacing, no unnecessary section headers
  - Income helper text: "Before taxes. Landlords see an income band,
    not your exact number."
  - Use DM Sans body, Space Grotesk for the page title
  - Follow the Replit Field component pattern (rounded-xl inputs,
    focus:border-primary focus:ring-4 ring-primary/15)

### Acceptance criteria
- [ ] All required fields enforced client + server
- [ ] Email format validated
- [ ] Phone formatted E.164
- [ ] Profile created and linked to party (GET /v1/renter/profile confirms)
- [ ] Returning user → redirect to /sign-in
- [ ] State field captured and persisted (needed for G-NY and fee calc)

---

## G-1 — Listing browse

### Page: /listings

Port the Replit Listings component design (App.tsx line 189):
  - City pills (configurable list, not hardcoded to Austin/Boston/Miami)
  - Search bar with location input + "Search homes" CTA
  - Filter bar: beds & baths, property type, move-in date
  - Sort: "Top cashback" (default) / rent low-high / rent high-low
  - Listing cards using the ListingCard pattern from Replit
  - "X fresh matches today" badge

Consumes GET /v1/listings with query params.

Filter/sort: use whatever the API supports via query params;
client-side filter for anything the API doesn't handle.

Zero results: "No homes match your search. Adjust your filters
or check back — new listings are added daily."

Pagination: infinite scroll or "Load more", not numbered pages.

### Acceptance criteria
- [ ] Listings render from real API, not mock data
- [ ] Filters narrow results — test ≥2 combinations
- [ ] Cashback badge shows per-listing cashback amount
- [ ] Zero-result state displays
- [ ] No auth required to browse
- [ ] Rent displayed as formatted dollars

---

## G-2 — Listing detail + interest signal

### Page: /listings/{id}

Port the Replit detail page design. Consumes GET /v1/listings/{id}.

Display: full address, rent, beds/baths/sqft, available date,
description, amenities, photo gallery, property type, pets policy.

Primary CTA: **"I'm interested"**
  - Authenticated renter: POST /v1/applications with listing_id
  - Before firing: check for valid screening report on file
    (see G-NY for NY-specific gate — non-NY applicants skip this)
  - Unauthenticated: redirect to /onboard with return URL

After marking interest: confirmation state replaces CTA.
  "Interest sent. You'll be notified when the landlord responds."

### Acceptance criteria
- [ ] Detail page renders all listing fields
- [ ] Interest creates application record
- [ ] Unauthenticated → onboard → return
- [ ] No duplicate records on double-tap
- [ ] Confirmation state replaces CTA

---

## G-3 — Application status tracker

### Page: /applications

Authenticated renter only. Port the Replit ApplicationStatus design
(timeline with step dots, cashback confirmation card).

Status mapping:
  | Backend status | Display |
  |---|---|
  | awaiting_landlord_interest | "Waiting for landlord review" |
  | mutual_interest | "Landlord interested — screening next" |
  | awaiting_consent | "Complete your screening" |
  | screening_in_progress | "Background check in progress" |
  | screening_complete | "Results ready — landlord reviewing" |
  | approved | "Approved" |
  | declined | "Not selected" |
  | withdrawn | "Withdrawn" |

If status = awaiting_consent: inline CTA to G-4.
If approved: cashback confirmation card (Replit pattern).
If declined: generic copy only, NEVER reveal reason.

### Acceptance criteria
- [ ] All statuses map to display text
- [ ] Consent CTA for awaiting_consent only
- [ ] Declined shows generic text
- [ ] Timeline progress indicator matches current status
- [ ] Empty state with link to /listings

---

## G-4 — Consent + payment

### Page: /applications/{id}/consent

Only reachable when status = awaiting_consent.

### Step 1: FCRA consent
Consent copy from config key (consent_copy.fcra_one_time_use).
Placeholder text clearly flagged with yellow background + [PLACEHOLDER] prefix.
Checkbox: "I have read and agree" — must be manually checked.

### Step 2: Payment
Stripe Elements (CardElement or PaymentElement).
Amount from state-keyed config: screening_fee_by_state.
Display: "Pay $XX and submit" (XX = applicable state fee).
Below: "This fee is credited toward your first month's rent
if placed through dwel.20."

On success:
  1. POST /v1/applications/{id}/consent
  2. Backend triggers screening
  3. Redirect to /applications with updated status

On failure: show Stripe error, do NOT submit consent, retry available.
Consent + payment are atomic — no consent without payment.

Ledger entries:
  Debit: applicant_screening_fee ({fee} cents)
  Credit: rbit_screening_revenue ({fee} cents)

### Acceptance criteria
- [ ] Consent text from config, not hardcoded
- [ ] Checkbox not pre-checked
- [ ] Payment amount from state-keyed config
- [ ] Stripe success → consent submitted → status updates
- [ ] Stripe failure → no consent, error shown, retry
- [ ] Atomic: no consent without payment
- [ ] Placeholder text visually flagged
- [ ] Correct fee displayed for applicant's state

---

# PART G-NY — NEW YORK COMPLIANCE GATE

## G-NY-1 — Screening choice screen

### Page: /screening-choice

Triggered for NY-state applicants:
  - After onboarding (G-0 redirect)
  - Before "I'm interested" click if no valid report on file
  - When a previously valid report has expired (30-day window)

Two paths:

### Path 1: Upload your own report
  - File upload (PDF, image) + completion date field
  - Completion date must be within 30 days of upload
  - Stored with report_source: 'applicant_supplied'
  - On success: applicant can browse and click "I'm interested"
    without any payment gate

### Path 2: Purchase through RBIT
  - Same as G-4 but with NY-capped fee (≤$20 from config)
  - Tagged interim_v1 on compliance status per NY spec section 5
  - Internal note: "Path 2 compliance is interpretive, pending
    Jacob's legal review. Path 1 implements statute directly."

### Data model additions
  On screening_order or a new screening_report table:
  - report_source: enum 'applicant_supplied' | 'applicant_purchased' | 'landlord_ordered'
  - completed_at: timestamptz (for 30-day freshness, distinct from created_at)
  - state_jurisdiction: text (the state whose rules apply)

### Interest-click gate (all states, but only NY has the upload path)
  Before POST /v1/applications:
  1. Check renter profile state
  2. If NY: check for valid report (exists + completed_at within 30 days)
     - Valid → proceed
     - Missing/expired → redirect to /screening-choice
  3. If non-NY: no pre-check required (screening happens post-mutual-interest)

### Acceptance criteria
- [ ] NY applicants see choice screen after onboarding
- [ ] Path 1 upload validates 30-day freshness
- [ ] Path 1 upload stores report_source = 'applicant_supplied'
- [ ] Path 2 displays NY-capped fee from config
- [ ] Path 2 tagged interim_v1 in code and UI
- [ ] Interest click blocked if NY + no valid report
- [ ] Expired report re-triggers choice screen
- [ ] Non-NY applicants never see this screen
- [ ] 30-day check evaluated at click time, not upload time

---

# PART H — LANDLORD PORTAL

## H-0 — Screening mode toggle

### Page: /landlord/settings

  Screening mode: 'auto_screen' (default) | 'manual_review'
  - Auto: mutual interest → screening triggers automatically
  - Manual: mutual interest → landlord prompted to review before triggering

  Stored as org setting. Backend checks at mutual-interest detection.

### Acceptance criteria
- [ ] Toggle persists across sessions
- [ ] Default auto_screen for new orgs
- [ ] Only landlord_admin → 403 for others

---

## H-1 — Listing management

### Page: /landlord/listings

Port the Replit LandlordListings design (line 289):
  - Card grid with property photo, status pill, rent badge, vacancy days, applicant count
  - "Add listing" button → create form
  - Per-listing: Edit, View applicants, Mark as rented

Create/Edit form: address, unit, rent (stored as cents), beds, baths,
sqft, available date, pets, description, amenities, photos (S3 — required,
halt if S3 upload adapter is not functional), submarket, status (draft/active).

Consumes: POST /v1/landlord/listings, PUT /v1/landlord/listings/{id},
GET /v1/landlord/listings

### Acceptance criteria
- [ ] RLS confirmed — landlord sees only own org's listings
- [ ] Create produces new row retrievable via GET
- [ ] Draft not visible on public /listings
- [ ] Active visible on public /listings
- [ ] Photo upload works via S3 — confirm upload + retrieval round-trip
- [ ] Rent stored as integer cents

---

## H-2 — Applicant review queue

### Page: /landlord/listings/{id}/applicants

Port the Replit LandlordApplicants design (line 297) but with
CRITICAL modifications for the contact-masking rule:

### Pre-approval view (ALWAYS — regardless of screening status)
  Show ONLY allowlist fields:
  - Score band (not exact score — map Replit's numeric score to band)
  - Income band (not exact income)
  - Move-in window
  - Household size, has_pets
  - Screening summary: credit (clear/records), criminal (clear/records),
    eviction (clear/records), identity (verified/not)
  - Application date, current status

  NEVER show in pre-approval state: name, email, phone, DOB, address, exact income.

### Screening mode behavior
  If org screening_mode = 'manual_review' AND status = awaiting_landlord_interest:
  - CTA: "Request screening" → sends consent request to applicant
  - CTA: "Pass" → status = landlord_passed

  If screening_mode = 'auto_screen': applicants arrive at awaiting_consent or later.

### Post-screening actions (status = screening_complete)
  - **"Approve"** → status = approved
    - ONLY NOW: reveal name, email, phone
    - Write contact_revealed_at timestamp (server-side)
    - Emit domain_event: applicant_approved
  - **"Decline"** → status = declined
    - No contact info revealed
    - Backend handles FCRA adverse-action
  - **"Request more info"** → text field for landlord question
    (notification or in-platform message — interim_v1 if no messaging)

### Post-approval expanded card
  Full name, email, phone visible.
  "Contact revealed on [date]" audit line.
  "Next steps: coordinate lease execution with your broker or
  directly if you hold a license in this state."

### Acceptance criteria
- [ ] Pre-approval: name/email/phone NOT in DOM — test via inspection
- [ ] Manual-review: "Request screening" CTA visible; auto: not visible
- [ ] Approve reveals contact info + writes contact_revealed_at
- [ ] Decline does NOT reveal contact info
- [ ] No duplicate decisions on double-click
- [ ] Scoped to listing (not all org applicants)
- [ ] contact_revealed_at is server-side timestamp

---

## H-3 — Self-execution evidence

### Page: /landlord/settings/self-execution

Evidence submission form:
  - State of licensure (dropdown)
  - License type: 'licensed_broker' | 'licensed_pm' | 'owner_occupant'
  - License number (hidden for owner_occupant)
  - Business entity name (if entity-held)
  - Supporting documentation (file upload)

Status lifecycle: pending → verified | rejected
All verification is manual (admin queue in J-4). No auto-verification.
Entire flow tagged interim_v1.

Internal admin banner (visible to rbit_admin/super only):
  "⚠ Self-execution criteria are interim_v1 — pending Jacob's sign-off."

### Acceptance criteria
- [ ] License_number hidden for owner_occupant
- [ ] File upload works
- [ ] Pending blocks re-submission
- [ ] Rejected allows re-submission
- [ ] interim_v1 tag in code/config
- [ ] Admin banner visible to admin only

---

# PART I — BROKER DASHBOARD + STRIPE CONNECT

## I-0 — Per-org payout gate

Feature flag: broker_payouts_enabled (per-org, default false).
All money-movement UI checks this flag.
If false: "Payouts available once licensing is finalized."

## I-1 — Performance dashboard

### Page: /broker/dashboard

Build the backend endpoints (GET /v1/broker/performance,
/leads, /submarkets) if they do not already exist, then render
with real data. No mock fallbacks — all production.

Summary cards: leads offered, accepted, placements closed,
median response time, EV per lead, leakage rate.
Window selector: 30/60/90 days.
Submarket breakdown table.

## I-2 — Lead history

### Page: /broker/leads

Table: lead ID, RS tier, fee, offered date, status, placement outcome.
Filters: status, date range. Server-side pagination, 25/page.

## I-3 — Stripe Connect onboarding

### Page: /broker/settings/payments AND /landlord/settings/payments

If Connect active (F-3):
  - Check for existing connected account
  - No account: "Connect your bank account" → create Express account → Stripe onboarding redirect
  - Account exists: show status (active/restricted/pending)

If Connect not active (F-3 reports inactive): halt and report.
Connect was confirmed active in prior F-check — this should not happen.

Account creation allowed regardless of broker_payouts_enabled
(so orgs can complete onboarding before payouts are turned on).

### Acceptance criteria
- [ ] Dashboard renders with real data from production endpoints
- [ ] Stripe onboarding redirects to Stripe and returns
- [ ] broker_payouts_enabled=false → payout UI hidden, dashboard visible
- [ ] Flag is per-org, not global

---

# PART J — RBIT INTERNAL ADMIN CONSOLE

All /admin/* pages require party_role = rbit_admin or rbit_super.
Functional and clear — information density over visual polish.
Same brand system, utilitarian layout.

## J-1 — User and org management (/admin/users, /admin/orgs)
  - User list: searchable, role assignment (rbit_super only)
  - Org list: Stripe Connect status, self-execution status,
    broker_payouts_enabled toggle (rbit_super only)

## J-2 — Consent copy configuration (/admin/config/consent)
  rbit_super only. Read/edit consent copy from config key.
  Change log with previous text, author, timestamp. Preview button.

## J-3 — Certn status dashboard (/admin/integrations/certn)
  Read-only: secret ARN (masked), AWSCURRENT status, feature gate,
  last screening order, failed screenings (7 days). No secret editing.

## J-4 — Self-execution review queue (/admin/reviews/self-execution)
  Table of evidence records. Filter by status (pending default).
  Verify (with interim_v1 warning in confirm dialog) or reject (requires notes).

## J-5 — Feature flag management (/admin/config/flags)
  rbit_super only. Known flags: broker_payouts_enabled (per-org),
  certn_screening_enabled (global), stripe_connect_enabled (global),
  self_execution_review_enabled (global), ny_path2_enabled (global, interim_v1).
  Change log on every toggle.

## J-6 — Audit log viewer (/admin/audit)
  Events: consent_submitted, contact_revealed, screening_ordered,
  screening_completed, role_assigned, flag_toggled, config_updated,
  self_execution_reviewed, ny_report_uploaded.
  Filters: event type, date range, party_id, org_id.
  CSV export. No PII in log rows — party_id/org_id references only.

### Admin acceptance criteria
- [ ] All admin pages 403 for non-admin roles
- [ ] rbit_admin: read + review queue actions
- [ ] rbit_super: all write operations (config, flags, role assignment)
- [ ] Consent copy editable without deploy
- [ ] Audit log CSV export matches filtered view
- [ ] Self-execution verify shows interim_v1 warning

---

# QUICK FIXES — before Part L, apply these two corrections

## QF-1 — Broker portal shell

The broker portal (/broker/*) is functionally correct (Stripe Connect
account status, BOR-gating messaging, prepaid balance all display
accurately) but is rendering as plain stacked text links with no
visual structure — it never received the shell rebuild that H-0 gave
the landlord portal. Apply the exact same dark §DESIGN sidebar shell
component used for /landlord/* to /broker/* — same component, not a
reimplementation. Confirm both portals share one shell component
after this fix, not two near-duplicate ones.

## QF-2 — Listings page background wash

On /listings, the cube-pattern background (dwel-cube-bg) currently
terminates at the bottom of the filter section — listing cards below
it sit on flat white instead of continuing over the pattern like the
Replit reference. Extend the background element's container to cover
the full page/section height, not just the hero+filter div, so cards
render on top of the pattern rather than below it.

---

# PART L — RENTAL APPLICATION INTAKE + MATCH SCORE

Two gaps identified against the documented product architecture:
(1) no full rental application exists beyond the thin onboarding
profile from G-0, and (2) no pre-filter/match score exists to help
landlords triage applicants, despite both being part of the
documented user journey ("Applicant submits intake via the renter
intake system" → "AI/rules-based pre-filter screens applicant before
triggering costly Plaid verification calls").

IMPORTANT CONSTRAINT: item 13 of the DO NOT ATTEMPT list prohibits
real ML scoring until sufficient placement-outcome label data exists.
The match score built here MUST be a transparent, rules-based
weighted formula — not a trained model, not an external ML API call.
Tag it `rules_based_v1` everywhere it appears (code, API response,
UI) so it is never later mistaken for a trained model.

## L-0 — Design reference additions (from Replit)

Port two additional patterns found in the Replit reference repo:
  - Loading/transition state: friendly branded loading animation
    (Replit's frog "Hopping to the next home" — port the pattern of
    a branded, on-theme loading state, not necessarily the frog
    illustration itself unless it's already in the reference repo's
    assets). Use for any multi-second async action (search, apply,
    payment processing).
  - Owner dashboard density pattern: the Replit landlord Overview
    page (stat cards with trend %, "Portfolio pulse" status table,
    "Latest applicants" list with match score badges, actionable
    alert card e.g. "One listing needs attention") is a stronger
    reference for /landlord (Overview) than what H-0 currently
    ships. If H's Overview page is materially thinner than this,
    bring it up to this density — real data only, no fabricated
    stats.

## L-1 — Full rental application form

### Page: /applications/new/{listing_id} or /apply/{listing_id}

Reachable from the listing detail page's "I'm interested" flow —
replaces firing an interest signal off the thin onboarding profile
alone. Full application collects:

  - Confirm/edit contact info (from renter profile, editable)
  - Current address, move-in date at current address (duration)
  - Employer name, job title, employer phone, length of employment
  - Monthly gross income (may already exist from G-0 — carry forward,
    allow edit)
  - Additional occupants (name, relationship, age band — not exact DOB)
  - Pets (species, breed, weight — carry forward has_pets from G-0,
    expand detail here)
  - Emergency contact or reference (name, relationship, phone)
  - Vehicle info (optional — make/model/plate, if landlord requires
    parking assignment)

On submit: creates/updates the `application` record with these
fields (extend the application or a new `application_detail` table —
check the live schema and use whichever pattern is more consistent
with existing columns; report which you chose).

This form is a ONE-TIME fill per applicant (not per-listing) — once
completed, subsequent "I'm interested" clicks on other listings reuse
the stored application details, with an option to review/edit before
each submission. Do not force a full re-fill per listing.

### Acceptance criteria
- [ ] Form collects all fields listed above
- [ ] First-time interest click routes here before creating the
      interest/application record
- [ ] Subsequent interest clicks on other listings reuse stored
      details with an edit-before-submit option, not a forced re-fill
- [ ] All fields persisted and retrievable via GET /v1/renter/applications
- [ ] Existing G-0 profile fields (income, move-in window, pets)
      carry forward as pre-filled, editable values — not re-asked
      from scratch

## L-2 — Rules-based match score

### Backend: match score calculation

Compute at application-submission time (and recompute if listing or
applicant data changes before landlord review). Formula (weighted,
0–100 scale) — build exactly this, do not invent a different formula
without flagging it as a change:

  - Income-to-rent ratio (40% weight): applicant's monthly gross
    income ÷ listing rent. 3x+ = full points, scaling down linearly
    to 0 points at 2x or below.
  - Move-in date fit (25% weight): how closely applicant's stated
    move-in urgency matches the listing's available date. Exact
    match window = full points, scaling down for mismatch.
  - Application completeness (20% weight): percentage of L-1 fields
    filled in (not left blank/optional-skipped).
  - Profile tenure signal (15% weight): time since renter profile
    was created — a very fresh account (same-day signup + apply)
    scores lower than an account with some history, as a light
    fraud/spam signal. Do not treat this as a hard filter, just a
    minor weighted input.

Store as `match_score_value` (integer 0–100) and
`match_score_version: 'rules_based_v1'` on the application record.
Recalculate does not overwrite history — keep prior score + version
if you want an audit trail, or at minimum log recalculation events.

### Where it surfaces
  - H-2 applicant review queue: show the score as a badge on each
    applicant card (matching the Replit pattern — number badge,
    color-coded band: 80+ green, 50-79 amber, below 50 neutral/gray).
    This is allowlist-safe — a score is not PII and can show
    pre-approval same as income/score bands already do.
  - Landlord Overview (L-0 dashboard density work): "Latest
    applicants" list shows name only post-approval per H-2's existing
    contact-masking rule — pre-approval, show score + listing only,
    no name. Adjust the Replit pattern accordingly since Replit's
    demo shows names in that list, which conflicts with contact
    masking — use applicant initials or a masked identifier instead
    of full name pre-approval.

### Acceptance criteria
- [ ] Score computed and stored on application record
- [ ] Formula matches spec above exactly, or discrepancy is flagged
- [ ] Tagged `rules_based_v1` in API response and UI (tooltip or
      small label — not hidden, but not alarming either)
- [ ] Score badge appears in H-2 applicant queue, color-banded
- [ ] Pre-approval display never shows applicant name alongside
      score (masking rule from H-2 still applies)
- [ ] No real ML/external scoring API called anywhere in this part

---



## K-1 — Route inventory table
| Route | Role | Backend endpoint(s) | Status |

## K-2 — Per-criterion acceptance report
PASS / FAIL / PARTIAL with evidence for EVERY criterion in G through L,
plus QF-1 and QF-2.
Evidence = screenshot, HTTP response, or DOM inspection.
Do not summarise. Do not aggregate.

## K-3 — Backend endpoints created
List every new endpoint built. Method, path, auth, request/response shape,
test count.

## K-4 — interim_v1 inventory
| Feature | Reason | Resolves when |

## K-5 — What is NOT done and why

---

# DO NOT ATTEMPT LIST

  1. Lease execution automation (BOR-dependent — manual for v1)
  2. Automated approve/decline decisions (always human landlord)
  3. FCRA adverse-action notice generation (backend + Jacob sign-off)
  4. Broker commission calculation or payout execution (behind flag)
  5. Certn secret population (Michael does this via CLI)
  6. Real FCRA consent copy (placeholder until Jacob)
  7. State-specific self-execution rules (interim_v1 until Jacob)
  8. In-platform messaging system (interim_v1 where referenced)
  9. Email delivery for non-dev environments
  10. Branded DNS / ACM certificate provisioning
  11. Auto-verification of landlord licenses via state APIs
  12. Cashback ACH disbursement (fires at lease execution)
  13. Trained/real ML scoring (gated on label coverage) — the
      rules-based match score in Part L is explicitly NOT this;
      it is a transparent weighted formula, not a model
  14. Rent payment portal (money-transmitter questions unresolved)
  15. NY Path 2 sub-$20 vendor finalization (separate workstream)
  16. AI-powered chat onboarding (the Replit "Dwel guide" was a demo)