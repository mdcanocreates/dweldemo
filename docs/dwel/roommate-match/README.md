# Roommate Match — implementation branch

Flag: `DWEL_ROOMMATE_MATCH=1` (default off). Separate from Dwel Together.

## Foundation v0
- Opt-in profile visibility
- Explicit preference fields (budget, geo, lifestyle answers provided by user)
- Mutual interest / pass
- Block + report
- Consent withdraw / delete
- Deterministic match explanation (no protected-class inference)

Do not reuse landlord `is_discoverable` or Authority verification data.
