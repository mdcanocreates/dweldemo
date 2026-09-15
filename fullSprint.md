# RBIT — Full build sprint: product improvements + AWS go-live
# Target: live on AWS within 2 weeks of this prompt

All §0 operating rules from the backend spec remain binding.
All §18 open decisions remain halt conditions — do not resolve in code.
Report criterion-by-criterion with evidence. Do not summarise.

This prompt has three parts executed in strict order:
  PART A — RLS remediation (gate: nothing in B or C starts until A is done)
  PART B — Product feature additions (new backend + API endpoints)
  PART C — AWS wiring (swap stubs for real services, Terraform, deploy)

---

# PART A — GLOBAL_TABLES RLS remediation

## Context

F-3 identified ~30 tables in GLOBAL_TABLES carrying party-scoped or
org-scoped data without RLS policies. R-1 only fixed 6 tables. The
remaining ambiguous tables must be classified and assigned correct
policies before any new code is written on top of them.

## A-1 — Classify every ambiguous table

For each table still in GLOBAL_TABLES that F-3 flagged as ambiguous,
determine:

  (a) Does it have an org_id column?
  (b) Which party(s) / org(s) legitimately read rows from it?
  (c) Correct policy type:
      - SIMPLE: single org_id = current_org
      - JOIN: access via a parent table (e.g. via placement → org_id)
      - PARTY: scoped to party_id = current_party (not org)
      - DUAL: both a party and an org need access (define both)
      - GLOBAL: genuinely reference data — justify with one sentence

Do not write any policies yet. Produce a classification table:

| Table | Has org_id | Policy type | Join path or justification |

Halt and report to Michael if any table's correct scoping is genuinely
unclear. Do not guess.

## A-2 — Write the policies

For every table classified as SIMPLE, JOIN, PARTY, or DUAL in A-1:

1. Add org_id column via expand migration if missing
2. Add RLS policy using the §3.1 pattern:

   For SIMPLE:
     using (org_id = current_setting('rbit.current_org_id')::uuid
            or current_setting('rbit.bypass_rls', true) = 'on')

   For JOIN (example — placement_outcome via placement):
     using (
       exists (
         select 1 from placement p
         where p.id = placement_outcome.placement_id
           and p.org_id = current_setting('rbit.current_org_id')::uuid
       )
       or current_setting('rbit.bypass_rls', true) = 'on'
     )

   For PARTY:
     using (party_id = current_setting('rbit.current_party_id')::uuid
            or current_setting('rbit.bypass_rls', true) = 'on')

3. Remove the table from GLOBAL_TABLES
4. Add SET LOCAL for rbit.current_party_id in the session middleware
   if any PARTY-scoped tables exist (it may not exist yet)

Specific tables expected to need JOIN policies (confirm via A-1):
  - placement_outcome (via placement)
  - placement_queue_entry (via listing)
  - landlord_interest (org_id should already exist)
  - screening_order (party-scoped — payer or applicant)
  - screening_report (party-scoped)
  - screening_rebate (party-scoped)
  - income_verification (party-scoped)
  - fraud_signal (party-scoped)
  - solar_underwriting_decision (via solar_deal)
  - solar_deal_remittance (via solar_deal)
  - document_grant (dual — grantee_org_id and grantee_party_id)
  - document_access_log (via document)
  - notification (party recipient)
  - notification_preference (party-scoped)
  - renter_profile (party-scoped)
  - score (party-scoped)
  - session (party-scoped)
  - auth_magic_token (party-scoped)
  - vendor_webhook_event (platform-level — assess carefully)
  - vendor_request_archive (platform-level)
  - screening_saga_state (platform workflow — may be genuinely global)
  - lead_offer_saga_state (platform workflow — may be genuinely global)
  - raw_record / sync_run (ingestion — org_id via source)
  - listing_field_provenance (via listing → org_id)
  - unit_source_conflict (shared unit — may need dual policy)
  - ledger_account / ledger_transaction / ledger_entry (assess)
  - search_event / search_demand_daily (analytics — assess)
  - feature_snapshot (party-scoped)

## A-3 — CI gate still passes

After all policies are added and tables removed from GLOBAL_TABLES:
  - Run the §3.1 CI tenancy gate
  - Every table must either have a policy or a GLOBAL_TABLES entry
    with a written justification comment
  - The gate must fail on a new unscoped table added deliberately

## A-4 — Evidence

