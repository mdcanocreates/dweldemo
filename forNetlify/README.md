# Dwel Netlify Demo (`forNetlify`)

Standalone interactive demo for `https://rbitdemo.netlify.app` built from the **production** `web/` app.

## What this is

- Same production React UI (renter, broker, Home Provider portals)
- Local demo email gate (four RBIT addresses) — **not** secure authentication
- Instant role switching after demo access
- In-memory / fixture data — no AWS, SES, magic links, or production API

## What this is not

- Not production auth
- Not connected to production databases, Stripe, Certn, or Checkr
- Not a place for secrets

## Deploy

1. Netlify base directory: `forNetlify` (or `apps/dwel/forNetlify`)
2. Build: `npm run build` · Publish: `dist`
3. **Do not set** `DWEL_API_ORIGIN`
4. Env from `netlify.toml`: `VITE_DWEL_NETLIFY_DEMO=true`

## Demo access

Enter one of:

- info@rbitfinancial.com
- mdcano@rbitfinancial.com
- addison@rbitfinancial.com
- michaelsorge@rbitfinancial.com

Then use the Demo chrome to switch Renter / Broker / Home Provider instantly.

For real access control of those four people, use Netlify Identity or an IdP — not this client gate.

## Demo chrome mount

`web/src/main.tsx` must render `<NetlifyDemoChrome />` (no-op unless the Vite demo flag is set).
