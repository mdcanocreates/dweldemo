# RBIT — dwel.20 frontend surfaces + screening integration + admin console
# This prompt builds the user-facing application on top of existing backend routes.
# Target: demo-ready across all four surfaces within 2 weeks of this prompt.

All §0 operating rules from the backend spec remain binding.
All §18 open decisions remain halt conditions — do not resolve in code.
Report criterion-by-criterion with evidence. Do not summarise.

This prompt has five parts executed in strict order:
  PART F — Status check (gate: confirm what exists before building on it)
  PART G — Renter-facing application flow
  PART H — Landlord portal (listing management + applicant review)
  PART I — Broker dashboard + Stripe Connect onboarding
  PART J — RBIT internal admin console

Brand system (already established — do not deviate):
  - Primary green: #4dfa9f
  - Palette: forest/mint tones on light backgrounds
  - Typefaces: Bricolage Grotesque (display), Figtree (body)
  - Layout: editorial, generous whitespace, left-aligned prose
  - No all-caps labels. No numbered markers unless content is a real sequence.
  - Sentence case everywhere. Active voice on all CTAs.
  - Empty states are invitations to act, not apologies.

Money conventions: integer cents with `_cents` suffix.
Timestamps: `_at` suffix. Booleans: `is_`/`has_` prefix.
snake_case in backend, camelCase in frontend JS/TS props.

---

# PART F — STATUS CHECK

Before writing any code, confirm and report all of the following.
Halt and report if any item contradicts what is assumed in Parts G–J.

## F-1 — Existing backend routes

Confirm the following API routes exist and respond correctly.
For each: call it, paste the HTTP status and response shape.
If a route does not exist, halt — Parts G–J depend on it.

  1. POST /v1/auth/magic-link (request magic link)
  2. POST /v1/auth/redeem (redeem magic link token)
  3. GET /v1/listings (public listing browse)
  4. GET /v1/listings/{id} (single listing detail)
  5. POST /v1/listings (create listing — landlord auth required)
  6. PUT /v1/listings/{id} (update listing — landlord auth required)
  7. POST /v1/applications (anonymous application submission)
  8. GET /v1/applications/{id} (application status — applicant auth)
  9. POST /v1/consent (consent submission — FCRA gate)
  10. GET /v1/renter/profile (renter profile read)
  11. POST /v1/renter/profile (renter profile create/update)

If any route exists under a different path, note the correct path and
use it throughout the rest of this prompt. Do not rename routes.

## F-2 — Certn integration status

  1. Run: aws secretsmanager describe-secret --secret-id <CERTN_SECRET_ARN>
     Paste the output. Confirm whether VersionIdsToStages contains AWSCURRENT.
  2. If AWSCURRENT exists: confirm the app can read the secret at boot
     (check ECS task logs for the Certn feature gate status).
  3. If AWSCURRENT is missing: report the exact secret ARN and stop.
     Do NOT attempt to populate the secret — Michael will do this manually.

## F-3 — Stripe Connect status

  1. Confirm the Stripe secret key is populated in Secrets Manager
     (same describe-secret check).
  2. Confirm whether Stripe Connect is enabled on the platform account:
     run a Stripe API call to list connected accounts. If the call
     succeeds (even with zero results), Connect is active.
  3. If Connect is not active, report and continue — Part I will build
     the onboarding flow but gate the actual Connect calls behind a
     feature flag.

## F-4 — Database schema check

  Confirm these tables exist (they should from prior migrations):
  - party, org, party_role, listing, application, consent_record,
    screening_order, renter_profile, landlord_interest,
    broker_performance, ledger_account, ledger_transaction, ledger_entry

  For any missing table, halt — the migration history is broken and
  must be fixed before frontend work begins.

## F-5 — Frontend framework check

  Confirm the current frontend setup:
  - Framework (Next.js / React / other)
  - Routing strategy (app router / pages router / SPA)
  - Styling approach (Tailwind / CSS modules / styled-components)
  - Auth integration (how magic-link session is stored client-side)
  - Deployment target (CloudFront / Vercel / other)

  Report the exact setup. Do not change frameworks.

## F-6 — Report

Produce a status table:

| Check | Status | Evidence |
|---|---|---|
| F-1.1 magic-link | PASS / FAIL | HTTP status |
| F-1.2 redeem | PASS / FAIL | HTTP status |
| ... | ... | ... |
| F-5 frontend framework | REPORTED | framework, router, styling |

Halt and wait for Michael's review before proceeding to Part G.

---

# PART G — RENTER-FACING APPLICATION FLOW

## G-0 — Applicant onboarding (profile creation)

### Page: /onboard

