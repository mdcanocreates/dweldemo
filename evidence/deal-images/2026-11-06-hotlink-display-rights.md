# Hotlink display rights — 2026-11-06

## Authorization

Ops confirmed authorization to **display** property images associated with the imported deal listings by **hotlinking original remote URLs** (no S3 rehost required).

| Field | Value |
|---|---|
| Provider key | `rent_com_deal_package` |
| Status | `approved` |
| Evidence ref | `ops_authorized_hotlink_display_2026-11-06` |
| Media policy | `hotlink` |
| Permitted fields | address, rent_range, beds, special_text, coordinates_approximate, photos, media, images |

Migration: `0082_rent_com_hotlink_display_rights.sql`

## Publication method

1. Gate via `decideImageUse` requires approved status, non-pending evidence, photos permitted, `mediaPolicy=hotlink`.
2. `publish-hotlink-deal-media` copies ordered `listing_media_provenance.origin_url` values into `listing_media.url` (no `storage_key`).
3. Provenance rows marked `permission_basis=authorized_feed`, `publishable=true`, linked `media_id`.
4. Public API continues to serialize `listing_media` into `media[]`.

## Host checks

`i.rent.com` image HEAD requests returned HTTP 200 both with and without a Dwel Referer. Frontend uses `referrerPolicy="no-referrer"` with `onError` fallback.
