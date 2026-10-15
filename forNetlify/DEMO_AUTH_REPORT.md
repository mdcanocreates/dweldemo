# Dwel Netlify Demo — Auth Repair Report

## ROOT CAUSE

`https://rbitdemo.netlify.app` serves the SPA correctly, but the auth client issues **same-origin relative** requests:

`POST /v1/auth/magic-link`

On Netlify there was **no API and no `/v1` rewrite**, so the browser received an HTML 404 (or similar non-JSON body). The client fell through to the generic message **`Request failed`**.

Contributing factors:

1. Production web assumes same-origin `/v1/*` (Vite proxy only exists in local `vite`/`preview`).
2. No `forNetlify/`, `netlify.toml`, or `_redirects` in-repo for the demo site.
3. Backend has **no CORS layer**; cross-origin absolute API URLs would also need cookie/CORS work. Same-origin Netlify `200` proxy is the correct fix for this client.
4. Magic-link emails use `PUBLIC_APP_URL`; if that still points at localhost/production CDN, demo redeem URLs will be wrong even after proxy works.

## FILES CHANGED

| Path | Change |
|------|--------|
| `forNetlify/` | New deployable Netlify package (build, `netlify.toml`, docs) |
| `forNetlify/scripts/build.mjs` | Builds `web/` with demo flag; emits `_redirects` proxy |
| `web/src/lib/netlify-demo.ts` | Demo mode helper + login deep links |
| `web/src/components/demo/NetlifyDemoChrome.tsx` | Demo badge + role → real login navigation |
| `web/src/main.tsx` | Mounts Netlify demo chrome |
| `web/src/api/client.ts` | Clearer error when `/v1` returns HTML (proxy missing) |
| `web/.env.example` | Vite/demo env documentation |
| `.env.example` | Allowlist includes four demo RBIT emails + Netlify notes |

## AUTH/API TOPOLOGY

```text
Browser https://rbitdemo.netlify.app
    │  POST /v1/auth/magic-link   (relative, credentials: include)
    ▼
Netlify rewrite (200)  /v1/* → ${DWEL_API_ORIGIN}/v1/*
    ▼
Dwel API  (ALB/ECS)
    ├── AUTH_EMAIL_ALLOWLIST
    ├── PUBLIC_APP_URL=https://rbitdemo.netlify.app
    └── Set-Cookie: rbit_session (proxied → Netlify host)
```

Role switcher only navigates to:

- Renter → `/#/auth/login?returnTo=%2Frenter&role=renter`
- Broker → `/#/auth/login?returnTo=%2Fpartner%2Fbroker&role=broker`
- Home Provider → `/#/auth/login?returnTo=%2Fpartner%2Flandlord&role=landlord`

Server session / `party_role` remains authoritative after redeem.

## NETLIFY CONFIGURATION

1. Base directory: `forNetlify` (or `apps/dwel/forNetlify`)
2. Build: `npm run build` · Publish: `dist`
3. **Required site env:** `DWEL_API_ORIGIN=https://<dwel-api-host>` (no trailing slash, no secrets)
4. Generated `dist/_redirects` proxies `/v1/*` and `/health*` and SPA-falls back to `/index.html`

## BACKEND CONFIGURATION REQUIRED

On the API pointed to by `DWEL_API_ORIGIN`:

| Setting | Value |
|---------|--------|
| `PUBLIC_APP_URL` | `https://rbitdemo.netlify.app` |
| `AUTH_EMAIL_ALLOWLIST` | Must include the four emails below |
| Email/SES | Must deliver magic links |
| CORS | Not required if Netlify proxy is used |

## ALLOWLIST VERIFIED

Documented for demo API (code/example updated; **live API env not modified by this agent**):

- `info@rbitfinancial.com`
- `mdcano@rbitfinancial.com`
- `addison@rbitfinancial.com`
- `michaelsorge@rbitfinancial.com`

Policy unchanged: allowlist still enforced in non-production `APP_ENV`; no global bypass.

## ROLE ROUTES VERIFIED

Code-level deep links and Demo chrome buttons verified in source/tests. Live browser E2E against Netlify was **not** completed here (external access).

## BUILD RESULT

Local `forNetlify` build succeeded with placeholder `DWEL_API_ORIGIN`:

- `web` `tsc -b && vite build` OK
- `dist/_redirects` generated
- `dist/demo-build.json` written

## LIVE DEMO RESULT

### `CODE_READY_EXTERNAL_DEPENDENCY_BLOCKED`

This agent does **not** have credentials/access to:

1. Update Netlify site env (`DWEL_API_ORIGIN`) or trigger production Netlify deploy for `rbitdemo.netlify.app`
2. Update AWS/ECS/API secrets for `PUBLIC_APP_URL` / `AUTH_EMAIL_ALLOWLIST` on the live demo API
3. Send or receive real SES magic-link email in this session

**Code is ready.** Until those external steps are applied, do **not** treat the live demo as operational.

Operator checklist:

1. Set Netlify `DWEL_API_ORIGIN` → deploy `forNetlify`
2. Set API `PUBLIC_APP_URL=https://rbitdemo.netlify.app`
3. Ensure API allowlist includes the four emails
4. Smoke: Home Provider login path → magic link → redeem → refresh → logout → non-allowlisted email → 403

## COMMIT SHA

`94a64c3998584f93c27ae71f617e60c006149e65` on branch `feat/netlify-demo-fornetlify`

Note: `<NetlifyDemoChrome />` must remain mounted in `web/src/main.tsx` (present in current production web working tree; component + helpers are in this commit).
