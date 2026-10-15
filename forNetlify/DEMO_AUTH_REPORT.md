# Dwel Netlify Demo — Live Recovery Report

## Status

**LIVE:** https://rbitdemo.netlify.app is serving the standalone demo.

Verified 2026-10-15:

- `/` → HTTP 200 + production HTML shell
- `/demo-build.json` → `"mode": "standalone_demo"`
- Bundle `/assets/index-CDm14zlb.js` contains `Enter demo`, `Simulated data`, four allowlisted emails, role chrome

## ACTUAL ROOT CAUSE (404)

After the submodule fix, the site returned Netlify’s default **Page not found** because published output was empty / mis-resolved:

1. Only branch on the repo was `deploy/netlify-dwel-demo` while Netlify’s default **production branch is `main`** (missing → no valid production publish).
2. UI Base=`forNetlify` combined with Publish=`forNetlify/dist` can resolve to `forNetlify/forNetlify/dist` (empty → 404).

## FIX IMPLEMENTED

- Root `netlify.toml`: `command = npm --prefix forNetlify run build`, `publish = forNetlify/dist`, **no** `[build].base`
- Pushed tip to `deploy/netlify-dwel-demo` and **`main`**
- Docs updated in `NETLIFY_GIT_DEPLOY.md`

## GIT

- Remote: `https://github.com/mdcanocreates/dweldemo.git`
- Branches: `deploy/netlify-dwel-demo` and `main` @ `ea7d6a5a16fa411b259fb9ba38b16ffaa479f8e1`

## PRODUCTION SAFETY

No AWS, secrets, or production Dwel auth changes.