An applicant who lands on dwel.20 for the first time creates a profile
before they can browse or apply. This is a single-page form, not a
multi-step wizard. Collect:

  - Full legal name (first, last) — required
  - Phone number — required
  - Email — required (also used for magic-link auth)
  - Annual gross income — required (used for affordability matching)
  - Move-in urgency: enum dropdown
      'immediate' | 'within_30_days' | 'within_60_days' |
      'within_90_days' | 'flexible'
  - Desired bedrooms (min) — required
  - Desired rent max (monthly, dollars) — required
  - Target submarket(s) — multi-select from available submarkets
  - Has pets — boolean toggle
  - Household size — integer

On submit:
  1. POST /v1/auth/magic-link with email → creates party if new
  2. POST /v1/renter/profile with all fields
  3. Redirect to /listings (browse)

If the party already exists (returning user): redirect to /sign-in.

### Design notes
- The form must feel fast, not bureaucratic. One column, no fieldsets
  or section headers unless grouping genuinely aids comprehension.
- "Annual gross income" helper text: "Before taxes. Used for
  affordability matching — landlords see an income band, not your
  exact number."
- Move-in urgency uses plain language labels, not enum values.

### Acceptance criteria
- [ ] All required fields enforced client-side and server-side
- [ ] Email format validated before submission
- [ ] Phone number formatted to E.164 on submit
- [ ] Profile created and linked to party — confirmed via GET /v1/renter/profile
- [ ] Returning user with existing party redirected to sign-in
- [ ] Income stored as integer cents (annual_income_cents)
- [ ] Rent max stored as integer cents (rent_max_cents)

---

## G-1 — Listing browse

### Page: /listings

Public page. No auth required to view.
Consumes GET /v1/listings.

Display each listing as a card:
  - Address (street + city, no unit number for multi-unit)
  - Rent (formatted: $X,XXX/mo)
  - Bedrooms / Bathrooms
  - Available date
  - Submarket name
  - Pets allowed indicator
  - Listing photo (placeholder if none)

Filters (client-side or query param, depending on what the API supports):
  - Rent range (min/max slider or two inputs)
  - Bedrooms (1 / 2 / 3 / 4+)
  - Move-in date (before date picker)
  - Submarket (dropdown)
  - Pets allowed (toggle)

Sort options:
  - Rent: low to high (default)
  - Rent: high to low
  - Newest first
  - Available soonest

If zero results: show the search-alert capture form (B-5 flow from
fullSprint.md if that endpoint exists, otherwise a simple
"No listings match — check back soon" with the filter summary).

Pagination: infinite scroll or "Load more" button, not numbered pages.

### Acceptance criteria
- [ ] Listings render from real API data, not hardcoded fixtures
- [ ] Filters narrow results correctly — test with ≥2 filter combinations
- [ ] Zero-result state displays, does not show empty grid
- [ ] Listing card links to /listings/{id}
- [ ] No auth required — unauthenticated user can browse
- [ ] Rent displayed as formatted dollars, not raw cents

---

## G-2 — Listing detail + interest signal

### Page: /listings/{id}

Consumes GET /v1/listings/{id}.

Display:
  - Full address
  - Rent, beds, baths, sqft (if available)
  - Available date
  - Description / amenities
  - Photo gallery (placeholder if none)
  - Submarket name
  - Pets policy
  - Landlord display name (org name, not personal name)

Primary CTA: **"I'm interested"**
  - If authenticated renter: POST to mark interest on this listing
    (POST /v1/applications with listing_id, or the equivalent
    interest-signal endpoint — confirm from F-1)
  - If unauthenticated: redirect to /onboard with a return URL
    back to this listing after profile creation

Secondary CTA: **"Save listing"** (local storage / bookmarks,
  no backend needed for v1)

After marking interest:
  - Confirmation state: "Interest sent to landlord. You'll be notified
    when they respond." No further action available on this listing
    until the landlord acts.
  - Link to /applications to view all active interests/applications

### Acceptance criteria
- [ ] Detail page renders all available listing fields
- [ ] "I'm interested" creates an application/interest record
- [ ] Unauthenticated user redirected to onboard, returns to listing
- [ ] Double-tap on "I'm interested" does not create duplicate records
- [ ] Confirmation state replaces the CTA after interest is marked
- [ ] Page is shareable (direct URL works, SSR or static)

---

## G-3 — Application status tracker

### Page: /applications

Authenticated renter only. Redirect to /sign-in if no session.
Consumes GET /v1/applications (list) or equivalent.

Each application row shows:
  - Listing address + rent
  - Current status, human-readable:
    | Backend status | Display text |
    |---|---|
    | awaiting_landlord_interest | "Waiting for landlord review" |
    | mutual_interest | "Landlord is interested — screening next" |
    | awaiting_consent | "Complete your background check consent" |
    | screening_in_progress | "Background check in progress" |
    | screening_complete | "Results ready — waiting for landlord" |
    | approved | "Approved — next steps below" |
    | declined | "Not selected for this listing" |
    | prescreen_failed | "Application could not proceed" |
    | withdrawn | "Withdrawn" |

  - Date submitted
  - Last updated

