dwel.20 UX Punch List
Sep 17, 2026
Prioritized fixes from 9/17 walkthrough. Each item is scoped for a single Cursor task.
P0 — Product logic bugs
1. Gate approval on screening completion
What's wrong: Landlord can tap Approve and reveal contact info while credit, criminal, eviction, and identity all read "unknown." This breaks the landlord landing page promise ("contact reveal only after you approve") — because approval is supposed to happen after screening.
Fix: Disable the Approve button until at least one screening dimension returns a real result. Show a banner: "Screening in progress — you can approve once results are in." If screening hasn't been triggered yet, show "Request screening" instead of Approve.
Scope: Applicant detail view component, approval mutation/handler, screening status enum.
2. Audit contact-reveal trigger
What's wrong: Confirm that the contact-reveal API fires only on an explicit landlord action, not automatically on page load. The reveal timestamp is there (good) — just verify the trigger path is correct.
Fix: Contact reveal = separate logged action, gated on approval status transition. Don't fire on render.
P1 — Raw system values in UI
3. Add display-name map for all enums
What's wrong: Database enum values render directly in user-facing cards: 200k_plus, within_30_days, rules_based_v1. Underscored, code-style labels kill credibility instantly.
Fix: Create a shared displayName map (or utility function) that converts every enum to its human label:
• 200k_plus → "$200k+"
• within_30_days → "Within 30 days"
• within_60_days → "Within 60 days"
• rules_based_v1 → (don't show this label at all — see item 4)
Apply everywhere an enum touches the UI: applicant cards, listing details, filters.
Scope: Shared utility + every component that renders applicant or listing data.
4. Rename the scoring label
What's wrong: "75 / rules_based_v1" means nothing to a landlord. It's a system version tag, not a user-facing label.
Fix: Replace with "Dwel Score" or "Match Score." Show just the number with the label. Add a tooltip or subtitle: "Based on income, timeline, and household fit." Drop the version tag entirely from the UI (keep it in the API response / logs for debugging).
P2 — Empty states and dead-end pages
5. Broker overview — make it an onboarding checklist
What's wrong: Broker lands on the overview and sees: balance $0, Connect restricted, everything gated on licensing, and nothing to do. The "Payouts available once licensing is finalized" and "Funding & lead purchase" blocks are informational dead-ends — text without actions.
Fix: Convert the overview into a clear onboarding checklist with status indicators:
• ✅ Account created
• 🔄 Stripe Connect onboarding (with CTA button — you already have this one)
• ⏳ BOR licensing verification (link to submit or status)
• ⏳ Payouts activation (auto-enabled once licensing clears)
Each step should show its state and have an action if the broker can do something. If a step is blocked on RBIT (like licensing review), say so explicitly: "We're reviewing your license — you'll get an email when payouts are enabled."
6. Broker dashboard — add empty-state guidance
What's wrong: Dashboard shows a grid of zeros (Leads Offered: 0, Accepted: 0, Placements Closed: 0, etc.) with no context. "No submarket rows yet" with a raw table name reference (broker_performance_submarket).
Fix: Replace the zero grid with a single empty-state card: "Your dashboard will populate once your brokerage is active and leads start flowing. Complete onboarding to get started." Link back to the overview/checklist. Remove the raw table name — replace with: "Submarket metrics will appear here once you have active coverage."
7. Leads page — add empty-state copy
What's wrong: "No leads in this window" is fine as a message, but the page feels abandoned with just filters and nothing else.
Fix: Add a subtitle to the empty state: "Leads matched to your brokerage will appear here. Make sure your coverage areas and licensing are set up." Optionally link to settings/onboarding.
P3 — Copy and naming
8. Rename "Self-execution" → "License verification" or "Direct licensing"
What's wrong: "Self-execution" sounds like a death sentence, not a real-estate feature. The concept is landlords who hold their own license and can execute leases without a BOR — the name should say that.
Fix:
• Nav label: "Direct licensing" or "License verification"
• Page title: "License verification"
• Subtitle: "If you hold a real estate license in your listing state, submit your credentials to execute leases directly."
• Update all references in nav, breadcrumbs, and any API route names that surface in URLs (the current URL reads /self-execution — change to /license-verification or /direct-licensing).
9. Copywriting pass on all user-facing strings
What's wrong: Multiple strings read like spec descriptions or placeholder copy rather than product language. Examples: "Active units with applicants waiting for review," "Metrics appear after coverage and lead activity land in broker_performance_submarket," "Next steps: coordinate lease execution with your broker or directly if you hold a license in this state."
Fix: Audit every user-facing string for: raw table/column names, overly technical phrasing, passive voice that doesn't tell the user what to do. This is a sweep, not a single fix — budget 2–3 hours of copy review. Prioritize the landlord portal and broker portal since those are the money paths.
P4 — CSS / layout
10. Fix chat panel scroll on home page
What's wrong: The Dwel Guide chat panel on the landing page extends the page body instead of scrolling within its own container. As the conversation grows, the entire page stretches downward and the hero section disappears above the fold.
Fix: Set a fixed height on the chat container (e.g. max-height: 70vh or match the hero panel height) with overflow-y: auto. The chat should scroll internally while the two-panel layout stays stable. Test on mobile too — the chat may need to go full-width below the hero on narrow viewports.
Scope: Landing page layout component, chat container CSS.
11. Payments page — Stripe status section layout
What's wrong: The payments settings page (broker portal) shows "Charges off · Payouts capability off · Details incomplete" as a flat text line. The "Continue Stripe onboarding" button is good, but the status indicators above it look like debug output.
Fix: Turn the status line into a small status grid or checklist:
• Charges: Not active
• Payouts: Not active
• Account details: Incomplete
Each with a colored dot or icon. Keep the "Continue Stripe onboarding" CTA prominent below.