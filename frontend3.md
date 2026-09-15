```
# RBIT dwel.20 — Demo Readiness Master Prompt

Goal: a stable, hosted, HTTPS, responsive web experience that lets us send a link
to landlords and prospective renters and have them see a real, working product —
using test/sandbox credentials (Stripe test keys, Certn sandbox). This is NOT a
production launch. Real payments, full two-way matching, native mobile, Temporal,
staging/prod infra, and Stripe Connect remain explicitly out of scope for this work.

Brand: RBIT green is #4dfa9f. Use this as the core accent — do not substitute a
generic SaaS green or default palette.

## Part 0 — Terraform / infra discipline (unchanged from prior work orders)
- Any Terraform change: produce the plan, show it, STOP. Do not apply without
  explicit confirmation, regardless of how small the diff appears.
- No changes to staging or production.
- No Stripe Connect implementation.
- No changes to landlord-interest pipeline behavior.

## Part 1 — HTTPS on the dev ALB (blocking everything else)
The frontend will be hosted on HTTPS by default (any modern host). The current
dev ALB is HTTP-only. Browsers will block API calls from an HTTPS frontend to
an HTTP backend as mixed content — this WILL break the demo silently if skipped.

Requirements:
- Determine what DNS name we control that can be used for the DEV/demo API.
  ACM public certificates require a domain we control and DNS validation.
- Do NOT attempt to issue an ACM certificate for the AWS-generated ALB
  hostname, and do NOT use a self-signed certificate for the client demo —
  it will throw a hard security warning to anyone clicking the link.
- If no usable domain/subdomain is currently available, STOP the HTTPS
  infrastructure portion and report the exact DNS record/certificate
  requirement needed. Continue building the frontend locally against a
  configurable API base URL in the meantime so frontend work isn't blocked.
- If a domain is available: provision the ACM cert via DNS validation, add
  an HTTPS (443) listener on the existing ALB forwarding to the existing
  target group. Keep the existing HTTP listener in place (redirect is
  nice-to-have, not required).
- Produce the Terraform plan for this change and STOP before applying.
- After I approve and apply: confirm the ALB serves the API correctly over
  HTTPS with a trusted certificate (no `-k`/insecure flags) before touching
  frontend hosting.

## Part 2 — Certn demo-safe behavior (already implemented, verify only)
Confirm the existing fail-closed behavior for `submit-screening` remains
correct once real Certn sandbox keys are added:
- if keys are present and valid: real sandbox screening executes normally
- if keys are absent or invalid: returns SCREENING_PROVIDER_UNAVAILABLE,
  no forward state transition, no fake "verified" result under any condition
Do not change this logic — just confirm it holds under both states before
demo day, since I may be demoing before or after the Certn key is populated.

## Part 3 — Renter-facing web app (primary deliverable)

### Design direction
Before writing code: propose a compact design plan (palette, type, layout,
principles) grounded in what dwel.20 actually is — a rental marketplace with
a cashback/incentive mechanic, not a generic SaaS product. Core accent is
#4dfa9f. Avoid default AI-generated design tells: no warm-cream-and-serif
combo, no near-black-with-single-accent template, no identical rounded
SaaS cards with the same soft shadow on everything, no tracked-out ALL-CAPS
eyebrow labels, no middle-dot metadata strings. Review your own plan against
these tells before building, revise anything that reads generic, then build
immediately after — no separate approval cycle needed.

One responsive web app, works well on desktop and mobile browsers — no
separate mobile build.

### Application access token handling — treat as a bearer credential
- Never log the token.
- Never send it to analytics.
- Never persist it in `localStorage`.
- Never expose it in page content after initial issuance beyond what's
  needed for the current session.
- Prefer the existing secure-link model (token embedded in a link the
  renter is given/saves) over client-side storage.
- If frontend persistence is genuinely necessary for the demo, use the
  safest mechanism compatible with the existing backend and document
  exactly what you chose and why.
- Do not invent a full account/login system to solve this.

### Screens/flows required
1. **Listing browse** — calls real `GET /v1/listings`. Filter/search UI can
   be minimal if the backend doesn't support rich filtering yet; do not fake
   filter results that don't actually filter.
2. **Listing detail** — calls real `GET /v1/listings/:id`.
3. **Apply** — calls real `POST /v1/applications`. On success, issue the
   application access link per the token-handling rules above.
4. **Consent** — calls the consent endpoint. If disclosure_version isn't
   configured in this environment, surface this as a clear "screening is
   not yet available" state, not a broken form.
5. **Screening submission** — calls submit-screening. Handle both real
   sandbox results AND `SCREENING_PROVIDER_UNAVAILABLE` gracefully with
   real UI copy, not a raw error dump.
6. **Application status** — calls `GET /v1/applications/:id` via the token.

### Explicit non-requirements
- No login/signup/account system — token-based access only, per existing
  backend design.
- No landlord-facing application review UI (out of scope for this pass).
- No payment collection UI — test Stripe keys exist but Stripe Connect
  integration is out of scope; do not build a checkout flow.
- No fake data, no fake "8 fresh matches today" style copy not backed by
  the real API response.
- Do not replicate the old Replit prototype's UI as a spec — it was a
  disconnected mockup, not a design reference to match pixel-for-pixel.

### Error/empty states
Follow real interface-writing principles: explain what happened and what
to do next, in plain language, no apologetic filler. An empty listings
result is a moment to say something useful, not just "no results."

## Part 4 — Landlord-facing calculator (secondary deliverable, high value)
Standalone page, no backend dependency required.

### Inputs
- monthly rent
- unit count
- turnover frequency (default: every 2 years, editable)
- current leasing/broker fee (landlord's existing cost, editable)
- current concession (landlord's existing cost, editable)
- dwel.20 listing fee (prefill from current internal pricing model, editable)
- dwel.20 tenant incentive % (prefill from current internal pricing model, editable)
- screening credit/rebate, if applicable (editable)
- landlord's cap rate (default illustrative: 5.5%, clearly labeled as
  illustrative and editable — always let the landlord enter their own)

### Formula (show all steps, don't black-box it — landlords will check this)
```
traditional_turnover_cost = current_leasing_fee + current_concession

