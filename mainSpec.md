# RBIT Platform — Backend Engineering Specification

**Version:** 2.0
**Date:** August 8, 2026
**Owner:** Michael David Cano, CTO
**Status:** Approved for build — Phase 0 unblocked
**Scope:** Backend only. Frontend specified separately in `RBIT-FRONTEND-SPEC.md`. The seam between them is the generated OpenAPI client (§3.8).
**Verticals:** dwel (rental placement) · Solar vertical (solar incentive program)

---

## 0. Operating rules for implementing agents

Read this section before writing any code. It is binding.

**0.1 — Section 18 is a halt condition.** Any task whose implementation depends on an open decision in §18 stops and escalates to Michael. Do not resolve a §18 item with a code default, a "reasonable assumption," a TODO, or a placeholder constant. An unresolved decision blocks the dependent task, not the whole build — implement everything around it and leave the seam explicit.

**0.2 — Acceptance criteria require evidence.** A module is complete when its §17 criteria are demonstrated with artifacts: test output, query results, log excerpts, screenshots of failing-then-passing CI. "Implemented" without evidence is rejected. Report criterion-by-criterion, not in summary.

**0.3 — Do not invent schema.** Every table, column, index, and constraint in this document is specified deliberately. If a task appears to need a field that does not exist here, that is a spec gap — flag it, do not add it silently. Additive migrations require explicit approval.

**0.4 — Naming conventions are absolute.** `snake_case` for all database identifiers. Money is integer cents with a `_cents` suffix, never float, never decimal-as-dollars. Timestamps end in `_at` and are `timestamptz`, never `timestamp`. Booleans are prefixed `is_` or `has_`. Enumerated text columns carry a `CHECK` constraint listing every legal value.

**0.5 — Every state transition emits a domain event.** No exceptions. A state change without an event is a bug, and §17 tests assert this.

**0.6 — No PII in logs, ever.** This includes error messages, stack traces, queue payloads, Temporal workflow inputs, and third-party observability. §3.3 defines the mechanism.

**0.7 — Tests are not optional deliverables.** Concurrency, idempotency, and isolation tests specified in §17 are part of the module, not a follow-up task.

---

## 1. Architectural principles

