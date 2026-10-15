# Netlify settings for existing site `rbitdemo.netlify.app`

## Recommended (matches root `netlify.toml`)

| Setting | Value |
|---------|--------|
| Repository | `mdcanocreates/dweldemo` |
| Production branch | `main` **or** `deploy/netlify-dwel-demo` |
| **Base directory** | **(blank / empty)** |
| Build command | `npm --prefix forNetlify run build` |
| Publish directory | `forNetlify/dist` |
| Env | `VITE_DWEL_NETLIFY_DEMO=true` |

Do **not** set Base directory to `forNetlify` **and** Publish to `forNetlify/dist` together — that resolves to `forNetlify/forNetlify/dist` and publishes an empty site (Netlify default 404).

Do **not** set `DWEL_API_ORIGIN` or AWS/API secrets.

## Smoke checks after deploy

1. https://rbitdemo.netlify.app/ → HTTP 200 (not Netlify Page not found)
2. https://rbitdemo.netlify.app/demo-build.json → `"mode":"standalone_demo"`
3. https://rbitdemo.netlify.app/#/auth/login → **Enter demo**
