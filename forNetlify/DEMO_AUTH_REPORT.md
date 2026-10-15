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

## COMMIT SHA

- Feature: `6731f9f6842db63e811d1a367022e4de4e7a93c5`
- Docs tip (earlier): `35dae53517b1c52f2427e4d9ac643428fc3d1fa6`
- **Deploy branch tip (buildable CI):** `4d847d5f69ecb923bc1bab3d4ca29c7739038dce` on `deploy/netlify-dwel-demo`

See `NETLIFY_GIT_DEPLOY.md` for reconnecting `rbitdemo.netlify.app`.