For each table that got a policy:
  - Paste the migration SQL
  - Paste: app role without org context selects 0 rows
  - Paste: app role with correct org context selects expected rows

Paste final GLOBAL_TABLES contents with justification per entry.
Paste CI gate passing.

---

# PART B — Product feature additions

## B-1 — Shareable renter verification badge

### Why
Every verified renter becomes a distribution channel. A landlord who
clicks a badge link discovers RBIT without any marketing spend. This
is the highest-leverage distribution feature in the product.

### Schema additions (migration required)

```sql
alter table renter_profile add column
  badge_share_token text unique;         -- urlsafe random, 32 bytes
alter table renter_profile add column
  badge_share_enabled boolean not null default false;
alter table renter_profile add column
  badge_share_views int not null default 0;

create table badge_share_view (
  id              uuid primary key default gen_random_uuid(),
  renter_profile_id uuid not null references renter_profile(id),
  viewer_ip       inet,
  viewer_ua       text,
  referrer        text,
  is_authenticated boolean not null default false,
  viewer_party_id uuid references party(id),
  occurred_at     timestamptz not null default now()
);
create index on badge_share_view (renter_profile_id, occurred_at desc);
```

### API endpoints

GET /v1/badge/{token}
  - Public endpoint, no auth required
  - Rate limited: 60/min per IP
  - Returns: badge_state, score_band, income_band, verification_components,
    move_in_window, submarket_names, household_size, has_pets
  - Never returns: name, email, phone, DOB, address, exact income
  - Logs to badge_share_view
  - Increments badge_share_views atomically
  - Returns 404 if token does not exist or badge_share_enabled = false
  - Response includes a CTA: "List your property on dwel →"
    linking to the landlord signup flow

POST /v1/renter/badge/share
  - Authenticated renter only
  - Generates badge_share_token if null, sets badge_share_enabled = true
  - Returns the full shareable URL: https://dwel.app/badge/{token}
  - Emits domain_event: renter_badge_shared

DELETE /v1/renter/badge/share
  - Authenticated renter only
  - Rotates badge_share_token (old URL becomes 404 immediately)
  - Sets badge_share_enabled = false
  - Emits domain_event: renter_badge_share_disabled

### Rules
- badge_share_token is generated once and rotated only on explicit
  disable+re-enable (not on every request)
- The public endpoint must not be cached beyond 60 seconds
  (badge state changes should propagate quickly)
- badge_share_views is a counter — increment with
  UPDATE renter_profile SET badge_share_views = badge_share_views + 1
  not a separate count query, to avoid races
- Every badge view is logged to badge_share_view regardless of
  whether the viewer is authenticated
- badge_share_view.viewer_party_id is set only if the viewer has
  a valid RBIT session — this is how landlords who click become
  known contacts

### Acceptance criteria
- [ ] Public badge URL returns correct fields, never identity fields
- [ ] Test: attempt to include email/name/phone in the response → rejected
      by a field allowlist in the serialiser, not by omission
- [ ] Disabled badge returns 404, not 403 (no confirmation of existence)
- [ ] Badge view logged for authenticated and unauthenticated viewers
- [ ] Token rotation makes old URL return 404 immediately
- [ ] Rate limit enforced: 61st request from same IP within 60s → 429
- [ ] Domain events emitted for share and disable

---

## B-2 — Match score on landlord discovery

### Why
Turns "here are renters" into "here are your best matches." A landlord
who sees a 94% match score acts; one who sees a list of badge tiers
scrolls.

### Schema additions

```sql
alter table landlord_interest add column
  match_score numeric;                   -- 0-100, computed at search time
alter table landlord_interest add column
  match_score_components jsonb;          -- breakdown per dimension
```

### Match score computation

The match score is a weighted overlap between the listing's attributes
and the renter_profile's criteria. Compute server-side at search time.
Register as model_key = 'listing_renter_match', kind = 'rules',
version = 'v0.1'. Snapshot the version on every landlord_interest row.

Dimensions and default weights (in config namespace 'scoring_weights',
not hardcoded):

| Dimension | Weight | How scored |
|---|---|---|
| Rent affordability | 30% | renter rent_max_cents >= listing rent: 100. Below by ≤10%: 50. Below: 0 |
| Move-in window overlap | 20% | listing available_on within renter window: 100. ≤14d outside: 50. Else 0 |
| Bedroom match | 15% | listing bedrooms >= renter bedrooms_min: 100. Else 0 |
| Badge tier | 20% | fully_screened: 100. prechecked: 60. unverified: 20 |
| Submarket match | 15% | listing submarket in renter target_submarket_ids: 100. Else 0 |