| ID | Principle |
|---|---|
| **P1** | **Modular monolith.** One deployable, one primary database, hard module boundaries enforced by directory structure and lint rules. Cross-module access goes through a module's public interface, never direct table access. Do not introduce microservices. |
| **P2** | **Events are the spine.** Every state transition emits to an append-only domain event log. Read models, analytics, notifications, and audit are projections of it. |
| **P3** | **Identity is separable from features.** Every record touching a human splits into an identity half (PII, encrypted, TTL'd, crypto-shreddable) and a features half (de-identified, retained permanently). This split exists from the first migration and is not retrofittable. |
| **P4** | **Snapshot at decision time.** Prices, fees, tiers, scores, model versions, and config versions are persisted onto the record at the moment of the decision. Never derived at read time from a current lookup. Every historical decision must be reconstructable without time-travelling config tables. |
| **P5** | **Tenancy enforced at the database.** Postgres RLS on every tenant-scoped table. CI fails the build if a new table lacks a tenant column and policy. |
| **P6** | **The ledger is financial truth.** Stripe is a rail and an event source, not a ledger. Every cent that moves produces balanced double-entry records in RBIT's own ledger. |
| **P7** | **Money and PII operations are idempotent.** Stable idempotency keys, never random-per-attempt. Replaying any event produces no additional side effects. |
| **P8** | **Config over constants.** Fee tables, tier caps, TTLs, SLAs, thresholds, and screening packages live in versioned, effective-dated config with an approval trail. No pricing or policy value is a code literal. |
| **P9** | **Admin console is a read model.** It reads from the replica or warehouse, never the transactional primary, except for targeted single-record support lookups. |
| **P10** | **Vendors are behind adapters.** No vendor SDK type crosses a module boundary. Every vendor capability has an interface and a stub implementation used in tests. |
| **P11** | **Cost scales with load.** Compute and database capacity scale on actual traffic. Every autoscaler has a ceiling — an unbounded scaler is a cost incident. |

---

## 2. System decomposition and infrastructure

### 2.1 Bounded contexts

| Context | Owns | Shared |
|---|---|---|
| **Identity** | party, party_role, org, permissions, sessions, passwordless auth, impersonation, org claim | Yes |
| **Geo** | address normalization, geocoding, submarkets, H3/tract keys | Yes |
| **Supply** | property, unit, listing, media, availability lifecycle | dwel |
| **Ingestion** | partner connectors, feed sync, raw landing zone, mapping, entity resolution, delist detection | dwel |
| **Screening** | renter profile, applications, Certn orchestration, verification badge, income/identity verification, report artifacts, rebates | dwel |
| **Scoring** | feature assembly, model registry, score records, explanations, outcome labels | Yes |
| **Matching** | landlord interest, decisions, placements, holds, queues, renter discoverability | dwel |
| **Brokerage** | broker orgs, coverage, capacity, prepaid balance, lead offers, assignment, SLA | dwel |
| **Solar** | deal intake, two-equation underwriting, tier caps, PBC profit share, homeowner disbursement | Solar |
| **Payments** | Stripe integration, charges, payouts, disputes, webhooks | Yes |
| **Ledger** | double-entry accounts, transactions, entries, reconciliation | Yes |
| **Documents** | object storage, entitlements, signed URLs, doc taxonomy, e-sign | Yes |
| **Notifications** | in-platform inbox, email, delivery tracking, suppression | Yes |
| **Audit** | domain event log, admin action log, impersonation sessions | Yes |
| **Analytics** | warehouse ETL, rollups, demand/supply models, admin reporting | Yes |
| **Config** | versioned effective-dated configuration, approvals | Yes |

### 2.2 Infrastructure (D-08 resolved)

**Cloud:** AWS, region `us-east-2`. Three isolated accounts: `rbit-dev`, `rbit-staging`, `rbit-prod`. Account-level isolation, not namespaced resources in one account — blast radius containment is the requirement.

| Layer | Service | Configuration |
|---|---|---|
| Database | **Aurora Serverless v2, PostgreSQL-compatible** | PostGIS enabled. Prod: min 0.5 ACU, max ceiling set per §11 cost guardrails. Dev/staging: min 0 ACU (auto-pause when idle), tolerate ~15s cold start. |
| App compute | **ECS Fargate** | Target-tracking autoscaling on request count and CPU. Min 1 task, explicit max task ceiling. ARM/Graviton task definitions. |
| Workflow engine | **Temporal** (D-07 resolved) | Self-hosted on Fargate. Owns long-horizon durable execution only — see §2.4. |
| Queue | **SQS + BullMQ-style worker** | Short-lived retryable jobs. Not Temporal. See §2.4 for the split. |
| Cache / sessions | **ElastiCache Serverless (Redis)** | Sessions, rate limits, nonce caches. Never the authority for locks — see §9.2. |
| Object storage | **S3** | SSE-KMS. Private buckets only. VPC endpoint to avoid NAT data charges. |
| Key management | **AWS KMS** | Wraps per-party DEKs (§3.3). |
| Secrets | **AWS Secrets Manager** | Vendor credentials, signing secrets. VPC endpoint. |
| PII tokenization | **Dedicated vault vendor** (Skyflow or Basis Theory) | Deterministic tokenization for SSN. Secrets Manager is not a substitute. See §18 D-14. |
| Networking | VPC, private subnets, ALB, NAT Gateway | VPC endpoints for S3/Secrets/ECR/KMS to minimize NAT data processing. |
| Observability | CloudWatch + OpenTelemetry traces + error tracking | Structured JSON logs with redaction. |

**Cost guardrails (P11).** Every autoscaler carries an explicit maximum: Aurora max ACU, Fargate max task count, ElastiCache max. Alert on scaling events approaching ceiling, not only on monthly spend. A runaway ingestion sync or a scraping burst must hit a ceiling, not a bill.

### 2.3 Runtime topology

```
   clients ──▶ CloudFront ──▶ ALB ──▶ Fargate service (API, autoscaled)
                                          │
        ┌─────────────────┬───────────────┼────────────────┬──────────────┐
        ▼                 ▼               ▼                ▼              ▼
  Aurora Serverless   SQS workers    Temporal        S3 + KMS      Vault (SSN)
  v2 (primary)        (short jobs)   (long sagas)    (documents)   (tokens)
        │
        ├──▶ Aurora read replica ──▶ dbt ETL ──▶ reporting schema ──▶ admin console
        │
        └──▶ vendor adapters ──▶ Certn | Plaid | Stripe | Twilio | e-sign | ingestion partners
```

### 2.4 Temporal vs. queue — the split

Do not route everything through Temporal. The distinction is durability horizon.

| Use Temporal | Use SQS worker |
|---|---|
| Screening saga (multi-product Certn order, partial completion, hours) | Webhook processing |
| **Outcome capture at 30/90/180/365 days** | Notification sends |
| Placement hold expiry and queue promotion | Media fetch and derivative generation |
| Broker lead SLA timers and re-offer cycles | PII purge job execution |
| Ingestion full-reconcile sweeps | Single ingestion page fetch |
| Rebate eligibility evaluation on `placement.funded` | Rollup/ETL triggers |

Rule of thumb: if the timer outlives a deploy, it is Temporal. If it retries three times and dead-letters, it is a queue job.

### 2.5 Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, Node LTS |
| API | REST, OpenAPI 3.1 generated from source, versioned (`/v1`). Generated typed client is the frontend contract. |
| DB access | Type-safe query builder with raw SQL escape hatch. Must not obscure RLS or index behavior. |
| Migrations | Expand/contract discipline, §16.2 |
| Testing | Unit + integration against real Postgres (testcontainers), vendor stubs, zero live network in CI |

---

## 3. Cross-cutting requirements

### 3.1 Multi-tenancy

Every counterparty-scoped table carries `org_id uuid not null`. RLS policy on each:

```sql
alter table listing enable row level security;

create policy listing_tenant_isolation on listing
  using (org_id = current_setting('rbit.current_org_id')::uuid
         or current_setting('rbit.bypass_rls', true) = 'on');
```

`rbit.bypass_rls` is settable only by the migration role and the admin read role. Any session setting it writes an `admin_action_log` row.

**CI gate:** enumerate `information_schema.tables`; fail if any app-schema table lacks either an `org_id` column with an RLS policy, or membership in a checked-in `GLOBAL_TABLES` allowlist.

### 3.2 Permission model (C2 resolved)

```sql
create table permission (
  key           text primary key,          -- 'ledger.refund', 'config.approve', ...
  description   text not null,
  requires_dual_approval boolean not null default false
);

create table role_permission (
  role          text not null,
  permission_key text not null references permission(key),
  primary key (role, permission_key)
);

create table dual_approval_request (
  id                uuid primary key default gen_random_uuid(),
  permission_key    text not null references permission(key),
  requested_by_party_id uuid not null references party(id),
  payload           jsonb not null,
  target_type       text,
  target_id         uuid,
  status            text not null check (status in ('pending','approved','rejected','expired')),
  approved_by_party_id uuid references party(id),
  requested_at      timestamptz not null default now(),
  resolved_at       timestamptz,
  expires_at        timestamptz not null
);
```

**Rules.** Michael's party holds `rbit_super_admin`, which bypasses dual approval. Every other admin action flagged `requires_dual_approval` requires a second distinct admin to approve before execution — the requester cannot approve their own request, enforced by a check in the approval handler and asserted by test.

Permissions requiring dual approval at launch: `config.approve` (any config version going effective), `impersonation.write` (write-enabled impersonation), `ledger.refund`, `ledger.manual_entry`, `ingestion.quarantine_override`, `screening.adverse_action_override`, `party.purge_immediate`.

### 3.3 PII handling

**Collection.** SSN and government ID numbers are never posted to RBIT servers.

- **Path A (primary):** vendor-hosted collection. Certn OneID hosts identity collection; RBIT stores `vendor_subject_id` only.
- **Path B (dedup key only):** browser posts SSN directly to the tokenization vault via the vault's JS SDK, bypassing RBIT origin. Vault returns a **deterministic alias token** stored as `identity_fingerprint`. RBIT holds no detokenization path and never requests one.

Under no circumstances does an SSN, full DOB, or government ID number appear in an RBIT log, error report, database column, Temporal workflow input, queue payload, or third-party observability payload.

**At rest.** Identity fields encrypted with a per-party DEK, DEKs wrapped by KMS. Deletion is **crypto-shredding**: destroy the DEK, leave the row shape intact so ledger and audit references stay valid.

**Lookup.** Searchable fields (email, phone) stored as ciphertext plus a keyed HMAC column for equality lookup. Never a plaintext searchable copy.

**Logging.** Redaction middleware in front of the logger: field-name deny-list plus regex sweep for SSN/DOB/card patterns. Applies to application logs, Temporal inputs, and SQS payloads. CI test asserts a synthetic request carrying every PII field name produces log output containing none of the values.

**Tagging.** Every PII-bearing column annotated in a checked-in `pii-manifest.yaml` mapping column → classification → retention class. The purge job reads this manifest. CI fails if a migration adds a column to a PII-bearing table without a manifest entry.

### 3.4 Retention model

| Class | Contents | Retention |
|---|---|---|
| `identity` | names, DOB, contact, addresses, doc uploads, vendor reports | TTL'd, crypto-shredded at expiry — **duration is §18 D-01** |
| `features` | de-identified feature vectors, geo keys, banded values, outcomes | Permanent |
| `financial` | ledger entries, transactions, payouts | Permanent, immutable |
| `audit` | domain events, admin actions | Permanent, immutable; PII stored by reference only |

The `party` row is never deleted — it is tombstoned (`purged_at` set) so `party_features`, ledger, and audit references stay valid. **No `ON DELETE CASCADE` from `party` to anything.**

Declined and abandoned applicants retain `party_features` permanently. They are the negative class for scoring, the fraud graph substrate, and the demand model. Only the identity half expires.

### 3.5 Idempotency

- Idempotency keys derived deterministically from `(operation, aggregate_id, attempt_class)`. Never random-per-attempt.
- Webhook contract: verify signature → persist raw event keyed on vendor event ID (unique constraint) → return 200 → process asynchronously from the stored row.
- Out-of-order delivery assumed. Handlers written as state assertions (`if current_state in (...) then transition`), never blind increments.

### 3.6 Observability

Structured JSON logs with one `request_id` propagated through every layer including queue jobs, Temporal activities, and vendor calls.

Required metrics: application funnel stage counts, vendor call latency/error/cost, queue depth and age, Temporal workflow failures, **ledger imbalance count (must be 0)**, hold expiry lag, webhook processing lag, RLS bypass session count, Aurora ACU utilization, Fargate task count.

Required alerts: any ledger imbalance, reconciliation break, DLQ non-empty, vendor error rate above threshold, purge job failure, autoscaler approaching ceiling, Temporal workflow stuck beyond expected horizon.

### 3.7 Public API protection (C3 resolved)

Unauthenticated listing search is scrapeable supply data. Controls:

- CloudFront + WAF rate limiting per IP and per fingerprint on unauthenticated endpoints.
- Bot detection on search and listing detail endpoints.
- `config_version` namespace `scraping_policy` with a per-environment toggle: `allow_indexed_crawlers` (search engines — default true, this is distribution) and `allow_generic_automation` (default false).
- Authenticated endpoints rate-limited per party and per org.
- No endpoint returns full contact detail without an authenticated, entitled session — enforced in the serializer, asserted by test.

### 3.8 API contract

OpenAPI 3.1 generated from source annotations, not hand-maintained. The generated TypeScript client is the sole interface consumed by the frontend spec. Breaking changes require a version bump. CI fails if the committed schema drifts from generated output.

---

## 4. Identity and access

### 4.1 Core model

```sql
create table org (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in
                      ('rbit','landlord','brokerage','property_mgmt','solar_partner')),
  legal_name        text not null,
  display_name      text not null,
  status            text not null default 'active',
  claim_status      text not null default 'claimed'
                      check (claim_status in ('unclaimed','pending','claimed')),
  created_by_source_id uuid,                 -- set when created by ingestion
  created_at        timestamptz not null default now()
);

create table party (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('person','organization')),
  created_at        timestamptz not null default now(),
  purge_after       date,
  purged_at         timestamptz
);

create table data_encryption_key (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid not null references party(id),
  wrapped_key       bytea not null,
  kms_key_id        text not null,
  created_at        timestamptz not null default now(),
  destroyed_at      timestamptz
);

create table party_identity (
  party_id          uuid primary key references party(id),
  dek_id            uuid not null references data_encryption_key(id),
  given_name_enc    bytea,
  family_name_enc   bytea,
  dob_enc           bytea,
  phone_enc         bytea,
  email_enc         bytea,
  email_hmac        bytea,
  phone_hmac        bytea,
  identity_fingerprint text,
  updated_at        timestamptz not null default now()
);
create index on party_identity (email_hmac);
create index on party_identity (phone_hmac);
create index on party_identity (identity_fingerprint) where identity_fingerprint is not null;

create table external_identity_ref (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid not null references party(id),
  vendor            text not null,             -- 'certn','plaid','stripe'
  vendor_subject_id text not null,
  first_seen_at     timestamptz not null default now(),
  unique (vendor, vendor_subject_id)
);

create table party_role (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid not null references party(id),
  org_id            uuid references org(id),
  role              text not null check (role in
                      ('renter','landlord','agent','broker','broker_admin',
                       'solar_homeowner','solar_rep','rbit_admin','rbit_support',
                       'rbit_super_admin')),
  status            text not null default 'active',
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz
);
create unique index party_role_unique_active on party_role
  (party_id, coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid), role)
  where revoked_at is null;
```

**`party_features` — the retained half.** No FK cascade from `party`.

```sql
create table party_features (
  party_id            uuid primary key,
  first_seen_at       timestamptz not null,
  home_submarket_id   uuid,
  home_h3_r8          text,
  income_band         int,
  income_source       text,
  employment_band     text,
  household_size      int,
  application_count   int not null default 0,
  interest_received_count int not null default 0,
  approval_count      int not null default 0,
  decline_count       int not null default 0,
  placement_count     int not null default 0,
  fraud_flag_count    int not null default 0,
  paid_upfront_screening_count int not null default 0,
  latest_score        numeric,
  updated_at          timestamptz not null default now()
);
```

### 4.2 Passwordless authentication

1. Email captured at first meaningful intake step — inline in the form, not a gate.
2. On submit, `party` + `party_identity` created immediately; `email_hmac` deduped against existing.
3. Opaque single-use token (32 bytes, 15 min TTL, bound to email + purpose) emailed. OTP code offered as mobile alternative.
4. Redemption creates a session: 30 days, sliding, device-bound, revocable.
5. Elevated actions (viewing a report, accepting a placement, changing payout details) require re-verification within a 15-minute window.

Anti-abuse: per-email and per-IP rate limits on token issuance; tokens invalidated on redemption and on issuance of a newer token; enumeration-resistant responses (identical response whether or not the email exists).

**There is no sign-up screen.** The account exists from field one. This is what makes resumption, dedup, secure delivery, and deletion possible.

### 4.3 Impersonation

```sql
create table impersonation_session (
  id                      uuid primary key default gen_random_uuid(),
  admin_party_id          uuid not null references party(id),
  target_party_id         uuid not null references party(id),
  reason_code             text not null,
  ticket_ref              text,
  dual_approval_request_id uuid references dual_approval_request(id),
  started_at              timestamptz not null default now(),
  expires_at              timestamptz not null,       -- max 60 min, enforced
  ended_at                timestamptz,
  is_read_only            boolean not null default true
);
```

Read-only by default. Write-enabled impersonation requires a resolved `dual_approval_request` (§3.2). Every request inside the session stamps `impersonation_session_id` into `admin_action_log`. The impersonated user sees a persistent banner and receives a notification. Sessions hard-expire server-side.

### 4.4 Org claim flow (C1 resolved)

Ingestion creates `org` rows from feed metadata with `claim_status = 'unclaimed'`. No human at that company has an account. Applications against their listings would otherwise queue with nobody able to act.

```sql
create table org_claim (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references org(id),
  claimant_party_id uuid not null references party(id),
  method            text not null check (method in
                      ('email_domain','phone_verification','admin_manual','feed_credential')),
  evidence          jsonb not null,
  status            text not null check (status in ('pending','approved','rejected')),
  reviewed_by_party_id uuid references party(id),
  requested_at      timestamptz not null default now(),
  resolved_at       timestamptz
);
```

Rules: unclaimed orgs display listings normally. Applications against unclaimed-org listings are accepted and surfaced in the admin queue with a banner rather than silently queuing. Approval grants `party_role` on the **existing** org — never creates a duplicate. `feed_credential` method auto-approves when the claimant demonstrates control of the ingestion credential. Outbound claim invitations trigger automatically once a submarket exceeds a configured unclaimed-inventory threshold.

---

## 5. Geography

Every applicant, listing, search, and rollup shares one geo key set.

```sql
create table submarket (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  metro_code    text not null,
  boundary      geography(Polygon, 4326) not null,
  version       text not null,
  is_active     boolean not null default true
);

create table address (
  id                  uuid primary key default gen_random_uuid(),
  raw_input           text not null,
  line1               text,
  line2               text,
  city                text,
  state               char(2),
  postal_code         text,
  postal_plus4        text,
  is_dpv_confirmed    boolean,
  normalized_hash     text not null,
  geom                geography(Point, 4326),
  geocode_precision   text check (geocode_precision in
                        ('rooftop','parcel','interpolated','centroid')),
  tract_geoid         text,
  block_group_geoid   text,
  county_fips         char(5),
  cbsa_code           text,
  h3_r7               text,
  h3_r8               text,
  h3_r9               text,
  submarket_id        uuid references submarket(id),
  normalizer_vendor   text not null,
  normalizer_version  text not null,
  normalized_at       timestamptz not null default now()
);
create unique index on address (normalized_hash);
create index on address using gist (geom);
create index on address (submarket_id, tract_geoid);
```

**Rules.** Normalization happens at write time, synchronously, before persistence. No raw addresses in supply or demand tables. `normalizer_version` persisted so re-normalization sweeps are auditable. Rent bands, bed bands, and score cohorts key on `submarket_id` primary, `h3_r8` and `tract_geoid` secondary. **ZIP is not an analytic grain** — captured for display only.

Unit label normalization (`Apt 2`, `#2`, `Unit 2` → `2`) with uniqueness on `(property_id, unit_label_normalized)` is what prevents two brokers double-counting one unit as two units of supply.

---

## 6. Supply

```sql
create table property (
  id            uuid primary key default gen_random_uuid(),
  address_id    uuid not null unique references address(id),
  property_type text not null,
  year_built    int,
  created_at    timestamptz not null default now()
);

create table unit (
  id                      uuid primary key default gen_random_uuid(),
  property_id             uuid not null references property(id),
  unit_label_raw          text,
  unit_label_normalized   text not null default '',
  bedrooms                numeric(3,1),
  bathrooms               numeric(3,1),
  sqft                    int,
  created_at              timestamptz not null default now(),
  unique (property_id, unit_label_normalized)
);

create table listing (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references org(id),
  unit_id             uuid not null references unit(id),
  origin              text not null check (origin in ('manual','ingested','hybrid')),
  primary_source_listing_id uuid,
  rent_amount_cents   int not null,
  deposit_cents       int,
  available_on        date,
  lease_term_months   int,
  status              text not null check (status in
                        ('draft','active','paused','stale','expired','rented',
                         'removed','archived')),
  published_at        timestamptz,
  last_confirmed_at   timestamptz not null default now(),
  stale_at            timestamptz,
  expires_at          timestamptz,
  rented_at           timestamptz,
  created_at          timestamptz not null default now()
);
create index on listing (status, org_id);
create index on listing (unit_id) where status = 'active';
```

**`listing` is a canonical projection, not a source record.** One unit may be represented by several partner feeds plus a manual entry. Each is a `source_listing` row (§6A); `listing` is the merged view with per-field provenance. Manual entry is modeled as `adapter_kind = 'manual'` so one merge path serves both. There is no separate code path for manual vs. ingested supply.

**Lifecycle.**

```
draft ──▶ active ──▶ paused ──▶ active
            │  │
            │  ├──▶ stale ──▶ active   (confirmed)
            │  │        └──▶ expired
            │  ├──▶ rented ──▶ archived
            │  └──▶ removed
```

`active` → `stale` at `last_confirmed_at + 14d` (config). Stale demoted in search, flagged in owner dashboard. `stale` → `expired` at +21d, leaves search. Any owner action resets `last_confirmed_at`.

`rented` requires explicit source: a linked `placement` reaching `lease_signed`, or owner attestation. An owner marking rented without a linked placement is recorded as **off-platform leakage** — tracked as a funnel metric, not swallowed.

**Media pipeline:** upload → virus scan → type sniff (not extension trust) → EXIF strip (GPS especially) → resize ladder → CDN. Originals in cold storage, derivatives hot. Media rows carry `org_id` and inherit listing entitlements.

**Deduplication:** handled by the §6A.3 resolution engine for all origins. A unit counts once in supply metrics regardless of how many sources claim it.

---

## 6A. Listing ingestion and partner connectors

Supply is the cold-start constraint. Asking a partner to re-enter inventory they already maintain elsewhere is the highest-friction possible ask.

### 6A.1 Source taxonomy

| Adapter kind | Protocol | Notes |
|---|---|---|
| `reso_web_api` | REST/OData, OAuth2 | Modern MLS standard. Cursor on `ModificationTimestamp`. |
| `rets` | XML/DMQL2, session-based | Legacy. Build only if a launch market requires it. |
| `mls_grid`, `trestle`, `bridge`, `spark` | RESO-normalized aggregators | One integration, many MLSs. See D-12. |
| `listhub_xml`, `zillow_feed_xml`, `generic_rss` | XML/RSS pull | Many operators already publish one to syndicate. Lowest-friction ask. |
| `appfolio`, `buildium`, `rentmanager`, `yardi`, `entrata`, `doorloop` | Vendor APIs / feed exports | **Where rental inventory actually lives.** Prioritize over MLS proper. |
| `push_webhook` | Partner POSTs to RBIT | Same landing zone as pull. |
| `csv_upload` | Operator-initiated file | The floor. Always supported. |
| `manual` | In-app entry | Modeled as a source so merge logic is uniform. |
| `custom_http` | Configured JSON/XML endpoint | Escape hatch. |

```ts
interface ListingSourceAdapter {
  testConnection(cfg: SourceConfig): Promise<ConnectionTestResult>;
  fetchIncremental(cfg: SourceConfig, cursor: string | null): AsyncIterable<RawRecord>;
  fetchFull(cfg: SourceConfig): AsyncIterable<RawRecord>;
  capabilities(): {
    supportsIncremental: boolean;
    supportsDelistSignal: boolean;
    supportsMedia: boolean;
    cursorField: string | null;
  };
}
```

Adapters return raw records only. No adapter normalizes, geocodes, or resolves — that happens downstream in one shared pipeline so improving normalization improves every source at once.

### 6A.2 Schema

```sql
create table source (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references org(id),
  name                  text not null,
  adapter_kind          text not null,
  status                text not null check (status in
                          ('pending_auth','testing','dry_run','active',
                           'paused','failed','disabled')),
  credential_ref        text,
  config                jsonb not null,
  mapping_profile_id    uuid references mapping_profile(id),
  display_rule_id       uuid references source_display_rule(id),
  precedence            int not null default 100,
  sync_mode             text not null check (sync_mode in
                          ('pull_incremental','pull_full','push','manual')),
  sync_interval_seconds int,
  rate_limit_per_minute int,
  last_cursor           text,
  last_success_at       timestamptz,
  consecutive_failures  int not null default 0,
  created_at            timestamptz not null default now()
);

create table sync_run (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid not null references source(id),
  run_kind            text not null check (run_kind in
                        ('incremental','full_reconcile','backfill','push','dry_run')),
  status              text not null check (status in
                        ('running','succeeded','failed','quarantined','aborted')),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  cursor_from         text,
  cursor_to           text,
  records_fetched     int not null default 0,
  records_new         int not null default 0,
  records_changed     int not null default 0,
  records_unchanged   int not null default 0,
  records_rejected    int not null default 0,
  records_absent      int not null default 0,
  quarantine_reason   text,
  error_class         text,
  error_detail        text
);
create index on sync_run (source_id, started_at desc);

create table raw_record (
  id                  bigserial,
  source_id           uuid not null,
  sync_run_id         uuid not null,
  external_id         text not null,
  payload             jsonb,
  payload_ref         text,
  payload_hash        text not null,
  source_modified_at  timestamptz,
  received_at         timestamptz not null default now(),
  transformed_at      timestamptz,
  mapping_version     text,
  transform_error     text,
  primary key (id, received_at)
) partition by range (received_at);
create unique index on raw_record (source_id, external_id, payload_hash, received_at);

create table source_listing (
  id                    uuid primary key default gen_random_uuid(),
  source_id             uuid not null references source(id),
  org_id                uuid not null,
  external_id           text not null,
  raw_record_id         bigint,
  address_id            uuid references address(id),
  unit_id               uuid references unit(id),
  resolution_status     text not null check (resolution_status in
                          ('pending','resolved','ambiguous','unresolvable')),
  resolution_confidence numeric,
  rent_amount_cents     int,
  deposit_cents         int,
  bedrooms              numeric(3,1),
  bathrooms             numeric(3,1),
  sqft                  int,
  available_on          date,
  lease_term_months     int,
  description           text,
  source_status_raw     text,
  mapped_status         text check (mapped_status in
                          ('active','pending','delisted','rented')),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  absent_since          timestamptz,
  mapping_version       text not null,
  unique (source_id, external_id)
);
create index on source_listing (unit_id) where mapped_status = 'active';
create index on source_listing (resolution_status) where resolution_status <> 'resolved';

create table listing_field_provenance (
  listing_id        uuid not null references listing(id),
  field_name        text not null,
  source_listing_id uuid not null references source_listing(id),
  value_hash        text not null,
  set_at            timestamptz not null default now(),
  primary key (listing_id, field_name)
);

create table mapping_profile (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  adapter_kind  text not null,
  version       text not null,
  field_map     jsonb not null,
  value_maps    jsonb not null,
  created_at    timestamptz not null default now(),
  unique (name, version)
);

create table source_display_rule (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  version               text not null,
  is_attribution_required boolean not null default false,
  attribution_text      text,
  suppress_fields       text[] not null default '{}',
  show_exact_address    boolean not null default true,
  media_policy          text not null check (media_policy in ('host','hotlink','none')),
  max_cache_age_seconds int,
  purge_on_delist_hours int,
  unique (name, version)
);

create table unit_source_conflict (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references unit(id),
  field_name        text not null,
  values_seen       jsonb not null,
  detected_at       timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by_party_id uuid,
  resolution        text
);

alter table listing add constraint listing_primary_source_fk
  foreign key (primary_source_listing_id) references source_listing(id);
```

Display rules are enforced as data in one serializer, not scattered view logic. Rule content per partner is §18 D-11; the enforcement layer is unblocked.

### 6A.3 Pipeline

```
  pull adapter ─┐
                ├──▶ raw_record ──▶ transform ──▶ resolve ──▶ merge ──▶ listing
  push webhook ─┘   (landing zone)   (mapping)    (entity)   (precedence)
                                                      │
                                                      └──▶ ambiguous queue
```

**Land.** Raw payload written unmodified, hashed, partitioned by receipt date. Unique index on `(source_id, external_id, payload_hash)` makes re-fetching unchanged records a no-op. Landing before transforming means a mapping improvement replays over historical payloads without re-hitting partner APIs — which matters because partner rate limits bind backfills.

**Transform.** Apply `mapping_profile` at pinned version. Persist version on `source_listing` (P4). Reject records missing required canonical fields into a rejection log with reason codes — never silently drop.

Two silent bug classes to guard explicitly:
- **Currency scale.** Feeds give dollars, cents, or symbol-prefixed strings. Assert rent within a configured sane band per submarket; quarantine on median shift beyond threshold.
- **Unit label collapse.** A feed listing an entire building as one record with a unit count is not one unit. Detect and route to ambiguous queue rather than creating a phantom unit.

**Resolve.** Normalize address (§5), then:

1. Exact match on `normalized_hash` + `unit_label_normalized` → `resolved`.
2. No match, DPV-confirmed → create `property`/`unit` → `resolved`.
3. Not DPV-confirmed, or geocode precision worse than parcel → `ambiguous`, admin queue.
4. Fuzzy candidate (geom within 30m, same unit label, same bed/bath) above confidence threshold → `resolved` with confidence recorded; below → `ambiguous`.
5. No usable address → `unresolvable`, rejection log.

An ambiguous record never silently becomes supply.

**Merge.** For a `unit_id` with multiple active `source_listing` rows, compute canonical `listing` by field-level precedence: lowest `source.precedence` with a non-null value wins, ties broken by `last_seen_at`. Default ladder — landlord direct (10) → PM system (20) → MLS/aggregator (30) → syndication feed (40) → import (50).

Rent disagreement beyond configured tolerance (default 10%) does not silently resolve: writes `unit_source_conflict`, surfaces in admin queue, holds the previous canonical value. Every merged field writes `listing_field_provenance`.

### 6A.4 Delist detection

Feeds report what exists, not what vanished. Both mechanisms required:

1. **Delta signal** where `supportsDelistSignal` — RESO `StandardStatus` transitions, explicit removal events. Applied immediately.
2. **Full reconciliation sweep**, scheduled per source (default weekly, Temporal workflow): fetch complete active set, stamp `absent_since` on any `source_listing` with `last_seen_at < sync_run.started_at`.

After grace window (default 48h), absent → `mapped_status = 'delisted'`, canonical listing recomputed. If no active `source_listing` remains and no landlord attestation exists, `listing` → `expired`. **Delisting is a state transition, never a hard delete** — the record is needed for supply history, days-on-market, and leakage metrics.

A full reconcile that would delist more than a configured share (default 30%) is **quarantined, not applied**. A feed dropping 80% overnight is a broken sync, not a market event.

### 6A.5 Quality gates

Quarantine and do not apply if: record count deviates beyond threshold from trailing median; rejection rate exceeds threshold; median rent shifts beyond threshold; a required field is null across >50% of records; resolution failure rate exceeds threshold.

Quarantined runs alert, appear in the admin queue with a diff against the prior run, and require `ingestion.quarantine_override` (dual-approval, §3.2) to apply. Thresholds live in `config_version` namespace `ingestion_thresholds`.

### 6A.6 Media

Fetch during transform, not lazily at render — feed URLs expire. `media_policy` per source: `host`, `hotlink`, or `none`. Content-hash dedup across feeds. Media set change detection by ordered hash list. Refetch 404 marks media stale and alerts; never drops the listing. Same scan/sniff/strip pipeline as manual uploads.

### 6A.7 Credentials, rate limits, push

**Credentials** in Secrets Manager; `source.credential_ref` holds only a handle. OAuth refresh worker with expiry alerting ahead of lapse. Dual-credential rotation window. Credentials never in logs, traces, or `sync_run.error_detail`.

**Rate limits.** Per-source token bucket. Respect `Retry-After`. Exponential backoff with jitter. Circuit breaker opens after N consecutive failures, sets `status = 'failed'`, notifies RBIT ops and partner contact. Backfills run at lower priority than incrementals.

**Push endpoint.**

```
POST /v1/ingest/{source_id}
X-RBIT-Signature: t=<unix_seconds>,v1=<hmac_sha256(secret, t + "." + rawBody)>
```

Verify HMAC; reject if `|now - t| > 300s`; nonce cache for replay protection; write `raw_record`; return `202`; transform asynchronously. Dual-secret rotation window. Push and pull share the identical downstream pipeline.

### 6A.8 Partner onboarding

Must be self-serve or supply growth caps at headcount.

1. **Select system** — adapter list, or "not listed" → CSV/custom.
2. **Authorize** — API key, OAuth, or receive push URL + signing secret.
3. **Connection test** — `testConnection()` validates auth, fetches ~5 records. Actionable errors, never raw stack traces.
4. **Mapping preview** — raw fields side-by-side with normalized output on real samples. Partner confirms or adjusts.
5. **Dry run** — full sync with `run_kind = 'dry_run'`: reports fetched, resolved, rejected, would-be-created counts. **Writes nothing to canonical tables.**
6. **Activate** — schedule set, first real sync runs.

Partner status view: last successful sync, counts by state, unresolved records with reasons, quarantined runs.

### 6A.9 Observability

Per source: sync success rate, records fetched/changed/rejected, resolution rate, median freshness, quarantine count, media failure rate, credential expiry runway, breaker state.

Alerts: source failed, quarantined run, credential expiring within 7 days, freshness exceeding 2× sync interval, resolution rate below threshold.

---

## 7. Renter profile, applications, and screening

### 7.1 The two-object split

Matching is two-way (§9). A renter's verified profile is durable and portable; an application is a thin join to a specific unit.

```sql
create table renter_profile (
  id                    uuid primary key default gen_random_uuid(),
  party_id              uuid not null unique references party(id),
  -- search criteria, drives discoverability matching
  target_submarket_ids  uuid[] not null default '{}',
  rent_max_cents        int,
  bedrooms_min          numeric(3,1),
  move_in_earliest      date,
  move_in_latest        date,
  household_size        int,
  has_pets              boolean,
  -- verification state
  badge_state           text not null default 'unverified' check (badge_state in
                          ('unverified','prechecked','fully_screened')),
  badge_computed_at     timestamptz,
  -- discoverability
  is_discoverable       boolean not null default false,
  discoverability_level text not null default 'minimal' check (discoverability_level in
                          ('minimal','full')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on renter_profile (badge_state) where is_discoverable = true;
```

**Discoverability defaults to off.** Explicit opt-in, never opt-out. At `minimal`, a landlord sees badge state, score band, and criteria only — never identity. See §9.4.

### 7.2 Verification badge decomposition

The expensive pull is deferred; the cheap half runs for everyone.

| Component | Certn product | Cost | When |
|---|---|---|---|
| Identity verified | OneID | $2.99 | Upfront, all applicants |
| Income verified | Plaid bank/payroll | ~$0.30–6.10 | Upfront, all applicants |
| Criminal | US Unlimited County Criminal Tier 1 | $10.49 | Deferred |
| Credit | Equifax via Certn | $7.99 | Deferred |
| Risk Insight | adverse media, PEP, public legal records, watchlist | $7.99 | Deferred |

Badge states: `unverified` → `prechecked` (identity + income) → `fully_screened` (full package complete).

Landlords filter on badge state independently. A landlord searching "income verified, meets 3× rent, in my submarket" gets real value from a pool costing RBIT a few dollars per head.

### 7.3 Screening package config (not hardcoded)

Addison's tiering instinct is correct and cheap to build now.

```sql
create table screening_package (
  id                  uuid primary key default gen_random_uuid(),
  package_key         text not null,
  version             text not null,
  vendor              text not null default 'certn',
  product_codes       text[] not null,
  applies_to_rs_tiers text[],                  -- null = default package
  total_cost_cents    int not null,
  is_active           boolean not null default true,
  unique (package_key, version)
);
```

Launch state: one package `standard` = `{oneid, criminal_tier_1, credit_equifax, risk_insight}`, `total_cost_cents = 2946`, applies to all. Tiering criminal depth by RS band later is a config change, not a migration.

### 7.4 Screening order and per-product reports

One Certn API call, one charge, fanning out to one `screening_report` row per product — so re-pull cadence can stagger per product later.

```sql
create table screening_order (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null references party(id),
  application_id      uuid references application(id),
  package_id          uuid not null references screening_package(id),
  payer_kind          text not null check (payer_kind in
                        ('applicant','landlord','broker','rbit_promotional')),
  payer_party_id      uuid references party(id),
  payer_org_id        uuid references org(id),
  amount_charged_cents int not null,
  vendor_order_ref    text,
  status              text not null check (status in
                        ('pending_payment','paid','submitted','partial',
                         'complete','failed','cancelled')),
  is_rebate_eligible  boolean not null default true,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create table screening_report (
  id                uuid primary key default gen_random_uuid(),
  screening_order_id uuid not null references screening_order(id),
  party_id          uuid not null references party(id),
  vendor            text not null,
  vendor_report_id  text not null,
  report_kind       text not null check (report_kind in
                      ('identity','credit','criminal','risk_insight','income')),
  issued_at         timestamptz,
  expires_at        timestamptz,
  payload_ref       text,
  payload_hash      text,
  derived_summary   jsonb,
  cost_cents        int,
  status            text not null check (status in
                      ('pending','complete','failed','expired')),
  unique (vendor, vendor_report_id)
);

create table screening_report_access (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references screening_report(id),
  granted_to_org_id uuid not null references org(id),
  application_id    uuid references application(id),
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  first_viewed_at   timestamptz,
  view_count        int not null default 0
);
```

Landlords never see raw vendor payload — only `derived_summary`. Portability is one report, many access grants within `expires_at` (window is §18 D-02). Every grant and view writes to the audit log.

**Partial completion is normal, not an error.** Credit may clear while criminal is pending. `application.status` does not advance to `screened` until every product in the package resolves or times out. The Certn saga is a Temporal workflow.

### 7.5 Risk Insight adverse action gate

Risk Insight public legal records are sourced from a public-records aggregator, not court dockets directly. Coverage and match accuracy are unconfirmed pending Klaus's response.

```
config namespace: screening_policy
  risk_insight_auto_adverse_action_enabled: false   -- default, do not change without D-15
```

While false, any decline driven primarily by Risk Insight eviction data routes to a human review queue instead of an automated reject. Overriding requires `screening.adverse_action_override` (dual approval). This is cheap now and is the difference between a defensible process and an automated reject on unverified aggregator data.

### 7.6 Income verification hierarchy

```sql
create table income_verification (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null references party(id),
  method              text not null check (method in
                        ('plaid_bank','plaid_payroll','vendor_payroll','document','stated')),
  confidence          numeric not null,
  monthly_income_cents int,
  verified_at         timestamptz not null,
  expires_at          timestamptz,
  vendor_ref          text,
  evidence_ref        text
);
```

Confidence weights by method are config (`verification_confidence` namespace), not literals. A `document` verification never carries the same weight as `plaid_bank` in scoring, and the score explanation surfaces which method was used.

### 7.7 Application state machine

```
draft ──▶ submitted ──▶ prescreen ──┬──▶ prescreen_failed ──▶ closed
                                    │
                                    └──▶ awaiting_landlord_interest
                                              │
                                              ▼
                                    screening_authorized
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              screening_running    screening_failed ──▶ closed
                                    │
                                    ▼
                              screened ──▶ decisioned ──▶ closed
                                    │
                                    └──▶ withdrawn | expired
```

```sql
create table application (
  id                    uuid primary key default gen_random_uuid(),
  party_id              uuid not null references party(id),
  renter_profile_id     uuid not null references renter_profile(id),
  listing_id            uuid references listing(id),
  unit_id               uuid references unit(id),
  org_id                uuid not null,
  entry_point           text not null check (entry_point in
                          ('renter_initiated','landlord_invited')),
  landlord_interest_id  uuid,
  status                text not null,
  submitted_at          timestamptz,
  screening_authorized_at timestamptz,
  screened_at           timestamptz,
  closed_at             timestamptz,
  expires_at            timestamptz,
  source_channel        text,
  device_id             text,
  created_at            timestamptz not null default now()
);
create index on application (party_id, status);
create index on application (listing_id, status);
```

`prescreen` is a cheap rules filter running **before** any paid vendor call — the cost control on ~$29.46 COGS. It never rejects on a protected characteristic and always emits reason codes to the audit log.

**MVP timing:** the full package fires on `application.status → screening_authorized`, post-intake, pre-landlord-notification. The state machine also supports applicant-pay-upfront (badge before applying); MVP does not exercise that entry point but the transition exists. Willingness to pay upfront is persisted in `party_features.paid_upfront_screening_count` as a scoring feature.

### 7.8 Screening rebate

The incentive not to abandon the platform mid-process.

```sql
create table screening_rebate (
  id                  uuid primary key default gen_random_uuid(),
  screening_order_id  uuid not null unique references screening_order(id),
  party_id            uuid not null references party(id),
  placement_id        uuid not null references placement(id),
  amount_cents        int not null,
  status              text not null check (status in
                        ('eligible','payout_details_requested','processing',
                         'paid','failed','expired')),
  payout_method_ref   text,                    -- Stripe payout destination token
  eligible_at         timestamptz not null default now(),
  paid_at             timestamptz,
  expires_at          timestamptz not null
);
```

**Rules.**
- Trigger is `placement.funded`, **not** `lease_signed` — do not rebate deals that collapse.
- One rebate per `screening_order`, enforced by the unique constraint. A renter with six applications on one screening purchase gets one rebate.
- **Payout details are collected at rebate time, not at intake.** Keeps bank data out of the funnel for the ~95% who never trigger it, shrinks PII surface, removes a conversion-killing field from the form.
- Eligibility evaluation runs as a Temporal workflow on `placement.funded`.

### 7.9 Fraud signal stack

- **Device and session:** fingerprint, IP reputation, headless detection. `device_id` on every application.
- **Velocity rules:** N applications per device/phone/IP/email-domain per window. Thresholds in `fraud_thresholds` config.
- **Verification hierarchy:** Plaid-verified income scored at higher confidence than uploaded PDF (§7.6).
- **Document forensics:** PDF producer metadata, creation/mod timestamps, incremental saves, font consistency. Catches most amateur edits cheaply.
- **Vendor signals:** Certn OneID synthetic-identity flags, SSN-issuance-vs-DOB mismatch.
- **Behavioral:** time-to-complete, copy-paste detection on income fields, repeated field patterns.
- **Cross-application entity graph:** same phone across different names, same bank account across identities, address/employer clusters. Built from retained `party_features` — the second reason declines are never purged.

```sql
create table fraud_signal (
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid references party(id),
  application_id  uuid references application(id),
  signal_kind     text not null,
  severity        text not null check (severity in ('low','medium','high')),
  detail          jsonb not null,
  detected_at     timestamptz not null default now(),
  review_status   text not null default 'pending' check (review_status in
                    ('pending','confirmed_fraud','cleared','ignored')),
  reviewed_by_party_id uuid,
  reviewed_at     timestamptz
);
```

**Nothing auto-rejects.** Signals route to a review queue with reason codes. Confirmed fraud becomes a training label and increments `party_features.fraud_flag_count`.

---

## 8. Scoring and the outcome feedback loop

The system that makes RBIT defensible, and the one that silently fails if outcome capture is deferred.

### 8.1 Reproducibility contract

```sql
create table model_registry (
  id                uuid primary key default gen_random_uuid(),
  model_key         text not null,
  version           text not null,
  kind              text not null check (kind in ('rules','ml')),
  artifact_ref      text,
  feature_spec      jsonb not null,
  trained_at        timestamptz,
  training_window   tstzrange,
  training_row_count int,
  activated_at      timestamptz,
  retired_at        timestamptz,
  unique (model_key, version)
);

create table score (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid references application(id),
  renter_profile_id uuid references renter_profile(id),
  party_id          uuid not null references party(id),
  model_key         text not null,
  model_version     text not null,
  cohort_key        text not null,
  cohort_n          int not null,
  raw_score         numeric not null,
  percentile        numeric,
  band              text,
  feature_snapshot  jsonb not null,
  feature_sources   jsonb not null,
  explanation       jsonb not null,
  computed_at       timestamptz not null default now(),
  computed_by       text not null
);
create index on score (application_id, computed_at desc);
create index on score (party_id, computed_at desc);
```

**Invariants, enforced by test.** `score` is insert-only — `UPDATE`/`DELETE` revoked for the application role. Replaying `feature_snapshot` through `model_version` reproduces `raw_score` within floating tolerance, asserted on a fixture set every deploy. `explanation` is non-empty for every score; a score without an explanation cannot be displayed.

### 8.2 Cohort normalization

```
submarket:{submarket_id}|bedband:{1|2|3|4+}|rentband:{800-1200}|window:{trailing_180d}
```

`cohort_n` persisted alongside. Below a configured floor (default 50), fall back to next-coarser cohort (metro → state) and record that it happened. Thin-cohort scores are flagged in the UI, never silently presented as equivalent.

This is also why regional concentration beats national spread early: thin cohorts everywhere means no trustworthy score anywhere.

### 8.3 Feature store and leakage prevention

```sql
create table feature_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  party_id            uuid not null,
  application_id      uuid,
  computed_at         timestamptz not null,
  feature_set_version text not null,
  features            jsonb not null,
  point_in_time_key   timestamptz not null
);
```

**Leakage rule:** training feature assembly reconstructs state as of `point_in_time_key` and never reads a column written after that timestamp. A leakage test with a known-poisoned fixture must fail the build if the assertion is removed.

**Offline/online parity:** one feature-assembly implementation used by both live scoring and training. Divergent implementations are prohibited.

### 8.4 Outcome capture — the label pipeline

```sql
create table placement_outcome (
  id                uuid primary key default gen_random_uuid(),
  placement_id      uuid not null references placement(id),
  horizon_days      int not null check (horizon_days in (30, 90, 180, 365)),
  requested_at      timestamptz not null,
  reported_at       timestamptz,
  reporter_party_id uuid references party(id),
  source            text check (source in
                      ('landlord_attest','broker_attest','tenant_attest',
                       'inferred','no_response')),
  payment_status    text check (payment_status in
                      ('current','late_1_30','late_31_60','late_60_plus','default','n_a')),
  tenancy_status    text check (tenancy_status in
                      ('occupied','vacated_normal','vacated_early','evicted','n_a')),
  incident_flags    text[] not null default '{}',
  confidence        numeric,
  unique (placement_id, horizon_days)
);
```

**Mechanics.**
- On `placement.lease_signed`, a Temporal workflow schedules all four horizons. The schedule is data created at signing, not a nightly scan for eligible placements.
- At each horizon, a single-tap request goes to landlord (primary) and broker (secondary): "Still current / Late / Vacated / Evicted." **Answerable from the email itself without login** for low-sensitivity fields — friction here directly reduces label volume.
- Non-response after N reminders records `source = 'no_response'`. **Non-response is recorded, never left null** — missing-not-at-random is a modeling hazard and must be observable.
- Off-platform leakage (listing marked rented with no placement) recorded as a separate outcome class.
- Confirmed fraud, disputes, and chargebacks also write labels.

**Label coverage is a first-class dashboard metric.** Target ≥60% response at 90 days. Below 40%, the model is not trainable and the roadmap must say so rather than shipping a model trained on a biased quarter of the population.

### 8.5 Model progression

- **v0 (Phase 1):** deterministic rules engine — versioned, registered, explained, scored through the exact interface an ML model will use. The plumbing is identical so swapping models is a config change.
- **v1 (Phase 7, gated):** gradient-boosted model, offline eval against v0, 30-day production shadow scoring before activation.
- Drift monitoring from day one: feature distribution, score distribution per cohort, outcome-rate drift.

---

## 9. Matching — two-way

### 9.1 Entry points

| Path | Flow |
|---|---|
| **Renter-initiated** | Browse listings → apply → `application` with `entry_point = 'renter_initiated'` |
| **Landlord-initiated** | Search discoverable renter pool → express interest in a renter for a specific listing → renter accepts → `application` with `entry_point = 'landlord_invited'`, skipping already-satisfied verification steps |

`landlord_interest` (invitation) precedes an application. `landlord_decision` follows one. Neither consumes exclusivity — scarcity locks only at accept (§9.3).

```sql
create table landlord_interest (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listing(id),
  org_id            uuid not null,
  renter_profile_id uuid not null references renter_profile(id),
  initiated_by_party_id uuid not null references party(id),
  message           text,
  status            text not null check (status in
                      ('sent','viewed','accepted','declined','expired','withdrawn')),
  sent_at           timestamptz not null default now(),
  responded_at      timestamptz,
  expires_at        timestamptz not null,
  search_filter_snapshot jsonb not null      -- audit: what filters surfaced this renter
);
create index on landlord_interest (renter_profile_id, status);
```

### 9.2 Decisions

```sql
create table landlord_decision (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references application(id),
  listing_id        uuid not null references listing(id),
  org_id            uuid not null,
  decided_by_party_id uuid not null references party(id),
  decision          text not null check (decision in
                      ('interested','approved','declined','withdrawn')),
  reason_codes      text[] not null default '{}',
  score_id          uuid references score(id),
  decided_at        timestamptz not null default now(),
  superseded_at     timestamptz
);
create index on landlord_decision (application_id, decided_at desc);
create unique index one_live_decision_per_application
  on landlord_decision (application_id) where superseded_at is null;
```

Multiple landlords approving the same applicant concurrently is expected and desirable. `party_features.approval_count` is a strong scoring feature and a marketplace-health metric.

### 9.3 Placement and the exclusivity lock

```sql
create table placement (
  id                  uuid primary key default gen_random_uuid(),
  unit_id             uuid not null references unit(id),
  listing_id          uuid not null references listing(id),
  application_id      uuid not null references application(id),
  party_id            uuid not null references party(id),
  org_id              uuid not null,
  broker_org_id       uuid references org(id),
  status              text not null check (status in
                        ('hold','broker_assigned','lease_signed','funded',
                         'closed','lapsed','cancelled')),
  hold_expires_at     timestamptz,
  hold_extension_count int not null default 0,
  accepted_at         timestamptz not null default now(),
  broker_assigned_at  timestamptz,
  lease_signed_at     timestamptz,
  funded_at           timestamptz,
  terminal_at         timestamptz
);

create unique index one_active_placement_per_unit on placement (unit_id)
  where status in ('hold','broker_assigned','lease_signed');

create unique index one_active_hold_per_party on placement (party_id)
  where status in ('hold','broker_assigned');
```

**Scarcity is enforced by the database, not application code, not Redis.** The partial unique index is the lock. Fifty concurrent accepts produce exactly one placement.

```
hold ──▶ broker_assigned ──▶ lease_signed ──▶ funded ──▶ closed
 │              │                   │
 ├──▶ lapsed    ├──▶ lapsed         └──▶ cancelled
 └──▶ cancelled └──▶ cancelled
```

Hold TTL default 48h (config), broker-extendable once by 48h. On lapse or cancel, the index frees, listing returns to `active`, queue auto-promotes. Hold expiry is a Temporal timer.

### 9.4 Queue and discoverability

```sql
create table placement_queue_entry (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listing(id),
  application_id    uuid not null references application(id),
  rank_score        numeric not null,
  rank_position     int not null,
  entered_at        timestamptz not null default now(),
  promoted_at       timestamptz,
  exited_at         timestamptz,
  exit_reason       text
);
create unique index on placement_queue_entry (listing_id, application_id)
  where exited_at is null;
```

Renter-facing UI shows the listing as **in progress** with honest queue position. The platform stays in the loop through resolution instead of handing off and losing the outcome — the Indeed/LinkedIn failure mode, avoided deliberately.

**Renter discoverability search — the fair-housing-safe query surface.**

The landlord-facing renter search reads **only** `renter_profile` and `party_features`. It never reads `party_identity`. Filterable fields are an explicit allowlist enforced in code:

```
ALLOWED_RENTER_SEARCH_FILTERS = [
  'target_submarket_ids', 'rent_max_cents', 'bedrooms_min',
  'move_in_earliest', 'move_in_latest', 'household_size', 'has_pets',
  'badge_state', 'score_band'
]
```

Any filter key outside the allowlist is rejected at the API boundary, not silently ignored. Every executed search persists its filter set to the audit log, and `landlord_interest.search_filter_snapshot` records what surfaced each contacted renter. Allowlist content requires sign-off — §18 D-13. The enforcement mechanism is unblocked and builds now.

At `discoverability_level = 'minimal'` (default), the response contains badge state, score band, and criteria only. Identity is released only after the renter accepts a `landlord_interest`.

---

## 10. Brokerage and lead marketplace

### 10.1 Broker capability and credit posture

```sql
create table broker_profile (
  org_id              uuid primary key references org(id),
  license_state       char(2) not null,
  license_number      text,
  license_verified_at timestamptz,
  license_expires_at  date,
  status              text not null,
  credit_tier         text not null default 'new' check (credit_tier in
                        ('new','established','invoiced','suspended')),
  max_open_leads      int not null default 10,
  is_auto_accept      boolean not null default false
);

create table broker_coverage (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references org(id),
  submarket_id      uuid not null references submarket(id),
  priority          int not null default 100,
  is_active         boolean not null default true,
  unique (org_id, submarket_id)
);

create table broker_performance (
  org_id                    uuid primary key references org(id),
  window_days               int not null default 90,
  leads_offered             int not null default 0,
  leads_accepted            int not null default 0,
  median_response_seconds   int,
  placements_closed         int not null default 0,
  close_rate                numeric,
  leakage_rate              numeric,
  dispute_count             int not null default 0,
  updated_at                timestamptz not null default now()
);
```

**License gate is hard.** A lead is never offered to an org with `license_verified_at` null, `license_expires_at` passed, or no `broker_coverage` for the listing's submarket. Enforced in the assignment query, asserted by randomized-fixture test. State coverage is §18 D-03.

**Leakage tracking:** leads purchased where the placement never progresses but the listing gets marked rented. A broker-quality signal feeding routing priority — brokers who close on-platform get better leads.

### 10.2 Prepaid balance (fraud posture, A3 resolved)

Money flows broker → RBIT only. There is nothing to withhold. The exposure is chargebacks on non-returnable data, card fraud, and outcome leakage. The answer is prepaid balance, evidence capture, and tiered credit — not escrow.

```sql
create table broker_balance (
  org_id            uuid primary key references org(id),
  balance_cents     bigint not null default 0 check (balance_cents >= 0),
  updated_at        timestamptz not null default now()
);

create table broker_balance_txn (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references org(id),
  kind              text not null check (kind in
                      ('funding','lead_purchase','refund','adjustment')),
  amount_cents      bigint not null,
  balance_after_cents bigint not null,
  ledger_transaction_id uuid,
  lead_id           uuid,
  idempotency_key   text not null unique,
  created_at        timestamptz not null default now()
);
```

Brokers fund a balance; purchases draw down. One funding event to dispute instead of fifty, near-zero per-lead charge failure, cash front-loaded.

**Evidence capture at purchase, not reconstructed later:**

```sql
create table lead_purchase_evidence (
  lead_id           uuid primary key references lead(id),
  purchased_by_party_id uuid not null,
  session_id        uuid not null,
  ip                inet not null,
  user_agent        text,
  tos_version       text not null,
  payload_released  jsonb not null,      -- exactly what was handed over
  released_at       timestamptz not null
);
```

Auto-assembles into a dispute response packet. Disputes are won on provable delivery, and nobody can prove it retroactively.

**Credit tiers:** `new` brokers are prepaid-only with low `max_open_leads`. `established` earns a higher cap. `invoiced` for proven volume. Any open dispute moves the org to `suspended` automatically.

### 10.3 RS tier classification and lead pricing

Tier and fee resolved and persisted at lead creation (P4), never derived at read.

```sql
create table lead (
  id                        uuid primary key default gen_random_uuid(),
  application_id            uuid not null references application(id),
  listing_id                uuid not null references listing(id),
  party_id                  uuid not null references party(id),
  rs_tier                   text not null,
  classifier_version        text not null,
  rent_amount_cents_at_class int not null,
  price_book_version        text not null,
  fee_amount_cents          int not null,
  status                    text not null check (status in
                              ('created','classified','offered','purchased',
                               'released','reoffered','expired','closed','resolved')),
  created_at                timestamptz not null default now()
);

create table lead_offer (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references lead(id),
  broker_org_id     uuid not null references org(id),
  offered_at        timestamptz not null default now(),
  sla_expires_at    timestamptz not null,
  responded_at      timestamptz,
  response          text check (response in ('accepted','declined','expired')),
  decline_reason    text
);
create unique index one_open_offer_per_lead on lead_offer (lead_id)
  where responded_at is null;
```

**RS price book (config namespace `rs_price_book`).** Seed values below. **Dev and staging only** — production effectiveness requires `config.approve` dual approval (§3.2), which cannot be granted until Jacob's review clears. The `config_version.approved_by_party_id` gate enforces this mechanically; no additional mechanism needed.

| Tier | Rent range | Fee (cents) |
|---|---|---|
| RS-1 | $800–1,199 | 6500 |
| RS-2 | $1,200–1,599 | 9000 |
| RS-3 | $1,600–1,999 | 11500 |
| RS-4 | $2,000–2,499 | 14000 |
| RS-5 | $2,500–2,999 | 17000 |
| RS-6 | $3,000–3,999 | 21000 |
| RS-7 | $4,000–5,999 | 29000 |
| RS-8 | $6,000–8,999 | 43000 |
| RS-9 | $9,000–14,999 | 66500 |
| RS-10 | $15,000–24,999 | 107000 |
| RS-11 | $25,000–44,999 | 182000 |
| RS-12 | $45,000+ | 240000 |

**Lead lifecycle.**

- `classified` — tier resolved from active price book; tier, classifier version, rent input, price book version, fee all written. Immutable thereafter.
- `offered` — assignment engine selects one eligible broker; SLA timer starts (Temporal, default 4h business hours).
- `purchased` — balance draw-down or direct charge succeeds. Charge success and state transition share a transaction boundary; orphans are detected and resolved by the reconciler.
- `released` — applicant contact and report access granted. **Only after payment confirmation, never before.** Writes `lead_purchase_evidence`.
- `resolved` — linked to placement terminal state.

Broker UI displays tier, fee, and pricing basis from the persisted `lead` row before purchase. Test asserts displayed fee equals charged amount.

### 10.4 Assignment algorithm

1. **Filter:** license valid, coverage includes submarket, open leads < `max_open_leads`, org active, credit tier not `suspended`, no conflict of interest with listing org.
2. **Rank:** `broker_coverage.priority` desc → `close_rate` desc → `leakage_rate` asc → `median_response_seconds` asc → least-recently-offered.
3. Offer to top-ranked. On decline or SLA expiry, re-offer to next; increment counter.
4. After N re-offers (config, default 3), route to admin queue rather than cycling.

Every assignment logs the full candidate set and ranking inputs to the domain event log, so "why did broker X get this lead" is answerable.

---

## 11. Payments, ledger, reconciliation

### 11.1 Ledger

```sql
create table ledger_account (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  kind                text not null check (kind in
                        ('asset','liability','equity','revenue','expense')),
  counterparty_org_id uuid references org(id),
  counterparty_party_id uuid references party(id),
  currency            char(3) not null default 'USD',
  is_active           boolean not null default true,
  unique (code,
          coalesce(counterparty_org_id,'00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(counterparty_party_id,'00000000-0000-0000-0000-000000000000'::uuid))
);

create table ledger_transaction (
  id                uuid primary key default gen_random_uuid(),
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  kind              text not null,
  idempotency_key   text not null unique,
  source_event_id   uuid,
  reverses_txn_id   uuid references ledger_transaction(id),
  memo              text
);

create table ledger_entry (
  id                bigserial primary key,
  transaction_id    uuid not null references ledger_transaction(id),
  account_id        uuid not null references ledger_account(id),
  direction         char(2) not null check (direction in ('dr','cr')),
  amount_cents      bigint not null check (amount_cents > 0)
);
create index on ledger_entry (account_id, transaction_id);
```

**Balance enforcement — deferred constraint trigger:**

```sql
create or replace function assert_ledger_balanced() returns trigger as $$
declare imbalance bigint;
begin
  select coalesce(sum(case when direction='dr' then amount_cents else -amount_cents end),0)
    into imbalance from ledger_entry where transaction_id = new.transaction_id;
  if imbalance <> 0 then
    raise exception 'ledger imbalance % on txn %', imbalance, new.transaction_id;
  end if;
  return null;
end $$ language plpgsql;

create constraint trigger ledger_balance_check
  after insert on ledger_entry
  deferrable initially deferred
  for each row execute function assert_ledger_balanced();
```

**Immutability:** `UPDATE`/`DELETE` revoked on both ledger tables for the application role. Corrections are reversing transactions referencing `reverses_txn_id`. History is never edited.

### 11.2 Chart of accounts

D-04 resolved: the 20% tenant benefit is a **discount on rent paid directly to the broker** — RBIT never touches, holds, or disburses it. No cashback liability or expense account exists. The only renter-facing payout RBIT owes is the screening rebate (§7.8).

| Code | Kind | Notes |
|---|---|---|
| `asset:cash:stripe` | asset | Stripe balance |
| `asset:cash:operating` | asset | Bank |
| `asset:receivable:pbc_solar` | asset | Solar profit-share receivable |
| `liability:broker_prepaid_balance` | liability | Per-org sub-account |
| `liability:unearned_revenue` | liability | If any lead fee carries a service obligation — see D-05 |
| `liability:payable:solar_homeowner` | liability | Solar cashback owed |
| `liability:payable:screening_rebate` | liability | Rebate accrued, not yet paid |
| `revenue:lead_fee` | revenue | dwel |
| `revenue:profit_share` | revenue | Solar |
| `expense:screening_cogs` | expense | Per-vendor sub-account |
| `expense:screening_rebate` | expense | Rebates paid |
| `expense:processing_fees` | expense | Stripe fees |
| `expense:disputes` | expense | Chargebacks |

### 11.3 Standard entries

**Broker funds balance:**
```
dr asset:cash:stripe                 amount - stripe_fee
dr expense:processing_fees           stripe_fee
   cr liability:broker_prepaid_balance            amount
```

**Lead purchase (draw-down):**
```
dr liability:broker_prepaid_balance  fee_amount
   cr revenue:lead_fee                             fee_amount
```

Recognition timing: recognize on release if the obligation discharges immediately. If any post-purchase obligation exists, book to `liability:unearned_revenue` first — §18 D-05.

**Screening order (applicant-pay):**
```
dr asset:cash:stripe                 amount - stripe_fee
dr expense:processing_fees           stripe_fee
   cr revenue:screening_passthrough                amount

dr expense:screening_cogs            vendor_cost
   cr asset:cash:operating                         vendor_cost
```

**Rebate accrual on `placement.funded`:**
```
dr expense:screening_rebate          rebate_amount
   cr liability:payable:screening_rebate           rebate_amount
```

**Rebate paid:**
```
dr liability:payable:screening_rebate  rebate_amount
   cr asset:cash:stripe                            rebate_amount
```

**Chargeback:**
```
dr expense:disputes                  disputed + fee
   cr asset:cash:stripe                            disputed + fee
```
Plus a reversing transaction against the original revenue entry via `reverses_txn_id`.

### 11.4 Webhooks and reconciliation

```sql
create table payment_event (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  raw_payload       jsonb not null,
  is_signature_valid boolean not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  process_attempts  int not null default 0,
  process_error     text,
  unique (provider, provider_event_id)
);

create table reconciliation_run (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  matched_count     int not null default 0,
  unmatched_count   int not null default 0,
  amount_mismatch_count int not null default 0,
  status            text not null,
  ran_at            timestamptz not null default now()
);
```

Nightly: pull Stripe balance transactions for the prior day, match to `ledger_transaction` on the Stripe object ID, write a `reconciliation_run`. **Breaks alert and are never auto-resolved.**

**Accountant deliverables** — this is what "easy on our accountants" means concretely: trial balance as of any date, GL detail by account and date range, revenue by vertical/submarket/period, payout register by counterparty, screening COGS by vendor, Stripe-to-ledger reconciliation report. All CSV-exportable from the admin console.

---

## 12. Documents, notifications, audit, config

### 12.1 Documents

```sql
create table document (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid,
  owner_party_id    uuid references party(id),
  doc_type          text not null,
  retention_class   text not null,
  storage_key       text not null,
  content_hash      text not null,
  content_type      text not null,
  size_bytes        bigint not null,
  version           int not null default 1,
  supersedes_id     uuid references document(id),
  scan_status       text not null default 'pending',
  purge_after       date,
  created_at        timestamptz not null default now()
);

create table document_grant (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references document(id),
  grantee_org_id    uuid references org(id),
  grantee_party_id  uuid references party(id),
  permission        text not null check (permission in ('view','download')),
  granted_at        timestamptz not null default now(),
  expires_at        timestamptz,
  revoked_at        timestamptz
);

create table document_access_log (
  id                bigserial primary key,
  document_id       uuid not null,
  actor_party_id    uuid,
  actor_org_id      uuid,
  action            text not null check (action in ('view','download','url_issued')),
  request_id        uuid,
  ip                inet,
  occurred_at       timestamptz not null default now()
);
```

Buckets private always. URLs signed with ≤5 minute TTL, issued per request after policy evaluation — never stored, never emailed. Every issuance logs. Upload: scan → type sniff → EXIF strip → store. Purge job reads `purge_after` and the PII manifest.

E-sign is an adapter (`ESignProvider`) returning a completed-document reference and an audit certificate stored as a `document`.

### 12.2 Notifications (C4 resolved)

**In-platform inbox for parties holding an org role** (landlord, agent, broker, broker_admin, solar_rep, admin). **Email for renters** — they do not live in the product.

```sql
create table notification (
  id                uuid primary key default gen_random_uuid(),
  recipient_party_id uuid not null references party(id),
  channel           text not null check (channel in ('in_platform','email','sms')),
  event_type        text not null,
  template_key      text not null,
  template_version  text not null,
  payload           jsonb not null,
  status            text not null check (status in
                      ('queued','sent','delivered','bounced','failed','read')),
  provider_message_id text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  read_at           timestamptz
);
create index on notification (recipient_party_id, status, created_at desc);

create table notification_preference (
  party_id          uuid not null references party(id),
  event_type        text not null,
  channel           text not null,
  is_enabled        boolean not null default true,
  primary key (party_id, event_type, channel)
);

create table notification_suppression (
  id                uuid primary key default gen_random_uuid(),
  channel           text not null,
  address_hmac      bytea not null,
  reason            text not null check (reason in
                      ('hard_bounce','complaint','unsubscribe','manual')),
  suppressed_at     timestamptz not null default now()
);
```

Email is the identity substrate, so deliverability is core infrastructure: SPF/DKIM/DMARC on a dedicated sending domain, **transactional and marketing on separate subdomains** so a marketing reputation hit never blocks magic links. Bounce and complaint webhooks feed suppression and mark the email invalid — which must gracefully degrade passwordless to SMS rather than dead-ending the applicant.

SMS is built but **not enabled at launch** (B6). The channel enum, preference rows, and adapter exist; the broker lead-offer SLA path is the first candidate for enabling it later.

### 12.3 Audit — two systems

**Domain event log** (the spine):

```sql
create table domain_event (
  id                uuid primary key default gen_random_uuid(),
  seq               bigserial,
  aggregate_type    text not null,
  aggregate_id      uuid not null,
  event_type        text not null,
  event_version     int not null default 1,
  payload           jsonb not null,
  actor_party_id    uuid,
  actor_kind        text check (actor_kind in ('user','system','vendor','admin')),
  request_id        uuid,
  occurred_at       timestamptz not null default now()
);
create index on domain_event (aggregate_type, aggregate_id, seq);
create index on domain_event (event_type, occurred_at);
```

Payloads carry references, never PII values.

**Admin action log** (hardened, tamper-evident, separate write path):

```sql
create table admin_action_log (
  id                      uuid primary key default gen_random_uuid(),
  seq                     bigserial,
  actor_party_id          uuid not null,
  impersonation_session_id uuid references impersonation_session(id),
  dual_approval_request_id uuid references dual_approval_request(id),
  action                  text not null,
  target_type             text,
  target_id               uuid,
  before_state            jsonb,
  after_state             jsonb,
  reason_code             text,
  request_id              uuid,
  ip                      inet,
  user_agent              text,
  occurred_at             timestamptz not null default now(),
  prev_hash               bytea,
  row_hash                bytea not null
);
```

`row_hash = sha256(prev_hash || canonical_json(row_without_hashes))`. A daily verifier walks the chain and alerts on any break. Written by a dedicated role with INSERT only; the application role has no UPDATE or DELETE. This is the tamper-evidence property people reach for blockchain to get — achieved here without consensus overhead or an immutable-data-erasure problem.

Every admin mutation records before/after diff. Every RLS bypass session, every document view, every renter-search filter set records here.

### 12.4 Config

```sql
create table config_version (
  id                    uuid primary key default gen_random_uuid(),
  namespace             text not null,
  version               text not null,
  payload               jsonb not null,
  effective_from        timestamptz not null,
  effective_to          timestamptz,
  proposed_by_party_id  uuid not null,
  approved_by_party_id  uuid,
  approved_at           timestamptz,
  dual_approval_request_id uuid references dual_approval_request(id),
  unique (namespace, version)
);
create index on config_version (namespace, effective_from desc);
```

**No config takes effect without `approved_by_party_id` set.** Resolution is always `(namespace, as_of_timestamp)`. Every consumer snapshots the version onto the record it produces (P4).

Namespaces at launch: `rs_price_book`, `solar_tiers`, `solar_underwriting`, `retention`, `sla`, `scoring_weights`, `fraud_thresholds`, `verification_confidence`, `hold_durations`, `ingestion_thresholds`, `screening_policy`, `scraping_policy`.

---

## 13. Solar vertical

Runs on the shared spine — same `party`, `org`, ledger, documents, audit, config, notifications. Only intake, underwriting, and disbursement are vertical-specific.

### 13.1 Commercial mechanic

RBIT operates as an enterprise seller inside PBC Solar's platform. RBIT earns a share of each deal's net profit pool. PBC Solar handles installer commission payouts and remits RBIT's profit share. RBIT disburses homeowner cashback out of that share.

Reference model parameters (all live in `config_version`, none hardcoded):

| Parameter | Reference value | Namespace |
|---|---|---|
| Installed cost basis | $2.40/watt | `solar_underwriting` |
| Net profit pool | 35% of gross project cost | `solar_underwriting` |
| RBIT share of net profit | 40% | `solar_underwriting` |
| Net-to-RBIT floor | $750 | `solar_underwriting` |

### 13.2 Four-tier cap structure

Replaced an earlier percentage-based model deliberately — dollar caps are more transparent to homeowners.

| Tier | System size | Cashback cap |
|---|---|---|
| 1 | 8–15 kW | $1,250 |
| 2 | 15–25 kW | $2,050 |
| 3 | 25–35 kW | $4,000 |
| 4 | 35–60 kW | $5,000 (adjusted to $4,150 by Equation 2 in the reference model) |

Tier boundaries and caps live in `config_version` namespace `solar_tiers`, effective-dated, dual-approval gated.

### 13.3 Two-equation underwriting engine

Registered in `model_registry` as `model_key = 'solar_underwriting'`, `kind = 'rules'`, and produces a fully explained, reproducible decision record exactly like a renter score (§8.1). Same interface, same reproducibility contract.

**Equation 1 — floor check at full tier cap.**
Compute net-to-RBIT assuming the full tier cap is paid out. If net-to-RBIT ≥ floor ($750), approve at full cap. Done.

**Equation 2 — backward solve for adjusted cap.**
If Equation 1 fails, solve backward for the maximum cashback that still leaves net-to-RBIT at exactly the floor. If the solved cap is below a configured minimum viable cashback, decline the deal rather than approve a token amount.

```sql
create table solar_deal (
  id                      uuid primary key default gen_random_uuid(),
  homeowner_party_id      uuid not null references party(id),
  rep_party_id            uuid references party(id),
  partner_org_id          uuid not null references org(id),
  external_project_ref    text,                    -- PBC Solar platform project id
  address_id              uuid references address(id),
  system_size_kw          numeric(6,2) not null,
  gross_project_cost_cents bigint not null,
  redline_cents           bigint,
  sale_price_cents        bigint not null,
  status                  text not null check (status in
                            ('submitted','underwriting','approved','declined',
                             'installed','partner_paid','homeowner_paid','cancelled')),
  submitted_at            timestamptz not null default now(),
  decided_at              timestamptz,
  installed_at            timestamptz,
  created_at              timestamptz not null default now()
);
create index on solar_deal (status, submitted_at desc);

create table solar_underwriting_decision (
  id                      uuid primary key default gen_random_uuid(),
  solar_deal_id           uuid not null references solar_deal(id),
  engine_version          text not null,
  config_version_id       uuid not null references config_version(id),
  tier                    int not null check (tier between 1 and 4),
  tier_cap_cents          int not null,
  equation_1_passed       boolean not null,
  equation_1_net_to_rbit_cents bigint not null,
  equation_2_applied      boolean not null,
  adjusted_cap_cents      int,
  approved_cashback_cents int not null,
  net_to_rbit_cents       bigint not null,
  decision                text not null check (decision in ('approved','declined')),
  decline_reason          text,
  input_snapshot          jsonb not null,
  explanation             jsonb not null,
  computed_at             timestamptz not null default now()
);
create index on solar_underwriting_decision (solar_deal_id, computed_at desc);
```

**Invariants, enforced by test.** Insert-only — recomputation appends. Replaying `input_snapshot` through `engine_version` and `config_version_id` reproduces `approved_cashback_cents` exactly. `explanation` non-empty, and when `equation_2_applied` is true it must name the binding constraint. A decision without an explanation cannot be displayed to a homeowner or a rep.

### 13.4 Deal lifecycle

```
submitted ──▶ underwriting ──┬──▶ declined ──▶ closed
                             │
                             └──▶ approved ──▶ installed ──▶ partner_paid ──▶ homeowner_paid
                                     │
                                     └──▶ cancelled
```

Underwriting runs synchronously on submit — the homeowner-facing flow targets a decision inside the same session. Everything downstream (install confirmation, partner remittance, homeowner disbursement) is a Temporal workflow because the horizon is weeks to months.

### 13.5 Money flow and ledger

**Approval — accrue the obligation:**
```
dr asset:receivable:pbc_solar        expected_profit_share
   cr revenue:profit_share                        expected_profit_share

dr expense:solar_cashback            approved_cashback
   cr liability:payable:solar_homeowner           approved_cashback
```

**PBC Solar remits:**
```
dr asset:cash:operating              received_amount
   cr asset:receivable:pbc_solar                  received_amount
```
Variance between expected and received writes a `reconciliation_run` break — never silently absorbed.

**Homeowner disbursed:**
```
dr liability:payable:solar_homeowner  cashback_amount
   cr asset:cash:stripe                           cashback_amount
```

**Disbursement is gated on `partner_paid`.** RBIT does not pay homeowner cashback out of float before the corresponding profit share lands. Enforced as a state precondition, asserted by test.

```sql
create table solar_partner_remittance (
  id                    uuid primary key default gen_random_uuid(),
  partner_org_id        uuid not null references org(id),
  period_start          date not null,
  period_end            date not null,
  expected_amount_cents bigint not null,
  received_amount_cents bigint,
  received_at           timestamptz,
  variance_cents        bigint,
  status                text not null check (status in
                          ('expected','received','variance','disputed')),
  statement_document_id uuid references document(id)
);

create table solar_deal_remittance (
  solar_deal_id     uuid not null references solar_deal(id),
  remittance_id     uuid not null references solar_partner_remittance(id),
  amount_cents      bigint not null,
  primary key (solar_deal_id, remittance_id)
);
```

### 13.6 Homeowner payout rail

Shares the renter rebate rail (§7.8) — same Stripe payout destination collection, same "collect payout details at payout time, not intake" rule. One implementation, two consumers.

---

## 14. Search, SEO support, and public surfaces

Presentation lives in the frontend spec. These are the backend obligations.

### 14.1 Listing search

Postgres + PostGIS. No dedicated search infrastructure at launch — revisit past ~100k active listings.

Endpoints: faceted list query (submarket, bed band, rent band, pets, available-by) and a **bbox query for map view**, built from the start so the map toggle is not a later rewrite. Clustering computed server-side at low zoom.

### 14.2 Search event capture

```sql
create table search_event (
  id                bigserial,
  occurred_at       timestamptz not null default now(),
  session_id        uuid,
  party_id          uuid,
  submarket_id      uuid,
  h3_r8             text,
  bedrooms_min      numeric(3,1),
  bedrooms_max      numeric(3,1),
  rent_min_cents    int,
  rent_max_cents    int,
  filters           jsonb,
  result_count      int not null,
  clicked_listing_ids uuid[],
  primary key (id, occurred_at)
) partition by range (occurred_at);
```

**Never on the transactional write path.** Async buffer → bulk `COPY` into the monthly partition. Nightly rollup to `search_demand_daily (submarket_id, bed_band, rent_band, date) → searches, zero_results, clicks`. Hot 90 days, then Parquet to S3.

**Never sample zero-result searches.** Unmet demand is the rarest and most valuable signal, and it is invisible if only conversions are logged.

### 14.3 SEO backend obligations

- **Sitemap generation** from live active listings plus programmatic landing pages (submarket × bedrooms × rent band), regenerated on a schedule, chunked under per-file limits.
- **Structured data payloads** (`RealEstateListing`) served as part of the listing detail API so the frontend renders them without re-deriving.
- **Expired listing policy** — a real ranking liability if handled wrong. Rules: expired listing URL returns `410 Gone` if the unit is gone entirely; `301` to the canonical unit or submarket page if a successor listing exists; `noindex` while `stale`. The decision is computed server-side and returned in the API response, not guessed by the frontend.
- **Canonical URL** for every listing, stable across re-listings of the same unit.

---

## 15. Analytics and warehouse (C5 resolved)

No separate warehouse product at launch. Aurora read replica → nightly dbt ETL → star-schema summary tables in a dedicated `reporting` schema on the same cluster. Cheap, no new vendor, directly serves accountant exports and admin dashboards.

Revisit ClickHouse only past ~10M search events/month.

**Core marts:** `fct_application`, `fct_placement`, `fct_lead`, `fct_solar_deal`, `fct_ledger_entry`, `dim_party_features`, `dim_submarket`, `dim_listing`, `agg_search_demand_daily`, `agg_supply_daily`, `agg_label_coverage`.

**Required dashboards:** funnel by stage and submarket, supply/demand ratio by submarket, days-on-market, broker close and leakage rates, screening COGS and rebate liability, **label coverage by horizon**, ingestion health by source, solar deal pipeline and remittance variance.

Admin console reads exclusively from `reporting` schema and the replica (P9), except targeted single-record support lookups.

---

## 16. Environments, migrations, resilience

### 16.1 Environments (D1)

Three AWS accounts: `rbit-dev`, `rbit-staging`, `rbit-prod`. Terraform, no console-created production resources. Vendor sandbox credentials per environment — Certn, Plaid, Stripe test mode, ingestion partner sandboxes. Seeded fixture data covering every state machine terminal state.

Non-prod Aurora runs `min_capacity = 0` for auto-pause. Non-prod Fargate scheduled off outside working hours.

### 16.2 Migration safety (D2)

**Expand/contract discipline, mandatory.** Never drop or rename a column in the same deploy that stops writing it. Sequence: expand (add nullable) → backfill → dual-write → cut reads over → stop writes → contract (drop) in a later deploy.

CI gates: reject migrations acquiring `ACCESS EXCLUSIVE` on a large table without an explicit annotated override; reject same-deploy column drops; reject a new table without `org_id` + RLS or allowlist entry; reject a new PII column without a `pii-manifest.yaml` entry.

### 16.3 Backup and recovery (D3)

Aurora PITR enabled, 14-day window minimum in prod. Automated daily snapshots retained 35 days. Cross-region snapshot copy for prod.

**Restore drills are scheduled and evidenced, not assumed.** Quarterly: restore prod snapshot to an isolated environment, run the full test suite against it, record RTO achieved. A backup that has never been restored is not a backup. Given the prior OneDrive incident, this is a standing requirement with a named owner, not a checkbox.

Documented targets: RPO ≤ 5 minutes (PITR), RTO ≤ 4 hours.

S3 versioning plus MFA delete on document buckets. Object Lock on the ledger export bucket.

### 16.4 Load sizing (D4)

Anchor: 35,641 leases in Year 1 at maturity ≈ ~100 placements/day steady state. Initial sizing targets a single-metro pilot: low thousands of MAU, low hundreds of DAU.

Aurora min 0.5 ACU prod with autoscale headroom; Fargate min 1 task, target-tracking to a defined ceiling. Revisit sizing when sustained ACU utilization exceeds 60% or p95 API latency degrades.

### 16.5 CI gates (consolidated)

| Gate | Fails on |
|---|---|
| Tenancy | Table lacking `org_id` + RLS policy and not allowlisted |
| PII manifest | New column on a PII-bearing table without manifest entry |
| PII logging | Synthetic PII request produces any PII value in log output |
| Migration safety | Blocking lock or same-deploy drop without override |
| Ledger immutability | Application role retains UPDATE/DELETE on ledger tables |
| Score reproducibility | Fixture replay diverges from recorded score |
| Feature leakage | Poisoned fixture passes the training pipeline |
| API schema drift | Committed OpenAPI differs from generated |
| Event emission | State transition in fixture run produces no domain event |

---

## 17. Build plan

Ordering rationale: spine and label pipeline first, scoring last. You cannot train on data you did not record — every month of placements without outcome capture is a permanently lost month of training data.

### Phase 0 — Foundation (blocking, nothing else starts)

**Modules:** repo/module structure + boundary lint · migration framework · `org`/`party`/`party_role`/`party_features` · KMS + DEK + crypto-shred · RLS everywhere + CI gate · PII manifest + log redaction + CI gate · `domain_event` + `admin_action_log` with hash chain · `permission`/`role_permission`/`dual_approval_request` · `config_version` · structured logging, tracing, error tracking · Terraform for three AWS accounts · CI pipeline with all §16.5 gates.

**Acceptance criteria:**
- [ ] `psql` output showing RLS enabled and a policy present on every non-allowlisted table
- [ ] CI log showing the tenancy gate failing on a deliberately unscoped table, then passing
- [ ] Synthetic PII request produces log output containing zero PII values
- [ ] Crypto-shred: create party → write identity → destroy DEK → identity unreadable, `party_features` intact, ledger/audit FKs valid
- [ ] Hash-chain verifier passes on 1,000 seeded rows, fails on one manually tampered row
- [ ] Dual approval: requester cannot approve own request; super admin bypasses; both asserted
- [ ] `domain_event` emitted for every state transition in a seeded fixture run
- [ ] Terraform applies cleanly to all three accounts from a clean state

### Phase 1 — Identity, geo, supply, profiles, matching, outcomes

**Modules:** passwordless auth + session + elevation · impersonation · org claim · address normalization + geo keys · `property`/`unit`/`listing` + lifecycle jobs · media pipeline · minimal ingest (`manual` + `csv_upload` through the §6A.3 pipeline) · `renter_profile` · `application` state machine · `landlord_interest` · `landlord_decision` · `placement` + unique indexes + Temporal hold expiry · queue + auto-promotion · **`placement_outcome` scheduling and single-tap capture** · notifications infrastructure · renter discoverability search with filter allowlist.

Manual and CSV go through the ingestion pipeline from day one — resolve, merge, provenance — even though connectors land in Phase 4. This prevents a divergent code path for "real" listings later.

**Acceptance criteria:**
- [ ] Concurrency: 50 parallel accepts on one unit → exactly 1 placement, 49 clean typed rejections
- [ ] Hold expiry: lapse → unit frees → queue head promoted → events emitted
- [ ] Address fixtures: `123 Main St Apt 2` / `123 Main Street #2` / `123 MAIN ST UNIT 2` → one `unit_id`
- [ ] Listing lifecycle: active → stale at 14d → expired at 21d, via clock manipulation
- [ ] Manual listing produces `source_listing` + merged `listing` + populated provenance; no bypass path exists
- [ ] CSV import of 500 rows: resolution counts reported, ambiguous routed to queue, zero silent drops
- [ ] Placement signed → four `placement_outcome` rows with correct scheduled dates
- [ ] Outcome capture: single-tap email link records a response without a login session
- [ ] Passwordless: single-use token, 15-min expiry, enumeration-resistant, rate limits enforced
- [ ] Renter search rejects any filter key outside the allowlist at the API boundary, with an explicit error
- [ ] Renter search response at `minimal` discoverability contains zero identity fields, asserted across the full serializer
- [ ] Every executed renter search persists its filter set to `admin_action_log`

### Phase 2 — Screening, Certn, vendors, async orchestration

**Modules:** vendor adapter interfaces (`IdentityVerification`, `IncomeVerification`, `TenantScreening`, `ESign`) + stubs · vendor request/response archival with cost attribution · Temporal deployment + screening saga · SQS worker tier · prescreen rules engine · `screening_package` config · `screening_order` + `payer_kind` · per-product `screening_report` + access grants · verification badge computation · Risk Insight adverse action gate · `income_verification` hierarchy · vault integration for SSN tokenization · Certn webhook ingestion · `screening_rebate` accrual workflow · fraud signal stack + review queue.

**Acceptance criteria:**
- [ ] Full application pipeline runs end-to-end against vendor stubs, zero network, in CI
- [ ] Vendor swap: two `TenantScreening` implementations; switching is config-only, no call-site change
- [ ] Schema scan: no SSN or government-ID column exists anywhere; no such value in any archived request payload
- [ ] Idempotency: same Certn webhook delivered 100× → one state transition, one ledger effect
- [ ] Out-of-order: terminal event before intermediate → correct final state
- [ ] Partial completion: credit complete + criminal pending → application does NOT advance to `screened`
- [ ] Badge transitions: identity + income complete → `prechecked`; full package → `fully_screened`
- [ ] Risk Insight gate: decline driven by Risk Insight routes to review queue, does not auto-reject, while flag is false
- [ ] `payer_kind` exercised for all four values without pricing-logic branching at call sites
- [ ] Cost attribution: per-application screening COGS queryable by vendor and date
- [ ] Report portability: one report granted to three orgs in-window; fourth post-expiry triggers re-pull
- [ ] Rebate: fires on `placement.funded`, not `lease_signed`; second application on same order produces no second rebate

### Phase 3 — Brokerage, leads, payments, ledger

**Modules:** broker profile/coverage/performance · license eligibility gate · credit tiers · `broker_balance` + funding + draw-down · RS tier classifier + seeded price book · `lead` + `lead_offer` + Temporal SLA timers + re-offer · assignment engine · `lead_purchase_evidence` · Stripe integration · `payment_event` ingestion · full ledger + balance trigger + immutability grants · reconciliation job · accountant exports.

**Acceptance criteria:**
- [ ] Unbalanced transaction rejected by the deferred trigger
- [ ] Application role `UPDATE`/`DELETE` on ledger tables denied
- [ ] Tier snapshot: change price book after lead creation → lead retains original tier, version, fee; charge matches persisted fee
- [ ] Balance draw-down: concurrent purchases cannot drive `balance_cents` negative
- [ ] Charge/release ordering: simulated payment failure → lead data NOT released; post-charge crash → reconciler resolves orphan
- [ ] License gate: never offered to expired/unverified org, asserted over randomized fixtures
- [ ] Reconciliation: seeded Stripe fixture with injected discrepancy → break detected and alerted, not auto-resolved
- [ ] Displayed fee == persisted `fee_amount_cents` == Stripe charge amount
- [ ] `lead_purchase_evidence` populated at release with session, IP, ToS version, exact released payload
- [ ] Price book cannot go effective in prod without `config.approve` dual approval — asserted
- [ ] Trial balance and GL detail exports produce correct totals against seeded data

### Phase 4 — Ingestion and partner connectors

Supply acquisition. Every prior phase is capped by manually entered inventory.

**Modules:** full `ListingSourceAdapter` framework · source/sync_run/raw_record/source_listing/mapping_profile/display_rule · transform + rejection logging · resolution engine + ambiguous queue · merge + precedence + provenance + conflict · delist detection (delta + Temporal full reconcile) · quality gates and quarantine · media policies · credential vault + OAuth refresh + rotation · rate limiting, backoff, circuit breaker · push webhook · onboarding UI backend (test → preview → dry run → activate) · per-source observability · display-rule serializer · org claim integration.

**Adapter build order** — by supply per unit of effort:
1. `generic_rss` / `zillow_feed_xml` / `listhub_xml` — many partners already publish one
2. `push_webhook`
3. PM systems (`appfolio`, `buildium`, `rentmanager`)
4. One RESO aggregator (per D-12)
5. `reso_web_api` direct, only where an aggregator misses a target market
6. `rets` — only if a launch market forces it

**Acceptance criteria:**
- [ ] Adapter conformance suite: every adapter passes one shared suite against recorded fixtures, no live network in CI
- [ ] Replay: change mapping version → re-transform historical `raw_record` → corrected output, zero partner API calls
- [ ] Idempotency: same feed fetched 10× → one `source_listing`, correct `records_unchanged`, no listing churn events
- [ ] Resolution: same unit from three adapters → one `unit_id`; supply metrics count once
- [ ] Merge precedence: landlord-direct rent overrides feed rent; provenance identifies winner
- [ ] Conflict: >10% rent disagreement writes `unit_source_conflict`, holds prior value, does not auto-resolve
- [ ] Delist: absent from full reconcile → `absent_since` → delisted after grace → listing expires when no source remains
- [ ] Quarantine: run dropping 80% of inventory quarantined and NOT applied; alert fires; override requires dual approval
- [ ] Currency-scale guard: dollars-where-cents-expected fixture caught by median-shift gate
- [ ] Building-level record (one row, 40 units) routes to ambiguous queue, no phantom unit
- [ ] Push: valid HMAC accepted; stale timestamp rejected; replayed nonce rejected; malformed body → rejection log with reason
- [ ] Credential rotation during dual-credential window: zero failed syncs
- [ ] Dry run writes zero rows to `listing`/`property`/`unit`/`address`, verified by before/after row counts
- [ ] Display rules: source with `show_exact_address = false` and a suppressed field never leaks either through any API response
- [ ] Credentials absent from all logs, traces, and `sync_run.error_detail`
- [ ] Org claim: ingestion-created unclaimed org can be claimed without creating a duplicate org

### Phase 5 — Documents, admin console, warehouse, SEO support

**Modules:** document store + grants + signed URLs + access log + purge · e-sign adapter · dbt ETL to `reporting` schema · admin console backend (read-model only) · supply/demand dashboards · label coverage dashboard · sitemap generation · structured data payloads · expired listing policy · public API rate limiting and bot protection.

**Acceptance criteria:**
- [ ] Signed URL expires ≤5 min; direct bucket access denied; every issuance logged
- [ ] Purge job removes expired documents from S3, retains tombstone, ledger references intact
- [ ] Zero-result searches visible in rollup by submarket, bed band, rent band
- [ ] Admin console issues zero queries against the transactional primary except targeted single-record lookups, verified via query log
- [ ] Label coverage metric live, reporting actual 30/90-day response rates
- [ ] Expired listing returns correct 410/301/noindex per policy, asserted per case
- [ ] Rate limiting: unauthenticated burst throttled; `allow_indexed_crawlers` toggle respected

### Phase 6 — Solar vertical

**Modules:** solar party roles and org kinds · `solar_deal` intake · two-equation engine registered in `model_registry` · `solar_underwriting_decision` · tier config · PBC remittance ingestion + variance detection · profit-share receivable and homeowner disbursement ledger flows · shared payout rail with rebate.

**Acceptance criteria:**
- [ ] Reproducibility: replaying `input_snapshot` through recorded engine + config version reproduces exact `approved_cashback_cents`
- [ ] Equation 2 path exercised; `explanation` names the binding constraint
- [ ] Reference case: Tier 4 deal producing the $5,000 → $4,150 adjustment reproduces exactly
- [ ] Decline path: solved cap below minimum viable → declined, not approved at token amount
- [ ] Disbursement gated: attempt to pay homeowner before `partner_paid` is rejected
- [ ] Remittance variance writes a reconciliation break, not a silent absorption
- [ ] Solar and dwel share one `party`, one ledger, one document store, one audit log — verified by schema inspection, zero duplicated tables

### Phase 7 — Scoring v1

**Gate:** ≥6 months of placements with ≥60% label coverage at the 90-day horizon. If unmet, this phase does not start and rules v0 continues. Shipping a model trained on a biased 25% sample is worse than shipping no model.

**Modules:** training pipeline with point-in-time correctness · offline eval harness · shadow scoring · drift monitors · activation via config.

**Acceptance criteria:**
- [ ] Leakage test: poisoned fixture fails the pipeline
- [ ] Offline/online parity: identical features via both paths across 1,000 fixtures
- [ ] 30-day shadow run with distribution comparison against v0 before activation
- [ ] Any historical score recomputable from its `feature_snapshot` and `model_version`

---

## 18. Open decisions register

**BLOCKED. Do not resolve in code. Escalate before implementing any dependent task.**

| ID | Decision | Blocks | Owner |
|---|---|---|---|
| **D-01** | Identity retention TTL duration per data class | §3.4 purge job config | Jacob |
| **D-02** | Screening report portability window and re-pull triggers | §7.4 | Jacob / Certn terms |
| **D-03** | Broker-of-record licensing coverage by state | §10.1 eligibility gate; determines launch markets | Jacob / Addison |
| **D-05** | Lead fee revenue recognition timing — immediate on release, or deferred against a post-purchase obligation | §11.3 | Dariel |
| **D-11** | Per-source display rule content — attribution, field suppression, address display, media policy, post-delist purge, refresh requirements. **Enforcement layer is unblocked and builds now**; only rule content per partner is gated. | §6A.2 rule population; Phase 4 per-source activation | Jacob / Addison |
| **D-12** | RESO aggregator selection (MLS Grid / Trestle / Bridge / Spark) vs. direct per-MLS | §6A.1, Phase 4 adapter order item 4 | Michael |
| **D-13** | Renter discoverability filter allowlist — final field set for landlord-facing renter search. **Enforcement mechanism is unblocked**; only the allowlist content is gated. | §9.4 | Jacob |
| **D-14** | PII tokenization vault vendor (Skyflow vs. Basis Theory) — deterministic token support is the gating capability | §3.3 Path B, Phase 2 | Michael |
| **D-15** | Risk Insight coverage and match accuracy (pending Klaus) — determines whether `risk_insight_auto_adverse_action_enabled` can ever go true | §7.5 | Addison → Klaus → Jacob |
| **D-16** | Plaid MSA execution and go-live date — determines whether Phase 2 ships with Plaid income verification or a fallback path | Phase 2 §7.6 | Michael / Addison |

**Resolved since v1.1:** D-04 (cashback — tenant discount is paid broker-side, off RBIT's ledger; only the screening rebate requires a renter payout rail), D-06 (Certn), D-07 (Temporal), D-08 (AWS + Aurora Serverless v2), C1–C5, D1–D4.

---

## 19. Deliberately excluded from v1

Recorded so they are not rediscovered as gaps.

- **Dedicated search infrastructure.** Postgres + PostGIS suffices at projected volume. Revisit past ~100k active listings.
- **Microservice extraction.** See P1.
- **Real-time renter↔landlord messaging.** Moderation, retention, and dispute surface disproportionate to v1 value. Communication routes through the broker.
- **Native mobile apps.** Mobile web first; the renter flow must never require an install.
- **Rent payment portal.** Materially different regulatory and architectural surface. Separate spec if pursued.
- **SMS at launch.** Channel, preferences, and adapter are built; not enabled. Broker lead-offer SLA is the first candidate.
- **Website scraping of partner sites.** Fragile and requires written authorization per site. Feed, API, and push connectors cover the same ground durably.
- **Bidirectional ingestion sync.** Read-only in v1; RBIT does not write listing status back to partner systems.
- **Multi-currency.** `currency` columns exist for schema stability; USD only.
- **Multi-region AWS.** Single region until latency or residency requirements justify otherwise. Market coverage is an ingestion and licensing concept, not an infrastructure one.

---

*End of backend specification. Frontend contract: generated OpenAPI client, §3.8.*