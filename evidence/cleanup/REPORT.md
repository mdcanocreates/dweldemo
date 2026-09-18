# UI/UX Cleanup Sprint — execution report

Date: 2026-09-17  
Branch: `design-carbon-copy-v2`  
Spec: `cleanup.md`  
Preview: https://del0g7dwwfzj2.cloudfront.net  
Live CDN: untouched (https://d1j0s2h5mond9a.cloudfront.net)

Section 7 (Certn qualification scoring) is architecture-only — not built.

## Checklist (§9)

| Criterion | Status |
|---|---|
| Zero `interim_v1` in rendered UI | PASS |
| Zero S3 / lead_offer / API / HTTP / server-paginated / wired / coverage feeds / assignment APIs in rendered UI | PASS |
| Zero BROKER/OWNER WORKSPACE labels | PASS |
| Zero ONLINE · PROFILE ONBOARDING · NO AI MODEL | PASS |
| Zero REVIEW / step tags on Dwel guide | PASS |
| NOI calculator hidden from anon + tenant top nav; route redirects others to sign-in | PASS |
| City pills removed (Option A) | PASS |
| Cashback badge = amount only | PASS |
| Chat input pinned to bottom of panel | PASS |
| Onboarding ≤8 questions (name, email, phone, location, budget, beds, timeline, pets) | PASS |
| No vehicle / employment / references in chat | PASS |
| Landlord photo hint = “JPEG or PNG, up to 5 MB.” | PASS |
| Portfolio pulse = “Live vacancy and applicant activity.” | PASS |
| NOI banner cleaned (no internal modeling; proper spacing) | PASS |
| Space Grotesk + DM Sans retained | PASS |

## Key file changes

- `Shell.tsx` — NOI nav landlord/broker only
- `CalculatorPage.tsx` — role gate + banner copy
- `ListingsPage.tsx` — dynamic match count; no city pills; clean cashback badge
- `HomePage.tsx` / `GuidedChat.tsx` / `profileMachine.ts` — slim matching chat; no status/step tags; composer pinned
- `applicationMachine.ts` — interest confirm only (Certn collects screening later)
- `BrokerPortal.tsx` / `LandlordPortal.tsx` — workspace labels, lead/listings empty copy, S3/Connect language
- `PortalShell.tsx` — hide empty eyebrow

## Non-goals

- Section 7 qualification score UI — deferred
- Merge to live CDN — awaiting sign-off
