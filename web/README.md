# dwel.20 web

Production web app (renter marketplace, landlord portal, broker portal).

## Live

https://d1j0s2h5mond9a.cloudfront.net

CloudFront → S3 (static) + ALB (API `/v1/*`, `/health`).

## Local

```bash
cd web
npm install
npm run dev
```

## Notes

- No demo language; empty states instead of fake data
- Application access via private link query param `access` (never localStorage)
- Landlord applicant review is live (masked pre-approval; contact on approve)
- Broker funding/purchase gated on BOR/licensing; dashboard + Connect onboarding in Part I
