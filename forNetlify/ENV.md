# forNetlify environment configuration

## Netlify site variables (build + runtime proxy target)

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `DWEL_API_ORIGIN` | **Yes** | `https://rbit-dev-821417220.us-east-2.elb.amazonaws.com` | Absolute origin of the Dwel API. Used to generate `_redirects` so browser calls stay same-origin (`/v1/...`). |
| `VITE_DWEL_NETLIFY_DEMO` | Set by `netlify.toml` | `true` | Enables Demo chrome + role navigation. |
| `VITE_APP_ENV` | Optional | `demo` | Environment labeling. |

**Do not** put database passwords, API keys, JWT secrets, AWS keys, or `.env` files into Netlify for this frontend.

## Backend (Dwel API) variables required for demo auth

Configure these on the **API** environment that `DWEL_API_ORIGIN` points at — not in the Netlify frontend secrets:

| Variable | Required value for rbitdemo |
|----------|-----------------------------|
| `PUBLIC_APP_URL` | `https://rbitdemo.netlify.app` |
| `AUTH_EMAIL_ALLOWLIST` | Must include: `info@rbitfinancial.com`, `mdcano@rbitfinancial.com`, `addison@rbitfinancial.com`, `michaelsorge@rbitfinancial.com` |
| `EMAIL_PROVIDER` / SES | Working so magic-link emails send |
| `APP_ENV` | Not `production` if allowlist must stay enforced (typical for demo/staging API) |

## Why a proxy

The production web client uses **relative** `fetch('/v1/...')` (same-origin). Without a Netlify rewrite, `https://rbitdemo.netlify.app/v1/auth/magic-link` hits Netlify (no API) → HTML 404 → UI shows `Request failed`.

## Cookie / session notes

- Session cookie: `rbit_session` (HttpOnly, SameSite=Lax, Secure in prod/dev NODE_ENV)
- With Netlify `200` proxy rewrites, `Set-Cookie` is attributed to `rbitdemo.netlify.app`
- Client also stores Bearer token in `localStorage` (`dwel.session_token`) after redeem — works with proxy
- Always verify magic-link open in a **new tab** and refresh after login

## Local build smoke test

```bash
cd forNetlify
set DWEL_API_ORIGIN=https://YOUR-API-HOST
npm run build
# Inspect dist/_redirects
```