Weighted sum = raw match score 0–100.

### API changes

GET /v1/landlord/renters (existing discoverable pool endpoint)
  - Add match_score and match_score_components to each result
  - Add sort_by=match_score option (default: match_score desc)
  - match_score is computed for the specific listing_id passed as a
    query param — if no listing_id, return profile data only,
    match_score null

GET /v1/landlord/listings/{listing_id}/matches
  - New endpoint: returns the top 20 discoverable renters by match_score
    for a specific listing, computed on the fly
  - Same field allowlist as §9.4 — never identity fields
  - Requires landlord to own the listing

### Rules
- Match score is never stored on renter_profile — it is computed
  per (listing, renter) pair at query time and stored only on the
  landlord_interest row when an interest is expressed
- Weights are config, not code literals (scoring_weights namespace)
- Model version is snapshotted on landlord_interest
- An explanation of each dimension is returned alongside the score
  so a landlord understands why a renter scored 60 vs 90

### Acceptance criteria
- [ ] Match score computed correctly for each dimension — fixture test
      for each weight edge (exact boundary, above, below)
- [ ] Weights sum to 1.0 — asserted in a test
- [ ] Model version snapshotted on landlord_interest
- [ ] match_score is null when no listing_id provided — asserted
- [ ] Changing scoring_weights config produces a different score
      on the same inputs — asserted
- [ ] Response never includes identity fields — serialiser allowlist test

---

## B-3 — Device-based fraud prescreen before Certn pull

### Why
$29.46 spent on a Certn pull for a synthetic-identity application is
$29.46 wasted. A device graph check costs nothing and catches the most
common fraud pattern before the vendor call.

### Schema additions

```sql
create table device_fingerprint (
  id                uuid primary key default gen_random_uuid(),
  device_id         text not null,
  party_id          uuid not null references party(id),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  application_count int not null default 0,
  identity_count    int not null default 0,   -- distinct party_ids on this device
  is_flagged        boolean not null default false,
  flagged_at        timestamptz,
  flagged_reason    text
);
create unique index on device_fingerprint (device_id, party_id);
create index on device_fingerprint (device_id);
create index on device_fingerprint (is_flagged) where is_flagged = true;

create table device_identity_edge (
  device_id         text not null,
  party_id          uuid not null references party(id),
  first_seen_at     timestamptz not null default now(),
  primary key (device_id, party_id)
);
```

### Prescreen gate logic

On application submission (before any vendor call), run:

  1. Upsert device_fingerprint and device_identity_edge
  2. Count distinct party_ids on this device_id in the past 30 days
  3. Count distinct device_ids for this party_id in the past 7 days
  4. Count applications from this device in the past 24h

  Thresholds (in config namespace 'fraud_thresholds'):
    device_identity_count_30d_threshold: 3   (same device, 3+ identities)
    device_application_count_24h_threshold: 5
    party_device_count_7d_threshold: 4       (same person, 4+ devices)

  If any threshold exceeded:
    - Write fraud_signal (signal_kind = 'device_velocity',
      severity based on how far over threshold)
    - Set application.status = 'prescreen_failed'
    - Emit domain_event: application_prescreen_failed
    - Do NOT proceed to vendor calls
    - Do NOT reveal the reason to the applicant (generic decline message)

  Threshold breach is NOT an automatic fraud confirmation — it routes
  to the fraud review queue. An admin can clear it and let the
  application proceed.

### Acceptance criteria
- [ ] Device with 3 distinct party_ids in 30 days triggers prescreen_failed
- [ ] Same party on 4 devices in 7 days triggers prescreen_failed
- [ ] 5 applications from same device in 24h triggers prescreen_failed
- [ ] No Certn call is made when prescreen_failed (assert no vendor_request_archive row)
- [ ] Thresholds come from config, not code literals
- [ ] Admin clear path works: cleared application resumes from prescreen
- [ ] Applicant receives generic decline, not the specific reason

---

## B-4 — Broker performance dashboard (backend endpoints only)

### Why
Brokers who see their own data buy more leads and close more deals.
This surfaces the data that already exists in broker_performance.

### New endpoints

