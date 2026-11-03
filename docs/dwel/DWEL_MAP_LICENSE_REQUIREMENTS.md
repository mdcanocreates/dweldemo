# Map workspace — license and configuration requirements

The MapLibre UI already exists. Production Map mode stays blank or disabled until a licensed style URL is configured.

## Required configuration (frontend build env)

| Variable | Purpose |
| --- | --- |
| `VITE_DWEL_MAP_ENABLED=true` | Turns on Map mode chrome when a style URL is present |
| `VITE_DWEL_MAP_STYLE_URL` | Full style JSON URL from an approved provider (Mapbox, MapTiler, or equivalent) |

Do **not** commit provider tokens into source. Prefer a style URL that embeds the token in a restricted URL, or inject at build time from CI secrets.

## Current status (2026-11-03)

- Secrets Manager has **no** map/mapbox/maptiler secret under the production account scan.
- Production web build ships with map flags off / empty style → MapLibre has no tiles.
- Listing coordinates require `map_location` from the API (coarsened geom). Production API image predates that field unless a newer image is deployed.

## Exact steps to enable

1. Create a MapTiler or Mapbox account under RBIT billing.
2. Create a production style with appropriate terms for a rental marketplace.
3. Store the style URL (or token) in CI/CD or SSM Parameter Store — not in git.
4. Rebuild `web` with the two Vite env vars set.
5. Deploy the new static bundle; keep CloudFront SPA hash redirects.
6. Browser-test markers, clustering, bounds search, and mobile drawer.

Until then, List mode remains the supported public browse experience, and empty/error catalog states hide Map chrome.
