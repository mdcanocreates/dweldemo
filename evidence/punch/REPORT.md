# Punch list execution — 2026-09-17

Spec: `punch.md`  
Preview: https://del0g7dwwfzj2.cloudfront.net  
Live CDN: untouched

## P0
1. **Approve gated on screening** — UI disables Approve until status is screening-complete/screened **and** at least one screening dimension is not unknown; banner “Screening in progress — you can approve once results are in.”; pre-screen shows “Request screening.” Backend `decideOnApplicant` rejects approve without ready status + at least one completed/failed report. Contact reveal still only stamped on approve (never on GET) — audited in `listListingApplicants` + `decideOnApplicant`.
2. **Contact-reveal audit** — Confirm: reveal timestamp written only in approve branch; list endpoint returns contact only when `approved && contact_revealed_at`.

## P1
3. **`displayName()`** — `web/src/displayNames.ts` maps income bands, urgency, statuses, screening results. Applied on applicant cards.
4. **Match Score** — Shows “Match Score” + number; tooltip explains fit; `rules_based_v1` removed from UI.

## P2
5. Broker overview → onboarding checklist with actions.
6. Dashboard empty state + submarket copy (no table names).
7. Leads empty state + link to onboarding.

## P3
8. “Self-execution” → “Direct licensing” / “License verification”; routes `/license-verification` with redirects from old paths.
9. Copy pass on landlord attention callout, marketing promise, broker payments, contact next-steps.

## P4
10. Home chat: fixed-height split; guide scrolls internally (`max-height` / flex).
11. Payments: status grid (Charges / Payouts / Account details) + CTA.

## Deploy notes
- Web preview updated.
- API change in `src/modules/landlord/portal.ts` requires API image redeploy for server-side approve gate to enforce in DEV.
