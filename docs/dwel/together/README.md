# Dwel Together — implementation branch

Flag: `DWEL_TOGETHER=1` (default off). Do not expose incomplete UI on production.

## Vertical slice v0
1. `household` + `household_member` + `household_invite` tables (migration slot after marketplace/authority unify: propose `0082+`)
2. APIs: create household, invite by email, accept/reject, list shared saved homes, remove member
3. Authorization: each member keeps own party_id; shared collection is membership-scoped; no dossier leakage
4. Nav entry "Roommates" only when flag on and household exists or create CTA

## Out of scope for v0
Coordinated multi-applicant formal applications (v1), Authority case sharing, Roommate Match discovery.
