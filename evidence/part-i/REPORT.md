# Part I — Broker dashboard + Stripe Connect

Date: 2026-09-10
Migration: 0056_phase_i_broker.sql (ECS exit 0)
API healthy; Connect routes return 401 unauthenticated
Web CDN invalidated

## Marketing fix (out of H, done with I)
- /#/landlords copy updated: applicant review is live (no longer gated on landlord-interest decision)

## I-0 broker_payouts_enabled
- [x] Per-org column default false
- [x] Overview payouts.available false → reason broker_payouts_disabled
- [x] Connect onboarding still allowed when flag false

## I-1 Performance dashboard
- [x] GET /v1/broker/performance?window_days=30|60|90
- [x] GET /v1/broker/submarkets
- [x] UI /#/broker/dashboard — summary cards + submarket table
- Real data from broker_performance (no mocks)

## I-2 Lead history
- [x] GET /v1/broker/leads — page_size 25, status/from/to filters
- [x] UI /#/broker/leads

## I-3 Stripe Connect
- [x] F-3 still active (platform accounts.list previously PASS)
- [x] POST/GET /v1/stripe/connect/account
- [x] POST /v1/stripe/connect/onboarding-link
- [x] GET /v1/stripe/connect/dashboard-link
- [x] UI /#/broker/settings/payments and /#/landlord/settings/payments
- Live Stripe SDK when STRIPE_SECRET_KEY is sk_*

## Tests
part-i-broker.test.ts 4/4 + part-b4 still green

Halt before Part J.
