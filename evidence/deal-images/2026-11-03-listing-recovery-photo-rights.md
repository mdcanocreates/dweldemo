# Photo rights status — listing recovery (2026-11-03)

## Evidence reviewed

| Source | Path | Finding |
|---|---|---|
| Image URL manifest | `apps/DWEL_DEAL_PROPERTY_IMAGE_URL_MANIFEST.json` | States image URL references only; **not approved** for reproduction or production media store |
| Package audit | `docs/architecture/DWEL_listingpackages_audit_and_cursor_handoff_2026-11-02.md` | Photo usage rights unverified; ZIP/prompt text is not a license |
| B0 evidence | `docs/dwel/evidence/2026-11-02-external-listing-package-b0.md` | No Rent.com photo republication |
| Recorded grant | `external_source` / `RENT_COM_DEAL_PACKAGE_PERMISSION` | `status=unverified`, `licenseEvidenceRef=pending_rights_review`, photos **not** in `permittedFields`, `mediaPolicy=none` |
| Provenance rows | `listing_media_provenance` | **8,612** rows, all `permission_basis=pending_rights_review`, `publishable=false` |

## Decision

Do **not** publish, hotlink, or CDN-host Rent.com image URLs in this release.

Permitted without photos (already in recorded grant): address, rent_range, beds, special_text, approximate coordinates.

## What would unblock photos

1. Written display/rehost grant naming Dwel/RBIT, territory, duration, attribution, and caching rules; **or**
2. Owner/manager authorized uploads through the existing listing media pipeline; **or**
3. A separately licensed feed with `external_source.status=approved`, real `license_evidence_ref`, `photos` in `permitted_fields`, and `media_policy` of `host` or `hotlink`.

Until then, public `listing.media` arrays remain empty and cards use compact property-first fallbacks (not technical provenance copy).
