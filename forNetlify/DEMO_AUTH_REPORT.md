# Dwel Netlify Demo — Standalone Mode Report

## MODE

**Standalone interactive demo** — no magic links, SES, AWS API, or `DWEL_API_ORIGIN`.

## ROOT CAUSE (historical)

Earlier `rbitdemo.netlify.app` failed auth because relative `/v1` had no API. That path is obsolete for this deploy: demo builds no longer call production `/v1`.

## ACCESS

Client-side email gate only (not secure authentication):

- info@rbitfinancial.com
- mdcano@rbitfinancial.com
- addison@rbitfinancial.com
- michaelsorge@rbitfinancial.com

For real access control, use Netlify Identity or an IdP.

## WHAT WORKS

- Demo email entry → immediate local session
- Rejection of other emails by the local gate
- Renter / Broker / Home Provider portals via production UI
- Instant role switching after demo access
- In-memory listings, applications, screening states, dashboards (ui-preview fixtures)
- Local mutations only (sessionStorage / in-memory universe)

## WHAT IS SIMULATED

- Authentication (no magic link / no `rbit_session` cookie from API)
- Screening provider calls (blocked)
- Payments / Stripe (blocked)
- Email delivery (none)
- All `/v1` responses (offline adapters)

## MISSING / THINNER COVERAGE

- Admin Control Center surfaces (not in demo chrome roles)
- Any production endpoint not covered by `ui-preview-api` returns empty GET or 403 mutation
- Real document binaries / signed URLs

## PRODUCTION SAFETY

- `VITE_DWEL_NETLIFY_DEMO` build flag required
- Production builds keep magic-link auth unchanged
- Demo builds refuse outbound API (`shouldBlockOutboundApi`)
- No AWS resources or production secrets required

## NETLIFY SETTINGS

- Base directory: `forNetlify`
- Build: `npm run build`
- Publish: `dist`
- Env: `VITE_DWEL_NETLIFY_DEMO=true` (from `netlify.toml`)
- **Do not set** `DWEL_API_ORIGIN`
