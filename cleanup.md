# dwel.20 — UI/UX Cleanup Sprint (Master Prompt)
#
# Context: CTO review identified pervasive "AI slop" — internal implementation
# vocabulary, debug metadata, engineering TODOs, and placeholder copy that
# leaked into user-facing surfaces. This prompt defines every fix, the design
# principle behind it, and the testing criteria. Work through each section
# file-by-file. Do NOT skip items. Do NOT introduce new placeholder copy.
#
# Design north star: "Would Zillow ship this string to a renter?"
# If the answer is no, the string does not belong in the UI.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: GLOBAL RULES (apply everywhere before touching individual pages)
# ═══════════════════════════════════════════════════════════════════════════════

## 1.1 — Kill all `interim_v1` leaks
# The `interim_v1` tag is an internal config label for the solar queue's
# degraded-mode FIFO. It must NEVER render in any UI surface.
#
# Search: grep -rn "interim_v1" across all frontend source files.
# For each hit:
#   - If it's in a cashback badge overlay (listing cards), remove the tag line
#     entirely. The badge should show ONLY the dollar amount, e.g. "$90 back".
#     No version suffix, no config tag, no label beneath the amount.
#   - If it's in a page header (e.g. Self-execution evidence page), remove it.
#   - If it's in a data attribute or className used for styling/logic only
#     (not rendered), leave it but add a comment: `// internal — never render`
#
# Test: visually inspect every listing card, every badge, every page header.
# Zero instances of "interim_v1" in rendered output.

## 1.2 — Purge engineering copy from all user-facing strings
# The following phrases are internal implementation details. Find and replace
# or remove every instance in rendered UI:
#
# | Find (rendered text)                                        | Replace with                                |
# |-------------------------------------------------------------|---------------------------------------------|
# | "Server-paginated from live lead_offer records (25 / page)" | (delete entirely — show nothing)            |
# | "real lead_offer rows"                                      | (delete — or rewrite parent sentence)       |
# | "Offered leads for your brokerage will appear here from real lead_offer rows." | "Leads matched to your brokerage will appear here." |
# | "Coverage listings not wired as a live feed yet"            | "No listings yet"                           |
# | "Browse the public marketplace for active inventory. Broker-specific coverage feeds will attach when assignment APIs are exposed over HTTP." | "Listings assigned to your brokerage will appear here." |
# | "Uploaded via S3 after create. Prefer JPEG/PNG under 5MB."  | "JPEG or PNG, up to 5 MB."                  |
# | "ONLINE · PROFILE ONBOARDING · NO AI MODEL"                | (delete entirely)                           |
# | "BROKER WORKSPACE"                                          | (delete — "Broker portal" is sufficient)    |
# | "OWNER WORKSPACE"                                           | (delete — "Landlord portal" is sufficient)  |
# | "2 FRESH MATCHES TODAY"                                     | see §2.1 below                              |
#
# General rule: if a string references a database table name, an AWS service,
# an API endpoint, a pagination strategy, an internal queue tag, or a config
# version — it does not belong in the UI. Delete it or replace it with plain
# English that a renter/landlord/broker would understand.
#
# Test: grep for "S3", "lead_offer", "interim", "API", "HTTP", "server-paginated",
# "wired", "exposed", "coverage feeds", "assignment APIs" in any JSX/TSX
# return block or any string that feeds into rendered text. Zero hits.

## 1.3 — Remove NOI calculator from public navigation
# The NOI Impact Calculator is a landlord/broker conversion tool.
# It should NOT appear in:
#   - The public top nav (the "Find a home" / tenant-facing header)
#   - Any tenant-facing page or route
#
# It SHOULD appear in:
#   - Landlord portal sidebar (already there)
#   - Broker portal sidebar (add if missing)
#   - Landlord portal "Quick links" section (already there)
#
# Implementation: the top-level nav component likely conditionally renders
# links based on auth role. Ensure NOI calculator link renders ONLY when
# the user has a landlord or broker role. If there is no role gating on
# the top nav, add it — the NOI calc route itself should also redirect
# unauthenticated users or tenants to the login page or 404.
#
# Test: visit the app as an unauthenticated user and as a tenant.
# NOI calculator link must not appear anywhere. Visit as landlord — it appears.

