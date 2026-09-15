# Part H — Landlord Portal (criterion report)

Date: 2026-09-10
API: healthy (db+cache connected)
Web: https://d1j0s2h5mond9a.cloudfront.net/#/landlord
Migration: 0055_phase_h_landlord.sql applied via ECS one-off (exit 0)
Image: rbit-dev-api:latest pushed; ECS force-new-deployment COMPLETED
Tests: 179/179 passed (includes part-h-landlord.test.ts 9/9)

## Pre-H confirmation
- New listing / NOI / mashed nav = **legacy scaffold** (frontend4) + Part G CSS dropped .portal-layout / .side-nav / .stack / .form-grid — not a new regression from H work.
- Shared landlord shell rebuilt first (dark §DESIGN sidebar) so H pages do not inherit broken concatenated nav.

## H-0 Screening mode
- [x] GET/PUT /v1/landlord/settings (screening_mode)
- [x] Default uto_screen (migration default)
- [x] Persists across requests
- [x] Non-landlord → 403 (schema role landlord; glossary maps landlord_admin→landlord)
- UI: /#/landlord/settings

## H-1 Listing management
- [x] GET/POST /v1/landlord/listings, PUT /v1/landlord/listings/:id, POST status, POST photos
- [x] Org-scoped list (RLS + tenant context)
- [x] Draft not public; active visible
- [x] Rent integer cents
- [x] S3 upload via ObjectStore.put + signed GET (round-trip in tests with MemoryObjectStore; DEV uses S3 bucket rbit-dev-documents-*)
- UI: card grid, edit, applicants, mark rented; create form with photo upload

## H-2 Applicants
- [x] GET /v1/landlord/listings/:id/applicants — contact null pre-approval; email/name absent from JSON
- [x] Approve → contact_revealed_at server-side + contact returned
- [x] Decline → no reveal
- [x] Double approve idempotent
- [x] Concept A/B page removed (redirect to listings)
- Manual-review CTAs when status=awaiting_landlord_interest

## H-3 Self-execution
- [x] GET/POST /v1/landlord/settings/self-execution
- [x] license_number hidden for owner_occupant (UI + server)
- [x] File upload to S3
- [x] Pending blocks resubmit (409); rejected allows (status check)
- [x] compliance_tag interim_v1
- [x] Admin banner only for rbit_admin / rbit_super_admin / rbit_super

## Shell
- Dark landlord sidebar with spaced nav links (Overview, My listings, New listing, Settings, Self-execution, NOI calculator)
- Restored shared layout primitives (.stack, .panel, .form-grid, .field) so NOI calculator and forms wrap correctly