GET /v1/broker/performance
  Authenticated broker_admin only.
  Returns for the requesting org:
    - leads_offered, leads_accepted, acceptance_rate
    - placements_closed, close_rate
    - median_response_seconds
    - leakage_rate
    - dispute_count
    - ev_per_lead (close_rate * blended_broker_margin — from config)
    - window_days (90 default, configurable via query param 30|60|90)
    - rank_in_submarket: this org's close_rate percentile vs other
      brokers in the same submarket(s) — anonymised, no names
    - best_performing_submarket: submarket_id with highest close_rate
    - trend: same metrics for the prior window (for comparison)

GET /v1/broker/performance/leads
  Authenticated broker_admin only.
  Returns per-lead history with:
    - lead_id, rs_tier, fee_amount_cents, offered_at, status
    - placement status if linked
    - outcome if placement_outcome exists
    - resolution (closed on-platform, closed off-platform, lapsed)
  Paginated, filterable by status and date range.

GET /v1/broker/performance/submarkets
  Authenticated broker_admin only.
  Returns per-submarket breakdown:
    - submarket_id, name
    - leads_offered, leads_accepted, placements_closed
    - close_rate, median_response_seconds
  Sorted by close_rate desc.

### Rules
- All three endpoints read from the replica (P9), not primary
- broker_performance table is updated by a nightly job — these
  endpoints read the materialised values, not live aggregations
  (live aggregations go on the primary under load)
- rank_in_submarket is computed from the replica at read time using
  a window function — do not expose other orgs' identifiers
- ev_per_lead formula uses blended_broker_margin from config, not
  a hardcoded value

### Acceptance criteria
- [ ] Endpoints only accessible to broker_admin of the requesting org
- [ ] rank_in_submarket returns a percentile (0-100), not another org's name
- [ ] ev_per_lead changes when config changes — asserted
- [ ] trend comparison period is correct (prior window, not current)
- [ ] Reads hit the replica, not primary — verified via query log

---

## B-5 — Zero-result search → notify-me flow

### Why
A renter who searches and finds nothing is the highest-value demand
signal you have. Capturing it creates a re-engagement hook and a
landlord acquisition signal.

### Schema additions

```sql
create table search_alert (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid references party(id),  -- null if unauthenticated
  email_hmac        bytea,                       -- for unauthenticated capture
  submarket_id      uuid references submarket(id),
  bedrooms_min      numeric(3,1),
  rent_max_cents    int,
  move_in_by        date,
  has_pets          boolean,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  last_notified_at  timestamptz,
  match_count       int not null default 0,      -- listings matched so far
  unsubscribed_at   timestamptz
);
create index on search_alert (submarket_id, is_active)
  where is_active = true;
create index on search_alert (email_hmac)
  where email_hmac is not null;
```

### API endpoints

POST /v1/search/alert
  - Accepts: submarket_id, bedrooms_min, rent_max_cents,
    move_in_by, has_pets, email (if unauthenticated)
  - If authenticated: links to party_id
  - If unauthenticated: stores email_hmac only, sends confirmation email
    with a magic link to confirm the alert
  - Returns: alert_id, confirmation of what was captured
  - Rate limit: 3 alerts per email per day

DELETE /v1/search/alert/{id}
  - One-click unsubscribe (no auth required — token in the URL)
  - Sets is_active = false, unsubscribed_at = now()

### Alert matching job (nightly, SQS worker)

  For each active search_alert:
    1. Run the same query as the search endpoint with the alert's filters
    2. Collect listing IDs published since last_notified_at
    3. If any new matches: send notification with match count and
       a "View matches" deep link
    4. Update last_notified_at and match_count
    5. If match_count >= 3 and party_id is null: add a soft nudge
       to create an account for better matching

### Landlord acquisition signal

GET /v1/admin/demand/unmet (admin only, replica)
  Returns: by submarket and bed band, the count of active search_alerts
  with zero matches, grouped by week of creation.
  This is the primary landlord acquisition targeting signal.

### Acceptance criteria
- [ ] Alert created for authenticated renter links to party_id
- [ ] Alert created without auth stores email_hmac only, sends confirmation
- [ ] Nightly job sends notification only for new listings since last_notified_at
- [ ] One-click unsubscribe works without authentication
- [ ] Admin demand/unmet endpoint correctly counts zero-match alerts
- [ ] Rate limit: 4th alert from same email same day → 429

---

## B-6 — Off-platform leakage prompt

