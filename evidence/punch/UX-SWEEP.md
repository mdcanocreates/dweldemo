# UX fix sweep — 2026-09-18

Preview: https://del0g7dwwfzj2.cloudfront.net  
Design ref: `Dwel.20 Matching Homes Landing Page.png`

## 1. Landing scroll lock
- `Shell lockViewport` → `100dvh` + `overflow: hidden` on shell/page
- `.hero-chat-section` / `.hero-panel` / `.chat-panel` / `.chat-messages` / `.chat-input`
- Chips inside scrolling message area; composer pinned outside
- Subtle line-art on hero (design insp)
- Mobile &lt;768px: stack, chat `min-height: 60vh`

## 2. Callouts
- Removed `.callout.warn` yellow fills
- `.callout-attention` (amber left border) / `.callout-info` (mint left border)
- Applied to needs-attention, licensing review, screening banner, errors

## 3–4. Enums + approve gate
- Expanded `displayNames.ts` (incl. `not_run`, `pass`/`fail`)
- Approve still gated FE+BE; tooltip on disabled Approve

## 5. Labels
- Direct licensing route already live; redirects from self-execution
- `toTitleCase` / `formatPersonName` / title-cased `formatAddress`

## 6. Empty states
- Broker dashboard: “Your dashboard” + onboarding CTA
- Leads: “No leads yet — … once your coverage areas are active.”
