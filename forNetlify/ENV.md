# forNetlify environment configuration (standalone demo)

## Netlify site variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_DWEL_NETLIFY_DEMO` | Set by `netlify.toml` | Enables demo chrome, local email gate, offline API adapters |
| `VITE_APP_ENV` | Optional (`demo`) | Environment labeling |

**Do not set** `DWEL_API_ORIGIN`. The standalone demo must not proxy to production.

**Do not** put database passwords, API keys, JWT secrets, AWS keys, or `.env` files into Netlify.

## Demo access (local gate only)

Allowlisted emails (not secure authentication):

- `info@rbitfinancial.com`
- `mdcano@rbitfinancial.com`
- `addison@rbitfinancial.com`
- `michaelsorge@rbitfinancial.com`

If you need real access control for these four people, use Netlify Identity, an IdP, or another server-validated mechanism — not this client-side gate.

## Backend / AWS

None required for the standalone demo. Do not change production `PUBLIC_APP_URL`, allowlists, or ECS for this deploy.

## Local build

```powershell
cd forNetlify
npm run build
# Inspect dist/_redirects (SPA only) and dist/demo-build.json
```