### Why
When a landlord marks a unit rented without a linked placement, that
is training label data walking out the door. A soft prompt captures
it instead of losing it.

### API change

POST /v1/listings/{listing_id}/mark-rented
  Existing endpoint. Add required field: rented_via
    enum: 'rbit_placement' | 'rbit_broker_offplatform' |
          'own_broker' | 'direct' | 'other'

  If rented_via = 'rbit_placement': require placement_id, link them.
  If anything else:
    - Write leakage_event:

```sql
create table listing_leakage_event (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listing(id),
  org_id            uuid not null,
  rented_via        text not null,
  broker_party_id   uuid references party(id),  -- if rbit_broker_offplatform
  reported_by_party_id uuid not null,
  occurred_at       timestamptz not null default now()
);
```

    - Emit domain_event: listing_rented_off_platform
    - Increment broker_performance.leakage_rate for the linked broker
      if rented_via = 'rbit_broker_offplatform'

GET /v1/admin/leakage (admin only, replica)
  Returns: leakage_event rows by submarket, rented_via, and week.
  The primary broker performance accountability metric.

### Acceptance criteria
- [ ] mark-rented without rented_via → 400
- [ ] rbit_placement without placement_id → 400
- [ ] off-platform event writes leakage_event and emits domain_event
- [ ] broker leakage_rate updated when rited_via = rbit_broker_offplatform
- [ ] Admin leakage endpoint readable from replica

---

## B-7 — Proactive remittance statements (Solar)

### Why
Instead of waiting to see what PBC sends, RBIT generates a statement
of what it expects before each remittance period closes. Flips the
power dynamic and makes discrepancies RBIT's finding, not PBC's.

### Schema additions

```sql
create table solar_remittance_statement (
  id                    uuid primary key default gen_random_uuid(),
  partner_org_id        uuid not null references org(id),
  period_start          date not null,
  period_end            date not null,
  deal_count            int not null,
  expected_total_cents  bigint not null,
  generated_at          timestamptz not null default now(),
  sent_at               timestamptz,
  document_id           uuid references document(id),  -- PDF copy
  status                text not null check (status in
                          ('draft','sent','matched','variance','disputed'))
);

create table solar_remittance_statement_line (
  id                    uuid primary key default gen_random_uuid(),
  statement_id          uuid not null references solar_remittance_statement(id),
  solar_deal_id         uuid not null references solar_deal(id),
  approved_cashback_cents int not null,
  net_to_rbit_cents     bigint not null,
  expected_remittance_cents bigint not null,
  deal_installed_at     timestamptz,
  deal_status           text not null
);
```

### Logic

Monthly job (Temporal, first business day of each month):
  1. Collect all solar_deal rows where status = 'installed'
     and funded_at is null and period falls in prior month
  2. Compute expected_remittance_cents per deal from the
     underwriting decision's net_to_rbit_cents
  3. Generate solar_remittance_statement with line items
  4. Render as PDF via the document store
  5. Send to the partner contact on file (notification email)
  6. When solar_partner_remittance is received:
     - Match against the statement
     - If variance < config threshold: auto-match, status = 'matched'
     - If variance >= threshold: status = 'variance', alert RBIT ops

### Acceptance criteria
- [ ] Statement generated with correct deal_count and expected_total
- [ ] Each line item's expected_remittance_cents matches the
      underwriting decision — verified against a seeded fixture
- [ ] Statement PDF stored as document with correct org entitlement
- [ ] Variance detection fires when received != expected beyond threshold
- [ ] Threshold comes from config, not a code literal

---

## B-8 — Solar rep-first flow (2-field, 5-second underwriting)

### Why
A rep standing in a homeowner's house needs the cashback number NOW,
not after the homeowner submits an application. The cashback amount
is the closing tool.

### New endpoint

POST /v1/solar/quick-quote
  - Authenticated solar_rep only
  - Body: { sale_price_cents, system_size_kw, zip_code }
  - Does NOT create a solar_deal row
  - Runs the two-equation underwriting engine against a synthetic
    deal_input (no homeowner data required at this stage)
  - Returns in < 500ms:
    {
      tier: 1|2|3|4,
      tier_name: "Tier 3 — 25–35kW",
      approved_cashback_cents: 400000,
      approved_cashback_display: "$4,000",
      equation_path: "eq1_passed" | "eq2_adjusted" | "declined",
      explanation: "Your 28kW system qualifies for Tier 3...",
      plain_language: "Your customer qualifies for up to $4,000 cash
                       back, paid after installation is complete.",
      quote_expires_at: <15 minutes from now>,
      quote_token: <signed JWT, 15min TTL>
    }
  - If declined: returns reason code but never the internal threshold
    values that reveal the pricing model