## 1.4 — Remove the "REVIEW" tag from the Dwel guide header
# The tag reading "REVIEW" next to the Dwel guide title serves no user purpose.
# Delete it entirely. If it was intended as a mode indicator for internal QA,
# gate it behind a dev/debug flag that is OFF in production builds.
#
# Test: Dwel guide header shows only "Dwel guide" — no tags, no badges.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: TENANT MARKETPLACE (Find a home)
# ═══════════════════════════════════════════════════════════════════════════════

## 2.1 — Fix the "fresh matches" counter
# Current: "2 FRESH MATCHES TODAY" — reads like marketing filler.
# Fix: Either show a real, dynamic count ("2 homes match your search") that
# updates when filters change, or remove the line entirely if it's hardcoded.
# Do NOT use "fresh" — it implies a judgment about recency that requires
# a defined SLA (what's "fresh"? listed today? this week?).
#
# If this is driven by actual data (e.g. listings created in the last 24h),
# rephrase to: "{n} new listings" — and only show it when n > 0.
# If it's hardcoded or a placeholder, delete the entire element.

## 2.2 — Fix city filter pills (Columbus, New York, Austin, Boston, Miami)
# These appear to be hardcoded. Three options, pick one:
#
# Option A (recommended for pre-launch): Remove the pills entirely. Let the
#   search bar and location input handle filtering. No city pills = no false
#   promises about market coverage.
#
# Option B (if you want to keep them): Drive them from the database. Query
#   distinct cities where active listings exist. Render a pill for each city
#   that has ≥1 active listing. "All" pill always shows. If only one city
#   has listings, show "All" + that one city. If zero cities have listings,
#   show nothing.
#
# Option C (manual curated list): Only show cities where RBIT has confirmed
#   broker-of-record coverage AND active listings. Since broker licensing
#   is still pending per-state, this likely means showing nothing right now.
#
# Whichever option: do NOT show city pills for markets with zero inventory.
# An empty filter result is worse than no filter.
#
# Implementation for Option B:
#   - API endpoint: GET /api/listings/active-cities → returns string[]
#   - Frontend: fetch on page load, render pills from response
#   - Cache for 15 minutes (listings don't change that fast)
#
# Test: if using Option B, create listings in 2 cities only. Verify only
# those 2 cities + "All" render as pills. Delete all listings — verify
# no city pills render (or "All" alone).

## 2.3 — Clean up listing card badges
# Current: badge shows "$90 back" with "interim_v1" underneath.
# Fix: badge shows ONLY "$90 back" — no subtitle, no version tag.
# The badge component should accept a single `amount` prop and render:
#   <Badge>${amount} back</Badge>
# No secondary text. No config metadata.
#
# Visual spec: mint green (#4dfa9f) background, dark text, rounded corners,
# positioned top-right of the listing card image area. Monospace or
# semi-bold weight for the dollar amount.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: LANDING PAGE & DWEL GUIDE
# ═══════════════════════════════════════════════════════════════════════════════

## 3.1 — Fix hero market labels
# Current: "AUSTIN · BOSTON · MIAMI" in small caps above the headline.
# Problem: same as §2.2 — if you don't have inventory or broker coverage
# in these cities, don't claim them.
#
# Fix: Either remove the city labels entirely (the headline "Move with
# more back." stands on its own), OR drive them from the same active-cities
# data source described in §2.2 Option B.
#
# If removing: delete the element. Don't replace with other filler text.
# The hero should be: headline → subheadline → CTA buttons. Clean.

