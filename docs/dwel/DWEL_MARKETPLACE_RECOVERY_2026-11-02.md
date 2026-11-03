# Marketplace recovery — inventory diagnosis & empty-catalog UX

**Date:** 2026-11-02  
**Live frontend before this pass:** `3ea3bf6`  
**API:** `rbit-dev-api:20` / `20261023-9d980b0` (unchanged)

## 1. Why production shows zero homes

| Layer | Finding |
| --- | --- |
| Public API `GET /v1/listings` | Returns **15** `active` listings (pagination present) |
| Client filter `publishablePublicListings` | Classifies **15 / 15 as fictional** (Mock, Fake, Illusion, Mirage, Storybook, Pretend, Fable, Imaginary, Phantom, Drury Lane, Phase4 Seed, Dev Sandbox) |
| Publishable after filter | **0** |
| Aurora direct query | **Blocked** from this workstation (RDS security group timeout). API sample is the production truth for public catalog. |
| `listing.is_demo` on Aurora | Not available to the running API image (0077 not deployed); fiction hide is **frontend-only** |

**Root cause:** the only homes the production API currently returns are seed/demo-style fictional addresses. The frontend correctly refuses to display them. This is not a CloudFront or routing failure.

## 2. Inventory counts (production public API sample)

| Category | Count |
| --- | --- |
| Active listings returned by API | 15 |
| Fictional / seed (client) | 15 |
| Non-fictional in that response | 0 |
| Verified availability for rent | 0 evidenced |
| Documented publication rights | 0 |
| Publishable now | **0** |

### External package reconciliation (local B0)

From `docs/dwel/evidence/2026-11-02-external-listing-package-reconciliation.json`:

- Distinct external IDs: **1146**
- Rights approved for publish: **0**
- Packages are lead/contact sources (deals + HUD directories), not proof of vacancy or display license

## 3. Empty-catalog UX (this deploy)

When publishable count is 0:

- Hide Map toggle, sort/filter chrome, and savings card
- Show consumer copy: “Homes are coming soon”
- Capture city, bedrooms, budget, email
- Verify email with existing email-code flow
- Persist preferences locally / renter draft
- Automatically restore normal List/Map chrome when publishable listings return

## 4. What we need from you to publish real homes

1. **Authorized feed or provider agreement** (or signed permission to display specific properties)
2. **Current vacancy confirmation** (or explicit inquiry-only labeling)
3. **Licensed photos** or approval to use a non-property fallback
4. **Verified leasing contact** for consented leads
5. Optional: **1–5 pilot properties** entered manually by a verified provider account

Until then, ZIP quarantine must stay unpublished.

## 5. Next activation steps (post-inventory)

1. Provider-created or rights-approved listings → public List restores automatically  
2. Licensed map tiles → enable `VITE_DWEL_MAP_*`  
3. Verified offers already supported in DTO when present  
4. Heart / savings / consented inquiry exist on branch; keep outbound email + Stripe live off until approved  