POST /v1/solar/deals (existing create endpoint)
  - Add optional field: quote_token
  - If quote_token present and valid: skip re-running underwriting,
    apply the quoted decision directly (preventing a bait-and-switch
    between quote and application)
  - If quote_token expired: re-run underwriting, alert if result differs

### Explanation template

The plain_language field is generated from a template, not from the
engine's internal explanation. Template variables:
  - {system_size_kw}, {tier_name}, {cashback_display},
    {equation_path == 'eq2_adjusted' ? 'adjusted based on deal margin' : ''}

Template lives in config namespace 'solar_explanation_templates'.

### Acceptance criteria
- [ ] Quick-quote returns in < 500ms — asserted with a timing test
- [ ] Quick-quote does NOT create any database row
- [ ] Quote token, when passed to create endpoint, produces the same
      decision without re-running the engine — asserted
- [ ] Expired quote token triggers re-run — asserted
- [ ] plain_language uses template from config, not a code literal
- [ ] Declined response never reveals internal thresholds
- [ ] solar_rep role required — landlord/renter/admin → 403

---

## B-9 — Notification sequences (not just individual sends)

### Why
A renter who abandoned their application mid-flow, a landlord who
viewed 3 profiles without acting, a broker who hasn't accepted a lead
in 7 days — all need different messages than a generic reminder.
Sequences make notifications a retention mechanism, not just plumbing.

### Schema additions

```sql
create table notification_sequence (
  id              uuid primary key default gen_random_uuid(),
  sequence_key    text not null unique,
  description     text not null,
  trigger_event   text not null,      -- domain_event.event_type that starts it
  is_active       boolean not null default true,
  version         text not null
);

create table notification_sequence_step (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references notification_sequence(id),
  step_number     int not null,
  delay_hours     int not null,       -- hours after prior step (or trigger for step 1)
  template_key    text not null,
  channel         text not null check (channel in ('email','in_platform','sms')),
  cancel_if       text,               -- domain_event.event_type that cancels remaining steps
  unique (sequence_id, step_number)
);

create table notification_sequence_instance (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references notification_sequence(id),
  party_id        uuid not null references party(id),
  trigger_event_id uuid,
  context         jsonb not null,     -- data for template rendering
  current_step    int not null default 1,
  status          text not null check (status in
                    ('active','completed','cancelled','failed')),
  started_at      timestamptz not null default now(),
  next_step_at    timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text
);
create index on notification_sequence_instance
  (status, next_step_at) where status = 'active';
```

### Sequences to seed at launch

1. renter_application_abandoned
   - Trigger: application_submitted but no screening_authorized after 24h
   - Step 1 (24h): "Your application is waiting — finish verification"
   - Step 2 (72h): "Your verified badge is almost ready"
   - Step 3 (168h): "Last chance — your progress expires in 48h"
   - Cancel if: screening_authorized OR application_closed

2. landlord_viewed_no_action
   - Trigger: landlord_interest.status viewed but no decision after 48h
   - Step 1 (48h): "You viewed {count} renters — here's your top match"
   - Step 2 (96h): performance data nudge: "Renters in {submarket} are moving fast"
   - Cancel if: landlord_decision created

3. broker_lead_inactive
   - Trigger: no lead_offer.response in 7 days for a broker
   - Step 1 (7d): performance summary with ev_per_lead
   - Step 2 (14d): "Here's what you're missing in {submarket}"
   - Cancel if: lead_offer accepted

### Sequence worker

SQS worker polls notification_sequence_instance where
status = 'active' and next_step_at <= now(), batch size 100.

For each:
  1. Check if cancel_if event has fired for this party since started_at
     — if so, set status = 'cancelled'
  2. Otherwise send the step's notification
  3. Advance current_step or set status = 'completed'
  4. Set next_step_at for the next step

### Acceptance criteria
- [ ] Sequence started on trigger event — asserted
- [ ] Cancel event fires → remaining steps skipped — asserted
- [ ] Step 2 not sent if cancel fires between step 1 and step 2
- [ ] Each step fires at correct delay from prior step — clock-manipulated test
- [ ] Sequences seed correctly in migrations
- [ ] Worker processes 100 instances in a single poll without timeout