## 3.2 — Clean up Dwel guide chat panel
# Issues to fix:
#
# a) Delete "ONLINE · PROFILE ONBOARDING · NO AI MODEL" status line.
#    This is debug metadata. The user does not need to know the system's
#    internal state, what mode the guide is in, or whether an AI model is
#    loaded. Remove the entire element.
#
# b) Delete the "REVIEW" tag/badge near the guide title.
#    See §1.4.
#
# c) Fix chat input positioning. The text input ("Type your answer...")
#    and Send button should be pinned to the bottom of the guide panel,
#    not floating in the middle. Use a flex column layout:
#      - Guide header (top, fixed)
#      - Message area (middle, flex-grow, overflow-y: auto)
#      - Input area (bottom, fixed)
#    This is standard chat UI layout.
#
# d) Simplify the profile summary bubble. Current shows raw data fields.
#    Format it as a readable summary, not a debug dump:
#    Instead of "Income ~$2880000/yr · max rent $2880000/mo" show clean
#    formatted values. (Note: those values also look like test data —
#    $2.88M income and $2.88M max rent are obviously sandbox numbers.
#    That's fine for dev, but the FORMAT should be clean for prod.)

## 3.3 — Slim down the onboarding chat questions
# The Dwel guide chat collects the renter's profile. It should ask for
# the BARE MINIMUM needed to match listings, because Certn handles
# identity verification and screening separately.
#
# KEEP these questions (required for matching):
#   1. Name
#   2. Email
#   3. Phone
#   4. Target location (city/state or neighborhood)
#   5. Max monthly rent budget
#   6. Minimum bedrooms (1+, 2+, 3+, etc.)
#   7. Move-in timeline (ASAP / within 30 days / within 60 days / flexible)
#   8. Pets (yes/no — landlords need this for filtering)
#
# CUT these questions (Certn collects them, or they're unnecessary friction):
#   - Vehicle information
#   - Employer name / employment history
#   - SSN or any ID numbers
#   - Detailed income breakdown (a simple "approximate annual income" is
#     fine for the 3x-rent affordability check — one number, not a form)
#   - References
#   - Rental history details
#   - Credit score self-report
#
# The principle: every question you ask before showing listings is friction
# that kills conversion. Collect the minimum to match, show listings fast,
# then collect screening data (via Certn) only when the renter expresses
# interest in a specific listing.
#
# Implementation: review the chat flow state machine / question sequence.
# Remove any steps that collect data Certn will re-collect. The profile
# object stored in the database should have nullable fields for the cut
# questions — don't break the schema, just stop asking.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: BROKER PORTAL
# ═══════════════════════════════════════════════════════════════════════════════

## 4.1 — Remove redundant "BROKER WORKSPACE" label
# Current: "BROKER WORKSPACE" in small caps above "Broker portal".
# Fix: delete "BROKER WORKSPACE". "Broker portal" is the page title.
# One label is enough.
#
# Same fix for landlord portal: delete "OWNER WORKSPACE" above
# "Landlord portal".

## 4.2 — Clean up Lead history page
# a) Delete "Server-paginated from live lead_offer records (25 / page)."
#    Show nothing — the pagination controls speak for themselves.
#
# b) Fix empty state copy:
#    Current: "No leads in this window / Offered leads for your brokerage
#    will appear here from real lead_offer rows."
#    Replace with: "No leads in this window / Leads matched to your
#    brokerage will appear here."
#
# c) Filter labels are fine (Status, From, To) — keep those.

## 4.3 — Fix Listings page
# Current: "Coverage listings not wired as a live feed yet / Browse the
# public marketplace for active inventory. Broker-specific coverage feeds
# will attach when assignment APIs are exposed over HTTP."
#
# This is an engineering status note, not user copy. Replace with:
#   Title: "Listings"
#   Empty state: "No listings assigned yet. / Listings in your coverage
#   area will appear here."
#
# If the feature genuinely isn't built yet and you want to hide the page
# entirely, remove "Listings" from the broker sidebar nav until the
# feature ships. An empty page with an engineering TODO is worse than
# no page.

