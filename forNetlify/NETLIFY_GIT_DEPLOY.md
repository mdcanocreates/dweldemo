# Connect existing site `rbitdemo.netlify.app` to this repo

## Why the live site is still the old demo

1. This Dwel git repo historically had **no `origin` remote** — commits `6731f9f` / `35dae53` existed only locally.
2. Netlify continued building whatever GitHub repo/branch was already linked (old magic-link SPA).
3. Live bundle `index-30Qi-YPI.js` still contains `Send sign-in link` / `magic-link` and **not** `Enter demo` / `Simulated data`.

## Required Netlify UI settings (existing site only)

Site: **rbitdemo.netlify.app** (do not create a new site)

1. Netlify → Site configuration → **Build & deploy** → **Continuous deployment**
2. **Link repository** (or Change repository) → GitHub → select the repo that contains this `forNetlify/` tree after you push
3. Branch: **`deploy/netlify-dwel-demo`**
4. Build settings:

| Setting | Value |
|---------|--------|
| Base directory | `forNetlify` |
| Build command | `npm run build` |
| Publish directory | `dist` |

5. Environment variables:
   - `VITE_DWEL_NETLIFY_DEMO` = `true` (also set in `netlify.toml`)
   - **Do not set** `DWEL_API_ORIGIN` or any AWS/API/Stripe/Certn/Checkr secrets

6. Trigger **Clear cache and deploy site**
7. Confirm deploy log shows `standalone demo` / no `/v1` proxy, and commit SHA matches the pushed tip
8. Open https://rbitdemo.netlify.app → login copy should say **Enter demo** (not Send sign-in link)

## Git push (run once remote exists)

```powershell
cd c:\Users\MDCan\Desktop\RBITMASTER\apps\dwel
git remote add origin https://github.com/<ORG>/<DWEL-REPO>.git   # if missing
git push -u origin deploy/netlify-dwel-demo
# Expected tip: e0774bb0923419ca68f739eeb002f10856add2b6 (or newer on that branch)
```

If GitHub/Netlify OAuth must be authorized by the site owner, complete that in the Netlify UI — agents cannot finish it without those credentials.

## After deploy: live smoke checks

1. https://rbitdemo.netlify.app/demo-build.json → `"mode": "standalone_demo"`
2. https://rbitdemo.netlify.app/#/auth/login → **Enter demo** (not Send sign-in link)
3. Emails: info@ / mdcano@ / addison@ / michaelsorge@ `@rbitfinancial.com`
4. Demo chrome: Renter / Broker / Home Provider switch without magic link