dwel_turnover_cost = dwel_listing_fee
                    + (monthly_rent * dwel_incentive_percent)
                    - screening_credit

savings_per_turnover = traditional_turnover_cost - dwel_turnover_cost

annual_turnovers = unit_count / turnover_frequency_years

annual_noi_gain = savings_per_turnover * annual_turnovers

property_value_created = annual_noi_gain / cap_rate
```

### Constraints
- Do NOT hardcode "no concessions," specific fill-time-speed numbers (e.g.
  "48 hours"), or claim uniform savings across all rent tiers — the internal
  packaging framework explicitly flags these as things to avoid overstating.
- Label the dwel.20 fee/incentive percentages in the UI as "current program
  terms" or equivalent — these are the current internal pricing model, not
  finalized or contractually guaranteed pricing. Do not present them as
  fixed or guaranteed.
- No auth, no backend call — pure frontend calculation.

## Part 5 — Hosting and domain
- Host the renter app + calculator on a stable HTTPS URL (Vercel, Amplify,
  or similar — your choice, report which and why).
- Use whatever domain/subdomain was resolved in Part 1; if none is available
  yet, use the hosting platform's default HTTPS URL and report it plainly —
  don't block frontend hosting on the unresolved broader domain-strategy
  decision (RBIT Financial vs. separate product domains).
- Confirm the hosted frontend successfully calls the real HTTPS backend
  end-to-end before calling this done.

## Definition of Done
- Landlord calculator: fully functional, standalone, transparent math, live
  at a real URL.
- Renter flow: browse → detail → apply → consent → submit-screening →
  status, all working against the real HTTPS backend, live at a real URL.
- Both pass a basic mobile-width smoke test (resize/responsive check).
- Screening gracefully handles both "Certn configured" and "Certn not
  configured" states.
- Application access token never touches localStorage/logs/analytics.
- No fake data, no fake auth state, no hardcoded results anywhere.
- Terraform: only the ACM/HTTPS listener change, shown as a plan and
  approved before apply — nothing else touched.

## Final report must include
1. Design plan (palette/type/layout/principles) and how it was reviewed
   against generic-AI-design tells.
2. HTTPS/ACM: DNS name used, what was created, Terraform diff, apply
   confirmation.
3. Hosted URLs (frontend + confirm backend HTTPS reachable).
4. Screens/flows implemented, tested against real API (not mocked).
5. Calculator: formula implementation, default assumptions, and where
   "current program terms" labeling was applied.
6. Token-handling approach used for the application access link.
7. What remains explicitly out of scope for this pass (Stripe Connect,
   landlord review UI, native mobile, two-way matching, staging/prod).
8. Any blockers requiring my input before demo day.
```