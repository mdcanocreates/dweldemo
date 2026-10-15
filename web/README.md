# Dwel frontend — userFlow.md progressive-trust redesign

## Auth flow

1. `/auth/login` — email only (no role pre-select)
2. Magic link → `/auth/callback?token=…`
3. New users → `/onboarding/role` (renter / landlord / broker)
4. Role-specific onboarding

## Local

```bash
cd web && npm install && npm run dev
```

Backend SES: `product: 'dwel'` via shared `sendTransactionalEmail` in `src/infra/email/`.

## Notes

- Progressive trust: browse anonymously; auth at interest / sync saves
- Guided discovery: `/discover` (no account wall, no income)
- Phase 1 CTA: **I'm interested** only — no Contact / Book a tour
- **Missing asset:** RBIT brand mark (Lumis-equivalent SVG/PNG) not in repo —
  header uses Dwel wordmark alone until the mark is supplied (design3.md §14)
- `prequal_profile` is self-reported — not an FCRA consumer report
- FCRA copy: `FCRA_CONSENT_COPY` placeholder — do not ship to production