## 4.4 — Fix sidebar card
# The mint green card at the bottom of the broker sidebar reads:
#   "DWEL.20 FOR BROKERS / Track leads, performance, and Connect payouts.
#    Tenant view →"
#
# "Connect payouts" references Stripe Connect internals. Replace with:
#   "DWEL.20 FOR BROKERS / Track leads, performance, and payouts.
#    Tenant view →"
#
# Same issue on the landlord sidebar card — check for any Stripe/Connect
# references and remove them.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: LANDLORD PORTAL
# ═══════════════════════════════════════════════════════════════════════════════

## 5.1 — Remove "OWNER WORKSPACE" label
# See §4.1. Delete it. "Landlord portal" is sufficient.

## 5.2 — Fix new listing form
# a) Photo upload help text:
#    Current: "Uploaded via S3 after create. Prefer JPEG/PNG under 5MB."
#    Replace: "JPEG or PNG, up to 5 MB."
#
# b) Review all other field labels and help text on the form for any
#    engineering language. "Amenities (comma-separated)" is borderline
#    acceptable but could be "Amenities (e.g. parking, laundry, AC)".

## 5.3 — Fix Self-execution evidence page
# a) Remove "INTERIM_V1" header label. See §1.1.
#
# b) The description "Manual verification only. Pending blocks
#    re-submission; rejected allows another attempt." is acceptable
#    as-is — it describes the workflow to the landlord.
#
# c) Ensure the form fields (State of licensure, License type,
#    License number, Business entity name, Supporting documentation)
#    are clean. They look fine in the screenshot.

## 5.4 — Fix Portfolio pulse page
# a) "Live vacancy and applicant signal — no fabricated stats."
#    The "no fabricated stats" part is defensive internal language.
#    Replace with: "Live vacancy and applicant activity."
#
# b) Stat cards (LISTINGS: 1, ACTIVE: 1, APPLICANTS: 0, NEED ATTENTION: 0)
#    are clean — keep them.
#
# c) "Latest applicants / No applicants yet." — clean, keep it.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: NOI IMPACT CALCULATOR
# ═══════════════════════════════════════════════════════════════════════════════

## 6.1 — Fix assumptions banner
# Current: "Assumptions are editablePrefills are illustrative starting
# points from internal modeling (including a mid-tier listing fee and a
# 20% renter incentive). They are not contractual pricing."
#
# Issues: (a) missing space between "editable" and "Prefills", (b) the
# copy is too long and defensive.
#
# Replace with: "Assumptions are editable. Default values are illustrative
# and are not contractual pricing."
#
# That's it. They don't need to know about "internal modeling" or
# "mid-tier listing fees."

## 6.2 — Route restriction
# See §1.3. Ensure this page is only accessible to landlord and broker
# roles. Remove from public/tenant navigation.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: PROFILE SCORING & CERTN DATA USAGE (architecture note)
# ═══════════════════════════════════════════════════════════════════════════════
#
# This is NOT a UI fix — it's an architecture note for the next sprint.
#
# Goal: Use Certn screening results + profile data to help landlords and
# brokers see which applicants are most qualified, without violating FCRA.
#
# What we CAN surface to landlords (non-FCRA, derived from profile data):
#   - Income-to-rent ratio (self-reported income ÷ listing rent)
#   - Profile completeness score (% of optional fields filled)
#   - Move-in readiness (timeline alignment with listing availability)
#   - Pet compatibility (pet owner vs. pet-friendly listing)
#
# What we can surface from Certn (FCRA-regulated, with consent):
#   - Pass / Fail / Conditional against landlord's stated screening criteria
#   - A qualification badge: "Meets criteria" / "Conditionally qualified" /
#     "Pending screening"
#   - We CANNOT surface raw credit scores, criminal records, or eviction
#     details as a "ranking" — that's an adverse-action minefield.
#
# Implementation approach:
#   - Add a `qualification_score` computed field to the applicant profile
#   - Score = weighted sum of: income_ratio (40%), profile_completeness (20%),
#     timeline_match (20%), screening_status (20%)
#   - screening_status maps: passed=1.0, conditional=0.5, pending=0.3, failed=0.0
#   - Landlord sees applicants sorted by this score, with the badge visible
#   - Raw Certn data stays behind the screening report view (existing flow)
#
# This is NOT built yet. Requires:
#   1. Certn credentials populated (pending)
#   2. FCRA consent copy signed off by Jacob
#   3. Screening integration live
#   4. Score computation logic added to the applicant model
#   5. Landlord applicant list UI updated to show badges + sort by score

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: DESIGN SYSTEM CONSISTENCY CHECK
# ═══════════════════════════════════════════════════════════════════════════════

