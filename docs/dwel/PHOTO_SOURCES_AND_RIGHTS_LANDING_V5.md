# Landing v5 hero photographs — rights record

**Verified for production candidate:** 2026-11-02  
**License baseline:** [Unsplash License](https://unsplash.com/license) — free commercial use; no requirement to attribute; do not imply pictured buildings are Dwel inventory.

| Asset | Unsplash photo ID | Credit (from supplied filename) | Source URL |
| --- | --- | --- | --- |
| `hero-01.webp` | `ztVcGTSD8xw` | Mitchell Kmetz | https://unsplash.com/photos/ztVcGTSD8xw |
| `hero-02.webp` | `a6L4HjL9MFk` | Ryan Heise | https://unsplash.com/photos/a6L4HjL9MFk |
| `hero-03.webp` | `koH7IVuwRLw` | Luke van Zyl | https://unsplash.com/photos/koH7IVuwRLw |
| `hero-04.webp` | `ew8VnpgX9UI` | Heino Eisner | https://unsplash.com/photos/ew8VnpgX9UI |
| `hero-05.webp` | `s34TlUTPIf4` | Isaac Quesada | https://unsplash.com/photos/s34TlUTPIf4 |
| `hero-06.webp` | `wKfTNWaDYgs` | MJ Tangonan | https://unsplash.com/photos/wKfTNWaDYgs |

## Verification notes

- Owner-supplied package filenames encode Unsplash IDs and photographer names.
- Automated HTTP checks from this environment received Unsplash bot/`401` responses for HTML pages; images themselves are the optimized WebP deliverables in `web/public/landing/`.
- Photos are used only as decorative brand imagery. They are not tied to listing cards, property IDs, or availability claims.
- If any single ID is later found non-Unsplash or restricted, remove that asset from `HERO_PHOTOS` and redeploy the web bundle only.

## Display rule

Carousel has no photo controls and no click-through to listings. Reduced-motion users see a single static frame.
