# Dwel Netlify Demo (`forNetlify`)

Deployable artifact for `https://rbitdemo.netlify.app` built from the **current production** `web/` app.

## What this is

- Same production React app (auth, renter, broker, Home Provider, screening, legal)
- **Only intentional UX divergence:** Demo chrome with Renter / Broker / Home Provider buttons that navigate into **real** `/auth/login?returnTo=...` flows
- Same-origin `/v1/*` proxy via generated `_redirects` so authentication does not 404 on Netlify

## What this is not

- Not a fake login or session bypass
- Not a fork of stale demo pages as the product
- Not a place for secrets

## Deploy

1. Netlify site → Base directory: `forNetlify` (or `apps/dwel/forNetlify` in monorepo)
2. Set **`DWEL_API_ORIGIN`** to the Dwel API HTTPS origin
3. On that API, set `PUBLIC_APP_URL=https://rbitdemo.netlify.app` and the demo allowlist (see `ENV.md`)
4. Build command: `npm run build` · Publish: `dist`

## Role entry paths

| Role | Login deep link |
|------|-----------------|
| Renter | `/#/auth/login?returnTo=%2Frenter&role=renter` |
| Broker | `/#/auth/login?returnTo=%2Fpartner%2Fbroker&role=broker` |
| Home Provider | `/#/auth/login?returnTo=%2Fpartner%2Flandlord&role=landlord` |

After login, **server session roles** remain authoritative.

## Demo chrome mount

`web/src/main.tsx` must render `<NetlifyDemoChrome />` inside the auth tree (already present in the current production web entry). Chrome is a no-op unless `VITE_DWEL_NETLIFY_DEMO=true` (set by `forNetlify` build).