## 8.1 — Font consistency
# Design system specifies: Space Grotesk (headings) + DM Sans (body).
# Audit all pages for:
#   - font-mono eyebrow labels: these are correct for small metadata
#     labels (like "MULTIFAMILY", "RESIDENTIAL" on listing cards)
#   - But "AUSTIN · BOSTON · MIAMI" on the hero page is using font-mono
#     in a context where it looks like a debug label, not a design choice.
#     If keeping city labels (see §3.1), use DM Sans small caps instead.
#
# All-caps usage should be limited to:
#   - Listing type badges (MULTIFAMILY, RESIDENTIAL) — keep
#   - Sidebar section labels (WORKSPACE, BROKER DESK) — these are being
#     removed per §4.1, so moot
#   - Nav items — these should NOT be all-caps; use title case
#
# Per the design skill guidance: avoid "using all caps for labels" as a
# default treatment. The listing type badges are an intentional exception
# (industry convention). Everything else should be title case or sentence case.

## 8.2 — Color usage
# RBIT mint green (#4dfa9f) should be used for:
#   - Primary CTA buttons (Search homes, Start matching, Create listing)
#   - Cashback badges on listing cards
#   - Active sidebar nav items
#   - Accent elements (the sidebar bottom card)
#
# It should NOT be used as a large background fill that makes areas look
# like a "yellow/green canvas" (the broker sidebar card is borderline).
# Keep the accent card compact and ensure contrast ratios pass WCAG AA
# against the dark sidebar background.

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 9: TESTING CHECKLIST
# ═══════════════════════════════════════════════════════════════════════════════
#
# After all fixes, verify:
#
# [ ] Zero instances of "interim_v1" in any rendered UI
# [ ] Zero instances of "S3", "lead_offer", "API", "HTTP", "server-paginated",
#     "wired", "exposed", "coverage feeds", "assignment APIs" in rendered UI
# [ ] Zero instances of "BROKER WORKSPACE" or "OWNER WORKSPACE" labels
# [ ] Zero instances of "ONLINE · PROFILE ONBOARDING · NO AI MODEL"
# [ ] Zero instances of "REVIEW" tag on the Dwel guide
# [ ] NOI calculator not visible to unauthenticated or tenant users
# [ ] City filter pills either removed or driven from live data
# [ ] Cashback badges show only dollar amount, no suffix
# [ ] Chat input pinned to bottom of guide panel
# [ ] Onboarding chat asks ≤8 questions (name, email, phone, location,
#     budget, beds, timeline, pets)
# [ ] No vehicle, employment history, SSN, or references questions in chat
# [ ] Landlord photo upload says "JPEG or PNG, up to 5 MB." — no S3 mention
# [ ] Portfolio pulse says "Live vacancy and applicant activity." — no
#     "no fabricated stats"
# [ ] NOI banner has space between sentences, no "internal modeling" language
# [ ] All pages use Space Grotesk + DM Sans consistently
# [ ] No engineering TODO comments rendered as visible UI text