---

# PART C — AWS wiring and deployment

## C-1 — Terraform infrastructure

The Terraform files were generated previously. Execute the apply:

```bash
cd infrastructure/mvp
terraform init
terraform plan -out=plan.out
# Michael reviews plan.out before this runs:
terraform apply plan.out
```

After apply, paste all outputs:
  - Aurora cluster endpoint
  - Aurora reader endpoint
  - ElastiCache endpoint
  - ALB DNS name
  - S3 bucket name
  - KMS key ARN
  - Task role ARN
  - VPC ID

## C-2 — Swap stubs for real AWS services

Replace every infrastructure stub with the real AWS service.
Do not change any business logic — only the adapter implementations.

### C-2a — KMS (LocalKmsProvider → AWS KMS)

Implement AwsKmsProvider using @aws-sdk/client-kms:
  - GenerateDataKey for new party DEKs
  - Decrypt for DEK unwrapping
  - Key ID from environment variable RBIT_KMS_KEY_ID
  - Retry with exponential backoff on ThrottlingException
  - Log key_id and operation (never the key material) to structured log

Acceptance:
  - [ ] Crypto-shred end-to-end against real KMS: create party →
        write identity → destroy DEK → identity unreadable →
        party_features intact → ledger FKs valid
  - [ ] Key material never appears in logs — PII redaction test

### C-2b — S3 (MemoryObjectStore → AWS S3)

Implement AwsS3ObjectStore using @aws-sdk/client-s3:
  - PutObject with SSE-KMS (ServerSideEncryption: 'aws:kms')
  - GetObject
  - Signed URLs via @aws-sdk/s3-request-presigner, TTL ≤ 300 seconds
  - DeleteObject for purge
  - Bucket name from environment variable RBIT_S3_BUCKET
  - Content-type validated before upload — reject unknown types

Acceptance:
  - [ ] Upload → virus scan stub passes → stored in real S3
  - [ ] Signed URL expires at ≤5 minutes — asserted by requesting the URL
        after 6 minutes and confirming 403
  - [ ] Direct bucket access without signed URL → 403
  - [ ] PutObject uses SSE-KMS — assert from S3 object metadata

### C-2c — Temporal (InProcessSaga → Temporal Cloud or self-hosted)

Connect to Temporal. If self-hosted (on Fargate, separate service):
  - Deploy temporal server + worker as a separate ECS service
  - TEMPORAL_ADDRESS from environment variable

If Temporal Cloud:
  - TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_API_KEY from env

Migrate workflows:
  - ScreeningSaga → real Temporal workflow
  - PlacementHoldExpiry → real Temporal timer
  - OutcomeCaptureScheduler → real Temporal timer (30/90/180/365d)
  - SolarRemittanceStatement → real Temporal schedule
  - RebateEligibility → real Temporal workflow
  - IngestionFullReconcile → real Temporal schedule

Acceptance:
  - [ ] ScreeningSaga starts, waits for Certn webhook, completes —
        demonstrated with the Certn stub in staging
  - [ ] PlacementHoldExpiry fires at correct time —
        clock-accelerated integration test
  - [ ] 365-day outcome timer is scheduled and visible in Temporal UI

### C-2d — ElastiCache (in-memory → real Redis)

Connect session store and rate limiter to real ElastiCache endpoint.
REDIS_URL from environment variable.

Acceptance:
  - [ ] Session survives an app restart — log out, restart Fargate task,
        verify session cookie still authenticates
  - [ ] Rate limiter state persists across requests from different
        Fargate tasks — requires two tasks running simultaneously

### C-2e — Secrets Manager

All environment variables that are currently hardcoded or in .env
move to Secrets Manager:
  - Database credentials (already in Secrets Manager via Terraform)
  - Certn API key (placeholder until Klaus sends credentials)
  - Stripe secret key
  - Vault vendor API key (placeholder — D-14 unresolved)
  - JWT signing secret
  - Ingestion signing secrets

Secrets fetched at startup, cached for 1h, refreshed before expiry.
Application refuses to start if any required secret is missing.
(This is separate from the §18 config boot assertion — both run.)

Acceptance:
  - [ ] Application starts cleanly from ECS with all secrets from
        Secrets Manager — no .env file present
  - [ ] Secret rotation: rotate the JWT signing secret, verify in-flight
        sessions are not invalidated (dual-secret verification window)