If status = 'awaiting_consent':
  Show inline CTA: **"Complete consent & pay $30"**
  This links to the consent + payment flow (G-4).

If status = 'approved':
  Show next-steps copy: "Your landlord has approved your application.
  You'll receive lease details by email." (Placeholder — actual lease
  execution flow is downstream of BOR, do not build it.)

If status = 'declined' or 'prescreen_failed':
  Generic copy only. NEVER reveal the reason for a prescreen failure
  or the specific screening result that led to a decline.

### Acceptance criteria
- [ ] All application statuses map to human-readable text
- [ ] Consent CTA appears only for awaiting_consent status
- [ ] Declined/prescreen_failed show generic text, no specifics
- [ ] Applications sorted by last_updated desc
- [ ] Empty state: "No applications yet. Browse listings to get started." with link to /listings
- [ ] Auth required — unauthenticated user redirected

---

## G-4 — Consent + payment flow

### Page: /applications/{id}/consent

Authenticated renter only. Only reachable when application status =
'awaiting_consent'. Redirect to /applications if status is anything else.

### Step 1: FCRA consent

Display the consent copy from the single config key
(consent_copy.fcra_one_time_use). This is placeholder text until
Jacob signs off on the final language.

Placeholder text (replace with Jacob's approved version before go-live):
  "[PLACEHOLDER — PENDING LEGAL REVIEW]
   By proceeding, you authorize RBIT Financial Inc. to obtain a
   consumer report from Certn for the purpose of evaluating your
   rental application for [listing address]. This authorization is
   for this specific application only and does not authorize future
   reports without your separate consent."

Consent checkbox: "I have read and agree to the above authorization"
Must be checked to proceed. No pre-checked boxes.

### Step 2: Payment ($30 application fee)

After consent checkbox is checked, reveal the payment section.

Stripe Elements embedded payment form:
  - Amount: $30.00 (from config, not hardcoded — config key:
    screening_fee_cents, default 3000)
  - Card input via Stripe Elements (CardElement or PaymentElement)
  - "Pay $30 and submit" button

On successful payment:
  1. POST /v1/consent with application_id, consent_text_hash,
     consented_at timestamp
  2. Backend triggers screening order (Certn API call if AWSCURRENT
     exists, otherwise queues for manual processing — this is the
     backend's responsibility, not the frontend's)
  3. Redirect to /applications with updated status

If Stripe charge fails:
  - Show the Stripe error message
  - Do NOT submit consent — consent and payment are atomic
  - User can retry

### RBIT collects, then pays Certn

The $30 Stripe charge goes to RBIT's account. RBIT pays Certn
separately via Certn's billing (monthly or per-check, per Certn's
billing type for US accounts). The frontend does not need to know
about RBIT→Certn settlement — it only processes the applicant's
$30 charge.

Ledger entries on successful charge:
  - Debit: applicant_screening_fee (3000 cents)
  - Credit: rbit_screening_revenue (3000 cents)
  - Memo: "Screening fee — application {application_id}"

If the applicant is subsequently placed via RBIT:
  - The $30 is credited toward first month's rent
  - This credit is applied at lease-execution time (Part H / downstream),
    not refunded at screening time
  - The frontend shows: "This $30 will be credited toward your first
    month's rent if you're placed through dwel.20."

### Acceptance criteria
- [ ] Consent text sourced from config key, not hardcoded
- [ ] Consent checkbox must be manually checked — not pre-checked
- [ ] Payment amount sourced from config (screening_fee_cents)
- [ ] Stripe charge succeeds → consent submitted → status updates
- [ ] Stripe charge fails → consent NOT submitted, error shown, retry available
- [ ] Consent and payment are atomic — no consent without payment
- [ ] $30 credit-toward-rent copy displayed before payment
- [ ] Ledger entries created with correct amounts and memo
- [ ] FCRA placeholder text is visually flagged as placeholder
    (e.g. yellow background, "[PLACEHOLDER]" prefix) so it is
    impossible to mistake for approved legal copy

---

# PART H — LANDLORD PORTAL

## H-0 — Landlord settings: screening mode toggle

### Page: /landlord/settings

Authenticated landlord_admin only.

Settings form with a single toggle for now:

  **Screening mode**
  - "Automatic" — when you and a renter are mutually interested,
    screening is triggered automatically.
  - "Manual" — when mutual interest is detected, you'll be prompted
    to review the applicant's profile before triggering screening.

  Default: "Automatic" (for new orgs)

  Stored as: org setting key 'screening_mode',
  value 'auto_screen' | 'manual_review'

  The backend checks this value at the point where mutual interest
  is detected to decide whether to auto-fire consent request to
  the applicant or wait for landlord action.

### Acceptance criteria
- [ ] Toggle persists across sessions
- [ ] Default for new orgs is 'auto_screen'
- [ ] Only landlord_admin can access — renter/broker → 403
- [ ] Setting value readable by backend at mutual-interest trigger point

---

## H-1 — Listing management

### Page: /landlord/listings

Authenticated landlord_admin only.
Consumes GET /v1/listings?org_id={landlord_org_id} (or equivalent
scoped endpoint).

### List view

Table or card grid showing all listings owned by this org:
  - Address
  - Rent
  - Status (draft / active / rented / archived)
  - Date created
  - Interested applicants count (integer badge)

CTAs:
  - **"Add listing"** → /landlord/listings/new
  - Per-listing: **"Edit"** → /landlord/listings/{id}/edit
  - Per-listing: **"View applicants"** → /landlord/listings/{id}/applicants

### Create / Edit form: /landlord/listings/new, /landlord/listings/{id}/edit

Fields:
  - Street address — required
  - City, State, ZIP — required
  - Unit number (optional, for multi-unit)
  - Monthly rent ($) — required, stored as rent_cents
  - Bedrooms — required
  - Bathrooms — required
  - Square footage — optional
  - Available date — required
  - Pets allowed — boolean toggle
  - Description — textarea, optional
  - Amenities — multi-select tags or freeform
  - Photos — file upload (up to 10), stored in S3
    If S3 upload is not yet wired, accept the upload UI but store
    locally and flag as interim_v1.
  - Submarket — dropdown from available submarkets
  - Status — draft (default on create) / active (publish)

On save: POST /v1/listings (create) or PUT /v1/listings/{id} (update).

### Mark as rented: /landlord/listings/{id}/mark-rented

If the B-6 leakage endpoint exists (POST /v1/listings/{id}/mark-rented):
  Show a modal asking rented_via (required):
  - "Through dwel.20 placement" → requires placement_id link
  - "Through a dwel.20 broker (off-platform)" → logs leakage
  - "Through my own broker" → logs leakage
  - "Direct / no broker" → logs leakage
  - "Other" → logs leakage

If B-6 does not exist: simple status toggle to "rented" with no
rented_via capture. Tag as interim_v1.

### Acceptance criteria
- [ ] Landlord sees only their own org's listings — RLS confirmed
- [ ] Create listing produces a new row retrievable via GET
- [ ] Edit listing updates existing row — confirmed via re-fetch
- [ ] Draft listing not visible on public /listings browse
- [ ] Active listing visible on public /listings browse
- [ ] Photo upload UI exists (functional or interim_v1 stub)
- [ ] Rent stored as integer cents, displayed as formatted dollars
- [ ] Auth required — unauthenticated or renter role → redirect/403

---

## H-2 — Applicant review queue

### Page: /landlord/listings/{id}/applicants

Authenticated landlord_admin only.
This is the core landlord decision-making screen.

### Applicant list

Each applicant card shows ONLY allowlist fields (NEVER name, email,
phone, DOB, address, or exact income):

  - Score band (e.g., "Strong", "Good", "Fair")
  - Income band (e.g., "$50K–$75K")
  - Move-in window (e.g., "Within 30 days")
  - Household size
  - Has pets (yes/no)
  - Verification status (badge tier: fully_screened / prechecked / unverified)
  - Match score (0–100, if B-2 endpoint exists — otherwise omit)
  - Application date
  - Current status in the pipeline

Sort: by match score desc if available, otherwise by application date desc.

### Pre-screening state (awaiting_landlord_interest + manual_review mode)

If the landlord's screening_mode = 'manual_review', applicants in
awaiting_landlord_interest status show:

  CTA: **"Request screening"**
  - Confirms: "This will send a $30 screening request to the applicant.
    Proceed?"
  - On confirm: triggers the consent-request flow to the applicant
    (their status moves to awaiting_consent)

  CTA: **"Pass"**
  - Removes this applicant from the queue for this listing
  - Does NOT delete the application — sets status to 'landlord_passed'
  - Applicant receives generic "not selected" notification

If screening_mode = 'auto_screen': applicants skip this state entirely
and arrive in the queue at awaiting_consent or later.

### Post-screening state (screening_complete)