## C-3 — Database provisioning

Against the real Aurora cluster:

1. Run all migrations in order
2. Run the seed file for dev/staging config namespaces
   (rs_price_book unapproved, hold_durations, sla, screening_policy)
3. Seed the notification sequences from B-9
4. Verify the boot assertion fires correctly against the empty
   production config (no approved config → app refuses to start in prod)

Acceptance:
  - [ ] All migrations apply cleanly from zero
  - [ ] psql output confirming RLS enabled on all scoped tables
  - [ ] Boot assertion fires on production environment with unapproved config
  - [ ] Re-run 22 previously PASS-AGAINST-STUB criteria against real infra,
        report status per criterion

## C-4 — Container build and ECS deployment

1. Dockerfile (multi-stage, ARM64):
   - Build stage: npm ci, tsc build
   - Runtime stage: node:lts-alpine ARM64, non-root user
   - No secrets in the image — all from Secrets Manager at runtime

2. ECR repository: push the built image

3. ECS task definition update: new image URI

4. ECS service update: rolling deploy, wait for stable

5. ALB health check: GET /health → 200 with
   { status: 'ok', db: 'connected', cache: 'connected', version: string }

6. CloudWatch log group /rbit/mvp/api receiving structured JSON

Acceptance:
  - [ ] /health returns 200 from the ALB DNS
  - [ ] Structured logs visible in CloudWatch
  - [ ] No secrets in the Docker image — confirmed by docker inspect
  - [ ] Fargate task running as non-root user

## C-5 — DNS and HTTPS

1. Request an ACM certificate for api.dwel.app (or the domain in use)
2. Add HTTPS listener on the ALB using the ACM cert
3. Add CNAME / A record in DNS pointing to the ALB
4. Verify HTTPS works end to end

Acceptance:
  - [ ] curl -I https://api.dwel.app/health → 200
  - [ ] HTTP → HTTPS redirect works
  - [ ] Certificate is valid and not self-signed

## C-6 — Smoke test suite

After deployment, run against the live staging environment:

1. Passwordless auth: request magic link, redeem, get a session
2. Create a renter profile, enable badge sharing, hit the public badge URL
3. Create a listing (manual adapter)
4. Run a renter search with a filter outside the allowlist → 400
5. Run a solar quick-quote → get a decision in < 500ms
6. Create a search alert, verify it is stored
7. Hit /health → 200
8. Hit a protected endpoint without auth → 401
9. Hit the broker performance endpoint as a renter → 403
10. Attempt an unbalanced ledger insert via psql → confirm trigger fires

All 10 must pass. Report pass/fail per test with the response or output.

---

# PART D — Evidence and reporting

After all parts complete, deliver:

## D-1 — Updated §17 status table

Re-run every criterion against the real infrastructure.
Criteria that were PASS-AGAINST-STUB should now be PASS or explain
why they are not.

| Status | Count (before C) | Count (after C) |
| PASS | 51 | ? |
| PASS-AGAINST-STUB | 16 | ? |
| PARTIAL | 9 | ? |
| FAIL | 1 | ? |
| TOTAL | 77 | 77 |

## D-2 — New feature acceptance summary

| Feature | All criteria met? | Evidence path |
|---|---|---|
| B-1 Badge sharing | | |
| B-2 Match score | | |
| B-3 Device prescreen | | |
| B-4 Broker dashboard | | |
| B-5 Search alerts | | |
| B-6 Leakage prompt | | |
| B-7 Remittance statements | | |
| B-8 Solar quick-quote | | |
| B-9 Notification sequences | | |

## D-3 — Smoke test results

All 10 smoke tests, pass/fail, with response output.

## D-4 — Infrastructure checklist

- [ ] Aurora cluster running and accessible from Fargate
- [ ] S3 bucket private, SSE-KMS confirmed
- [ ] KMS key with correct task role permissions
- [ ] ElastiCache reachable from Fargate security group only
- [ ] Secrets Manager secrets populated (non-placeholder)
- [ ] CloudWatch alarms active (billing $50, $150)
- [ ] /health returns 200 over HTTPS
- [ ] RLS confirmed on all scoped tables against real Aurora

## D-5 — What is NOT done and why

List every B or C item that is incomplete, the reason, and whether
it is blocked by a §18 decision, missing credentials, or scope.
Honest reporting only. Do not mark something complete if it was
not demonstrated with evidence.