When screening results are ready, the landlord sees:

  Screening summary (what Certn returns, rendered in a clean card):
  - Criminal records: clear / records found
  - Credit check: score band (not exact score)
  - Eviction history: clear / records found
  - Identity verification: verified / not verified

  The exact fields depend on what Certn's API returns for your
  screening product. Render whatever fields exist in the response,
  using the allowlist pattern: if a field is not on the allowlist,
  do not render it even if Certn sends it.

  **DO NOT display:** SSN, full credit report text, exact credit score,
  detailed criminal record descriptions, or any field that constitutes
  a full Consumer Report under FCRA. The landlord sees a summary
  sufficient to make a yes/no decision.

  CTAs:
  - **"Approve"** → sets application status to 'approved'
    - At this moment and ONLY at this moment: reveal applicant's
      name, email, and phone number to the landlord
    - Write contact_revealed_at timestamp on the decision record
    - Emit domain_event: applicant_approved
    - Display: "Contact information is now visible. The applicant
      has been notified of your approval."

  - **"Decline"** → sets application status to 'declined'
    - Do NOT reveal any contact info
    - Emit domain_event: applicant_declined
    - Backend handles FCRA adverse-action notice requirements
      (this is a backend responsibility, not frontend — the frontend
      just fires the status change)

  - **"Request more info"** → opens a text field for the landlord
    to type a question, which is sent to the applicant as an
    in-platform message (or notification if messaging isn't built yet).
    Tag as interim_v1 if no messaging system exists.

### Post-approval state

After approval, the applicant card expands to show:
  - Full name
  - Email
  - Phone number
  - "Contact revealed on [date]" audit line

  And a note: "Next steps: coordinate lease execution with your
  broker or directly if you hold a license in this state."

  Do NOT build lease-execution automation. This is manual for v1.
  The BOR/self-execution path is downstream and not in scope here.

### Acceptance criteria
- [ ] Pre-screening view shows ONLY allowlist fields — test by confirming
      name/email/phone are NOT in the DOM at any point before approval
- [ ] Manual-review mode: "Request screening" CTA visible; auto mode: not visible
- [ ] Screening summary renders Certn result fields via allowlist, not raw dump
- [ ] Approve action reveals contact info and writes contact_revealed_at
- [ ] Decline action does NOT reveal contact info — confirmed via DOM inspection
- [ ] Double-click on Approve does not create duplicate decision records
- [ ] Applicant list scoped to this listing only (not all org applicants)
- [ ] Auth required — renter/broker/unauthenticated → 403/redirect
- [ ] contact_revealed_at is a server-side timestamp, not client-generated

---

## H-3 — Landlord self-execution evidence submission

### Page: /landlord/settings/self-execution

Authenticated landlord_admin only.

### Evidence submission form

Copy at top: "In some states, property owners can execute their own
leases without a broker. Submit your credentials for verification."

Fields:
  - State of licensure — dropdown (US states)
  - License type — dropdown:
    - "Licensed real estate broker"
    - "Licensed property manager"
    - "Owner-occupant / direct owner (no license required)"
  - License number — text input (required for broker/PM types,
    hidden for owner-occupant)
  - Business entity name — text input (if the license is held by
    an entity, not an individual)
  - Supporting documentation — file upload (license certificate,
    state registration, etc.)

On submit:
  - Creates a self_execution_evidence record:
    ```
    {
      org_id, state, license_type, license_number,
      entity_name, document_id (uploaded file),
      status: 'pending',
      submitted_at: now(),
      reviewed_at: null,
      reviewed_by: null,
      reviewer_notes: null
    }
    ```
  - Status lifecycle: pending → verified | rejected
  - Verified orgs skip broker routing for listings in that state

### Verification logic (interim_v1)

Tag the entire verification flow as interim_v1 — the rules for what
counts as valid evidence and which states allow self-execution are
pending Jacob's legal review.

For now, all submissions go to 'pending' and require manual admin
review (Part J). No auto-verification, no state-specific rules
hardcoded. The admin console (J-4) provides the review queue.

Display on the settings page:
  - If no submission: the form above
  - If pending: "Your credentials are under review. You'll be
    notified when verified." (no re-submit until reviewed)
  - If verified: "Verified for self-execution in [State].
    Expires [date if applicable]."
  - If rejected: "Your submission could not be verified.
    [Reviewer notes if any]. You may resubmit with updated
    documentation." (re-submit enabled)

### Banner on all self-execution UI

Display an internal-only banner (visible to RBIT admins viewing this
page, not to the landlord):

  "⚠ Self-execution verification criteria are interim_v1 —
   pending Jacob's legal sign-off. Do not treat any 'verified'
   status as legally authoritative until this banner is removed."

### Acceptance criteria
- [ ] Form collects all fields; license_number hidden for owner-occupant type
- [ ] File upload works (S3 or interim_v1 local storage)
- [ ] Submission creates a record with status = 'pending'
- [ ] Pending state blocks re-submission
- [ ] Rejected state allows re-submission
- [ ] Verified state displays clearly with state scope
- [ ] interim_v1 tag present in config and code comments
- [ ] Internal admin banner renders for admin viewers, not for landlord viewers
- [ ] No auto-verification logic — all pending until admin acts

---

# PART I — BROKER DASHBOARD + STRIPE CONNECT

## I-0 — Gate: all broker payout/fund features behind BOR flag

Create a feature flag: feature_flags.broker_payouts_enabled (default: false).

Every endpoint and UI element in Part I that involves money movement
(funding, lead purchase, payout) checks this flag. If false:
  - UI shows: "Payouts and lead purchasing will be available once
    licensing is finalized. Your dashboard and lead history are
    available now."
  - API returns 403 with error_code: 'broker_payouts_disabled'

This flag is flipped by an admin (Part J) when Jacob confirms
BOR agreements are signed for the broker's operating state(s).
It is NOT a global flag — it is per-org, because different broker
orgs may be licensed in different states at different times.

## I-1 — Broker performance dashboard

### Page: /broker/dashboard

Authenticated broker_admin only.

If B-4 endpoints exist (GET /v1/broker/performance, /leads, /submarkets):
  Render the full dashboard consuming those endpoints.

If B-4 endpoints do NOT exist:
  Build the dashboard UI with mock data fixtures, clearly labeled
  "Sample data — live metrics available when backend endpoints are
  deployed." Tag as interim_v1.

### Dashboard layout

Top row — summary cards (current window, default 90 days):
  - Leads offered (integer)
  - Leads accepted (integer + acceptance rate %)
  - Placements closed (integer + close rate %)
  - Median response time (formatted: "X hours" or "X days")
  - EV per lead (formatted dollars)
  - Leakage rate (%)

Window selector: 30 / 60 / 90 days (tabs or dropdown)

Middle section — trend comparison:
  "vs prior [window] days" with directional arrows (↑ green, ↓ red)
  for each metric. Simple text, not charts for v1.

Bottom section — submarket breakdown (table):
  - Submarket name
  - Leads offered / accepted / closed
  - Close rate
  - Median response time
  Sorted by close rate desc.

### I-2 — Lead history

### Page: /broker/leads

Authenticated broker_admin only.
Consumes GET /v1/broker/performance/leads if it exists.

Table view:
  - Lead ID (truncated UUID)
  - RS tier
  - Fee amount (formatted dollars)
  - Offered date
  - Status (offered / accepted / declined / expired / placed)
  - Placement status (if linked)
  - Outcome (if placement_outcome exists)

Filters: status, date range.
Pagination: server-side, 25 per page.

### I-3 — Stripe Connect onboarding (broker + landlord)

### Page: /broker/settings/payments (broker), /landlord/settings/payments (landlord)

Both broker and landlord orgs need Stripe Connect onboarding to
receive payouts. The flow is identical for both roles.

#### If Stripe Connect is active (F-3 confirmed):

  1. Check if the org already has a connected account:
     GET from backend (endpoint TBD — may need to be created)

  2. If no connected account exists:
     - Show: "Connect your bank account to receive payouts."
     - CTA: **"Set up payments"**
     - On click: create a Stripe Connect Express account via backend,
       get the onboarding URL, redirect to Stripe's hosted onboarding
     - On return from Stripe: display connected account status

  3. If connected account exists:
     - Show: account status (active / restricted / pending)
     - If restricted: "Stripe needs additional information."
       CTA: **"Complete setup"** → Stripe dashboard link
     - If active: "Payments connected. Payouts will be deposited to
       your linked bank account."
     - Show payout history if available (future endpoint)

  Backend endpoints needed (create if they don't exist):
    POST /v1/stripe/connect/account — creates Express account for org
    GET /v1/stripe/connect/account — returns account status
    POST /v1/stripe/connect/onboarding-link — generates Stripe onboarding URL
    GET /v1/stripe/connect/dashboard-link — generates Stripe dashboard URL

  All four endpoints require authenticated org admin.
  All four are gated behind broker_payouts_enabled for money-movement
  actions, but account creation and status checking are allowed
  regardless of the flag (so orgs can complete onboarding before
  payouts are turned on).

#### If Stripe Connect is NOT active (F-3 reported inactive):

  Show: "Payment setup is not yet available. Your account will be
  ready for onboarding soon."
  Tag as interim_v1.

### Acceptance criteria
- [ ] Broker dashboard renders with real data or clearly-labeled mock data
- [ ] Window selector changes the displayed metrics
- [ ] Lead history table paginates correctly
- [ ] Stripe Connect onboarding flow redirects to Stripe and returns
- [ ] Connected account status displays correctly (active/restricted/pending)
- [ ] broker_payouts_enabled = false → payout UI hidden, dashboard visible
- [ ] broker_payouts_enabled flag is per-org, not global
- [ ] Auth required per role — renter → redirect/403

---

# PART J — RBIT INTERNAL ADMIN CONSOLE

## J-0 — Admin auth and access

### Page: /admin/*

All admin pages require party_role = 'rbit_admin' or 'rbit_super'.
If the user does not have this role, /admin/* returns 403.

rbit_admin: read + limited write (review queues, config viewing)
rbit_super: full write (config changes, user management, flag toggles)

The admin console is internal-only. It should be functional and clear,
not polished — prioritize information density and action clarity over
visual refinement. Use the same brand system but accept a more
utilitarian layout (data tables, action buttons, status badges).

---

## J-1 — User and org management

### Page: /admin/users

List all parties with:
  - Party ID (truncated)
  - Name, email
  - Roles (renter / landlord_admin / broker_admin / rbit_admin / rbit_super)
  - Org(s) linked
  - Created at
  - Last sign-in

Search by name, email, org name.

Actions:
  - **"Assign role"** → dropdown of available roles, confirm dialog
    "Assigning [role] to [name]. This takes effect immediately."
  - **"View details"** → /admin/users/{party_id} (profile, applications,
    screening history, consent records)

### Page: /admin/orgs

List all orgs with:
  - Org ID (truncated)
  - Name
  - Type (landlord / broker)
  - Members count
  - Listings count (landlord) / Leads count (broker)
  - Created at
  - Stripe Connect status (not connected / pending / active)
  - Self-execution status (not submitted / pending / verified / rejected)
  - broker_payouts_enabled flag value

Actions:
  - **"Toggle broker payouts"** (rbit_super only) → confirm dialog
    explaining the consequence, flips the per-org flag
  - **"View details"** → /admin/orgs/{org_id}

### Acceptance criteria
- [ ] User list paginates and is searchable
- [ ] Role assignment persists and is reflected on next page load
- [ ] Org list shows accurate Stripe Connect and self-execution status
- [ ] broker_payouts_enabled toggle works per-org with confirmation
- [ ] rbit_admin cannot toggle flags — only rbit_super
- [ ] All admin pages return 403 for non-admin roles

---

## J-2 — Consent copy configuration

### Page: /admin/config/consent

rbit_super only.

Displays the current consent copy from config key
consent_copy.fcra_one_time_use.

  - Current text displayed in a read-only box with timestamp of
    last update and who updated it
  - **"Edit"** button → opens an editor with the full text
  - On save: updates the config key, logs the change with
    previous text, new text, changed_by, changed_at
  - **"Preview"** button → renders the consent text exactly as the
    applicant will see it in G-4

This is how Jacob's final language drops in without a code deploy.

### Acceptance criteria
- [ ] Current consent text displayed with last-updated metadata
- [ ] Edit saves to config key, not a code file
- [ ] Change log records previous and new text with author and timestamp
- [ ] Preview renders identically to G-4's consent display
- [ ] rbit_admin can view but not edit — only rbit_super can save

---

## J-3 — Certn credential and screening status

### Page: /admin/integrations/certn

Read-only status dashboard:

  - Secret ARN (masked, last 4 chars only)
  - AWSCURRENT status: populated / missing
  - Feature gate status: enabled / disabled
  - Last screening order: timestamp, status, duration
  - Screening orders today: count
  - Failed screenings (last 7 days): count with expandable list
    showing application_id, error message, timestamp

If AWSCURRENT is missing, display:
  "Certn credentials are not populated. Screening orders will be
  queued for manual processing until credentials are configured."

  Do NOT provide a UI to populate the secret — this is a CLI/console
  operation for security reasons.

### Acceptance criteria
- [ ] Correct AWSCURRENT status displayed (matches aws secretsmanager describe-secret)
- [ ] Feature gate status matches runtime behavior
- [ ] Failed screenings list is accurate and clickable
- [ ] No secret values displayed — ARN masked, key never shown
- [ ] rbit_admin and rbit_super can view — no other roles

---

## J-4 — Self-execution evidence review queue

### Page: /admin/reviews/self-execution

rbit_admin or rbit_super.

Table of all self_execution_evidence records:
  - Org name
  - State
  - License type
  - License number (if applicable)
  - Submitted at
  - Status (pending / verified / rejected)
  - Reviewer (if reviewed)

Filter by status (default: pending first).

Click to expand → shows:
  - All submitted fields
  - Uploaded document (viewable/downloadable)
  - Reviewer notes field (editable)

Actions (interim_v1 — manual only):
  - **"Verify"** → sets status to 'verified', records reviewer
    party_id and timestamp. Confirm dialog: "Verify [Org Name] for
    self-execution in [State]? This is interim_v1 — pending Jacob's
    legal sign-off on verification criteria."
  - **"Reject"** → requires reviewer notes (reason), sets status
    to 'rejected', records reviewer and timestamp

### Acceptance criteria
- [ ] Pending records displayed by default
- [ ] Verify action sets status and records reviewer identity
- [ ] Reject action requires notes — empty notes → validation error
- [ ] interim_v1 warning displayed on the verify confirmation dialog
- [ ] Uploaded documents viewable from this page
- [ ] Only rbit_admin or rbit_super can access

---

## J-5 — Feature flag management

### Page: /admin/config/flags

rbit_super only.

Display all feature flags with:
  - Flag name
  - Scope (global / per-org)
  - Current value (on/off, or per-org table)
  - Last changed by
  - Last changed at

Known flags to display:
  - broker_payouts_enabled (per-org)
  - certn_screening_enabled (global)
  - stripe_connect_enabled (global)
  - self_execution_review_enabled (global)

Actions:
  - Toggle global flags with confirmation
  - Per-org flags managed from J-1 org detail page, not here
    (but viewable here in aggregate)

### Acceptance criteria
- [ ] All known flags displayed with current values
- [ ] Global flag toggle works with confirmation dialog
- [ ] Change log recorded (who, when, old value, new value)
- [ ] rbit_admin can view but not toggle — only rbit_super
- [ ] Per-org flags show aggregate count (X orgs enabled / Y total)

---

## J-6 — Audit log viewer

### Page: /admin/audit

rbit_admin or rbit_super.

Searchable, filterable log of security-sensitive events:
  - consent_submitted (party_id, application_id, timestamp)
  - contact_revealed (landlord_org_id, applicant_party_id, timestamp)
  - screening_ordered (application_id, vendor, timestamp)
  - screening_completed (application_id, result_summary, timestamp)
  - role_assigned (target_party_id, role, assigned_by, timestamp)
  - flag_toggled (flag_name, old_value, new_value, changed_by, timestamp)
  - config_updated (key, changed_by, timestamp)
  - self_execution_reviewed (org_id, decision, reviewer, timestamp)

Filters: event type, date range, party_id, org_id.
Pagination: 50 per page.
Export: CSV download of filtered results.

### Acceptance criteria
- [ ] All event types listed above are captured and displayed
- [ ] Filters narrow results correctly — test with ≥2 filter combinations
- [ ] CSV export matches the filtered view
- [ ] No PII in the audit log beyond party_id and org_id references
  (no names, emails, phone numbers in the log rows — those are
  lookups from the party table, not stored in the audit log itself)
- [ ] Auth required — non-admin → 403

---

# PART K — EVIDENCE AND REPORTING

After all parts complete, deliver:

## K-1 — Frontend route inventory

| Route | Role required | Backend endpoint(s) consumed | Status |
|---|---|---|---|
| /onboard | none | POST /v1/auth/magic-link, POST /v1/renter/profile | |
| /listings | none | GET /v1/listings | |
| /listings/{id} | none (interest requires auth) | GET /v1/listings/{id}, POST /v1/applications | |
| /applications | renter | GET /v1/applications | |
| /applications/{id}/consent | renter | POST /v1/consent, Stripe charge | |
| /landlord/settings | landlord_admin | org settings read/write | |
| /landlord/listings | landlord_admin | GET /v1/listings (scoped) | |
| /landlord/listings/{id}/applicants | landlord_admin | application list + decisions | |
| /landlord/settings/self-execution | landlord_admin | self_execution_evidence CRUD | |
| /landlord/settings/payments | landlord_admin | Stripe Connect | |
| /broker/dashboard | broker_admin | GET /v1/broker/performance | |
| /broker/leads | broker_admin | GET /v1/broker/performance/leads | |
| /broker/settings/payments | broker_admin | Stripe Connect | |
| /admin/* | rbit_admin/super | various | |

## K-2 — Per-criterion acceptance report

For EVERY acceptance criterion in Parts G, H, I, J:
  Report PASS / FAIL / PARTIAL with evidence.
  Evidence = screenshot, HTTP response, or DOM inspection result.
  Do not summarise. Do not aggregate.

## K-3 — Backend endpoints created

List every new backend endpoint this prompt required creating
(vs. consuming an existing one). For each:
  - Method + path
  - Auth requirement
  - Request/response shape
  - Test coverage (number of tests, all passing)

## K-4 — interim_v1 inventory

List every feature tagged interim_v1, the reason, and what
resolves it:

| Feature | Reason | Resolves when |
|---|---|---|
| Photo upload storage | S3 wiring TBD | S3 adapter confirmed |
| Self-execution verification rules | Jacob's review | Legal sign-off |
| ... | ... | ... |

## K-5 — What is NOT done and why

List every item from Parts G–J that is incomplete.
For each: the reason (blocked by §18 decision, missing credentials,
missing backend endpoint, or scope cut).
Honest reporting only.

---

# DO NOT ATTEMPT LIST

The following are explicitly out of scope. Do not build, stub, or
scaffold any of these. If a feature in Parts G–J appears to require
one of these, halt and report the dependency instead.

  1. Lease execution automation (BOR-dependent — manual for v1)
  2. Automated approve/decline decisions (always human landlord action)
  3. FCRA adverse-action notice generation (backend responsibility,
     not frontend — and requires Jacob's sign-off on copy)
  4. Broker commission calculation or payout execution
     (behind broker_payouts_enabled flag, which defaults to off)
  5. Certn secret population (Michael does this via CLI)
  6. Real FCRA consent copy (placeholder until Jacob signs off)
  7. State-specific self-execution rules (interim_v1 until Jacob reviews)
  8. In-platform messaging system (tag as interim_v1 where referenced)
  9. Email delivery configuration for non-dev environments
  10. Branded DNS / ACM certificate provisioning
  11. Auto-verification of landlord licenses via state APIs
     (future enhancement, not v1 — all manual review for now)
  12. Cashback ACH disbursement (fires at lease execution, which is
      out of scope per item 1)
  13. ML scoring / Phase 7 features (gated on label coverage)
  14. Rent payment portal (concept-stage, money-transmitter questions unresolved)