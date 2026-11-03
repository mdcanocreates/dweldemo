# Dwel Platform Consolidation Audit

**Date:** 2026-11-02  
**Scope:** Housing Authority Lite, Dwel Together, Roommate Match, migration reconciliation through 0078, marketplace release blockers  
**Marketplace tip (untouched):** `feature/dwel-next-phase-slice-a` @ `0b2521dfbe20e5b95703e289c13b5a91267f3a16`  
**Authority tip (verified):** `feature/dwel-authority-lite` @ `b1f58f8b624fabc0bb7647e66ba2f452a3350bcc` (**not** `964bcc1`)  
**Production action:** none (no deploy, live email, live Stripe, or Aurora apply)

---

## 1. Branch and worktree inventory

Shared Dwel git family (`apps/dwel/.git` worktrees) → remote `https://github.com/mdcanocreates/dweldemo.git`

| Worktree | Branch | HEAD | Dirty | On origin? |
| --- | --- | --- | --- | --- |
| `apps/dwel-partner-rc` | `feature/dwel-next-phase-slice-a` | `0b2521d` | Yes (unstaged Stripe/lifecycle; leave unstaged) | No (preserve) |
| `apps/dwel-authority-lite` | `feature/dwel-authority-lite` | `b1f58f8` | Clean | No (preserve) |
| `apps/dwel-prod-rc` | `release/dwel-prod-rc` | `2c1feed` | Minor (`.env.example`) | No |
| `apps/dwel-auth-rc` | `release/dwel-auth-otp-rc` | `6a93723` | Clean | No |
| `apps/dwel-staging-continue` | `release/dwel-consolidation` | `3489f31` | Untracked gate logs only | No |
| `apps/dwel` | `deploy/netlify-dwel-demo` | `83b9908` | Heavily dirty / untracked | Yes (`main` + `deploy/netlify-dwel-demo`) |

Other repos:

| Path | Branch | HEAD | Remote notes |
| --- | --- | --- | --- |
| `apps/dweldemo-clean` | `deploy/netlify-dwel-demo` | `6377ab0` | Same `dweldemo` origin |
| `apps/admin` | `release/admin-auth-session-rc` | `55190fb` | Separate admin repo |
| `apps/lumis` | `release/lumis-auth-otp-rc` | `fef455f` | Separate Lumis repo |
| `apps/dwel-netlify-verify` | n/a | n/a | Not a git root |

**Origin heads before preservation (only 3):** `main`, `deploy/netlify-dwel-demo` (@ `83b9908`), `release/dwel-partner-intake` (@ `7bd91a0`).

**Authority reference check:** `964bcc1` exists and is an ancestor; tip is **3 commits ahead** (`48d7e96`, `d771f9e`, `b1f58f8`). Matrix doc dated 2026-10-29 is stale vs tip.

**Common ancestor** of marketplace and authority: `15e9cbc` (formal application vs interest split). Divergent after that (~13 marketplace commits vs 6 authority commits).

---

## 2. Completed-versus-missing feature matrix

### Marketplace (partner-rc / Slice A–D local)

| Capability | State | Notes |
| --- | --- | --- |
| Footer + legal draft routes | Implemented (local) | `LEGAL_APPROVED.*=false` |
| Full-bleed Map workspace | Implemented (local) | Flags off by default; license gate open |
| Demo inventory flag / hide | Implemented (local) | `listing.is_demo`; do **not** hide in production until replacement inventory approved |
| External quarantine import | Implemented (local) | B0 dry-run; **0 rights-approved** publishable rows |
| Verified offer badges | Implemented (local) | No invented interim cashback % |
| Save ≠ lead; consented inquiry | Implemented (local) | Mock email only |
| Provider claim + test entitlement | Implemented (local) | Configured price; live charge blocked |
| Saved-home savings eligibility | Implemented (local) | Known fees vs estimate state |
| Production `/listings` | **Blocked** | 403 / CloudFront |
| Aurora 0073–0078 | **Not applied** | Local disposable only |

### Housing Authority Lite (authority-lite only)

| Capability | State | Notes |
| --- | --- | --- |
| Feature flag `DWEL_AUTHORITY_LITE` | Implemented | Default off → `/v1/authority` 404 |
| Sandbox agency create | Implemented | Also needs `DWEL_AUTHORITY_SANDBOX=1`, non-production |
| Agency tenant, invite, roles, RLS | Implemented | owner/supervisor/caseworker/navigator/inspection_coordinator |
| Housing case ↔ `party` | Implemented | Optional `dwel_party_id` |
| Assistance indicator + private verification | Implemented | App role cannot SELECT verification source |
| RFTA-lite packet API | Implemented | No packet editor UI |
| Inspections (no pass/fail) | Implemented | Rejects pass/fail recording |
| Tasks, appointments, audit, lease-up report | Implemented | Small-cell suppression |
| Documents quarantine | Partial | Bytes in Postgres; scanner token double, not real malware/S3 |
| MFA (native TOTP) | Implemented | Required for ack/verify/lease-up |
| Agency SSO / OIDC | **Missing** | Browser test skipped |
| Voucher / HAP / subsidy ledger | **Out of scope** | Explicitly not built |
| Aurora 0074/0075 (authority) | **Not applied** | |
| Pilot / a11y / retention | **Missing** | |

### Dwel Together

| Capability | State |
| --- | --- |
| Shared property collections | **Not implemented** (specs only / Slice E) |
| Household invitations | **Not implemented** |
| Multi-applicant household applications | **Not implemented** |
| Per-member private dossiers under household | **Not implemented** |
| Feature flag | **Not reserved in code** (propose `DWEL_TOGETHER=1`) |

Near-misses that are **not** Together: `household_size`, per-party `saved_listing`, Authority case share.

### Roommate Match

| Capability | State |
| --- | --- |
| Opt-in roommate discovery | **Not implemented** |
| Explicit compatibility preferences | **Not implemented** |
| Mutual consent before exposure | **Not implemented** |
| Feature flag | **Not reserved in code** (propose `DWEL_ROOMMATE_MATCH=1`) |

Near-miss that is **not** Match: landlord `is_discoverable` / `searchDiscoverableRenters`.

---

## 3. Migration conflict report

### Shared safe base (authority ↔ partner)

| # | Content | Collision? |
| --- | --- | --- |
| 0070 `partner_intake` | Text-equal (EOL differ) | No semantic conflict |
| 0071 Stripe sandbox | Byte-identical | No |
| 0072 Application visibility | Byte-identical | No |
| 0073 `record_kind` | Text-equal (EOL differ) | No |

### Hard number collisions

| # | Authority Lite | Partner marketplace | Table overlap? |
| --- | --- | --- | --- |
| **0074** | `authority_lite` (`authority_*`) | `saved_listing_read` (policies) | **None** |
| **0075** | `authority_completion` | `property_authority_and_broker_assignment` | **None** (name trap: `property_authority` ≠ Housing Authority) |
| 0076–0078 | (absent) | quarantine / demo+offers / interest+claim+access | Partner-only |

### Additional numbering fork (`apps/dwel` main)

- Main uses `0069_fcra_…` then `0070_email_…`
- Auth-rc / partner / authority use `0069_email_…` then `0070_partner_intake…`
- FCRA migration is **absent** on partner and authority tips

### Preserve always

`application` (+ `record_kind`), dossiers/intake snapshots, `screening_consent`, ledger/payment tables, `permission` / role maps, partner `0078` interest/access tables, all `authority_*` once renumbered.

### Recommended unified sequence

```text
…0068
0069_email_code_and_session_secret
0070–0073   shared partner/authority
0074_saved_listing_read                 (partner)
0075_property_authority_and_broker…     (partner)
0076_external_listing_quarantine        (partner)
0077_listing_demo_inventory_and_offers  (partner)
0078_renter_interest_claim_and_access   (partner)
0079_authority_lite                     (renumber from authority 0074)
0080_authority_completion               (renumber from authority 0075)
0081_fcra_…                             (re-home from main 0069 if still required)
0082+                                   Together / Match (future, flagged)
```

If any disposable DB already applied authority as 0074/0075, do not rewrite history there; use forward bridge/`IF NOT EXISTS` on unify, or rebuild disposable DBs only.

---

## 4. Proposed unified architecture

```text
                    ┌─────────────────────────────────────┐
                    │         Shared spine (existing)      │
                    │  party · session · listing · app ·   │
                    │  consent · ledger · Stripe sandbox   │
                    └───────────────┬─────────────────────┘
                                    │
     ┌──────────────────────────────┼──────────────────────────────┐
     │                              │                              │
┌────▼─────┐                 ┌──────▼──────┐                ┌──────▼──────┐
│Marketplace│                 │Authority Lite│                │ Together /  │
│ partner   │                 │  DWEL_       │                │ Match       │
│ listings  │                 │  AUTHORITY_  │                │ (future)    │
│ offers    │                 │  LITE=1      │                │ separate    │
│ inquiry   │                 │              │                │ flags       │
│ claim     │                 │ agency_*     │                │             │
│ access    │                 │ case share   │                │ household_* │
└────┬─────┘                 │ ≠ Together   │                │ roommate_*  │
     │                       └──────┬──────┘                └──────┬──────┘
     │                              │                              │
     └──────────────┬───────────────┴──────────────┬───────────────┘
                    │   Tenant / role isolation     │
                    │   RLS + app-layer party scope │
                    └──────────────────────────────┘
```

**Integration rules**

1. Marketplace remains the public catalog path; Authority never mutates listing economics or invents inventory.
2. Authority leads may reference `listing.id` / `provider_party_id` but strip assistance fields from provider payloads (already coded).
3. Together uses new household tables; never overload `saved_listing` or landlord `is_discoverable`.
4. Roommate Match is opt-in only; never join Authority verification or screening PII into match features.
5. Brokers stay on existing brokerage + `property_broker_assignment`; no Authority-specific broker product.

**Future search event schemas (telemetry readiness only — no ranking shipped)**

| Event | Payload (non-PII / consent-gated) | Forbidden |
| --- | --- | --- |
| `search.query_submitted` | `query_id`, coarse geo, beds, rent band, timestamp | protected-class signals, assistance status |
| `search.result_impressed` | `query_id`, `listing_id`, rank_position, origin | scoring model that uses voucher/case data |
| `listing.saved` | `party_id` hash, `listing_id`, savings_state | auto-lead side effects |
| `household.collection_updated` | `household_id`, listing ids (Together only) | Authority case ids |
| `roommate.profile_updated` | preference keys only when Match flag on | inferred traits, screening scores |

No unapproved AI ranking and no discriminatory housing decisioning in v1.

---

## 5. Security and authorization findings

| Finding | Severity | Detail |
| --- | --- | --- |
| Authority verification isolation | Good | Private table + security-definer; app role SELECT denied |
| MFA on sensitive Authority actions | Good (app-enforced) | Not enforced inside all DB functions; session party must stay trusted |
| Cross-agency case isolation | Good | RLS + integration coverage |
| Provider lead PII before claim/pay | Guarded on marketplace path | Mock notify; claim + entitlement required |
| Scanner / document quarantine | Weak for prod | Shared token; Postgres bytes; no independent malware engine |
| SSO | Gap | Institutional IdP not started |
| Migration number collision | Merge risk | Wrong 0074/0075 would apply wrong schema |
| Semantic traps | Medium | `property_authority` vs Housing Authority; `is_discoverable` vs Roommate Match; `household_size` vs Together |
| Dirty partner working tree | Process | Unrelated Stripe/lifecycle edits must not ship with marketplace tip |
| Demo hide vs cutover | Product/legal | Public hide only after approved replacement inventory |
| Origin branch loss risk | High | Feature tips were local-only before preservation push |

Secret heuristic on Authority and marketplace **committed** trees: only placeholders / prefix checks (`sk_live_example`, test doubles). No live Stripe/Checkr/GitHub tokens found in tracked files.

---

## 6. Ordered integration and merge strategy

1. **Freeze marketplace tip** `0b2521d` — no overwrite of 0076–0078; leave dirty Stripe files unstaged.
2. **Preserve branches on origin** (feature tips + key release tips) without merging.
3. **Do not merge Authority into marketplace** until migrations renumbered to 0079/0080 on a dedicated integrate branch.
4. **Integrate branch recipe** (future, gated):
   - Branch from `feature/dwel-next-phase-slice-a`
   - Cherry-pick or merge `feature/dwel-authority-lite` with migration renames first
   - Keep `DWEL_AUTHORITY_LITE` default off
   - Run authority unit/integration/browser + marketplace demo/inquiry/property-listing suites
5. **Together / Match**: greenfield on separate feature branches after marketplace cutover plan is stable; start with flags + schema only; no production ranking.
6. **FCRA re-home** from main’s `0069` if still required, as `0081+`.
7. **Production**: only after marketplace blockers clear; Authority/Together/Match remain flagged off.

---

## 7. Clean GitHub preservation status

| Branch | Intended action | Notes |
| --- | --- | --- |
| `feature/dwel-next-phase-slice-a` | Push tip `0b2521d` | Marketplace intact |
| `feature/dwel-authority-lite` | Push tip `b1f58f8` | Correct tip beyond stale `964bcc1` |
| `release/dwel-auth-otp-rc` | Push tip `6a93723` | Clean |
| `release/dwel-consolidation` | Push tip `3489f31` | Clean tip |
| `release/dwel-prod-rc` | Push tip `2c1feed` | Tip only; dirty `.env.example` not committed |
| Together / Match branches | **N/A** | No code to preserve |
| Merge to `main` / deploy | **Forbidden** this pass | |

---

## 8. Tests and GO / NO-GO

### Known local evidence (prior passes; not re-run as production proof)

| Suite | Location | Prior result |
| --- | --- | --- |
| Authority unit / integration / security / browser | authority-lite | PASS (SSO skipped) |
| Marketplace offers/demo/savings/quarantine unit | partner-rc | 16 PASS |
| Demo/inquiry integration | partner-rc | 2 PASS |
| Property-listing browser | partner-rc | 1 PASS |
| migration-safety / pii / boundaries | partner-rc | PASS |

### Marketplace production blockers (unchanged)

- `/listings` 403
- Aurora missing 0073–0078 (partner numbering)
- External listing rights not approved
- Map license / tiles not enabled
- Live leasing email + live Stripe disabled by design
- `LEGAL_APPROVED.*` false
- Demo public hide deferred until replacement inventory approved

### Module GO / NO-GO

| Module | Local eng | Merge to marketplace | Production |
| --- | --- | --- | --- |
| Marketplace next-phase | **GO** (local) | n/a (is the branch) | **NO-GO** |
| Authority Lite | **GO** (local, flagged) | **NO-GO** until 0079/0080 renumber + integrate tests | **NO-GO** |
| Dwel Together | **N/A** (missing) | **NO-GO** | **NO-GO** |
| Roommate Match | **N/A** (missing) | **NO-GO** | **NO-GO** |
| Unified platform release | — | — | **NO-GO** |

---

## Low-risk actions taken this pass

- Audit only; **no** marketplace 0076–0078 rewrite
- **No** Together/Match feature implementation
- **No** production / Aurora / live email / live charge
- Documentation of reserved flags: `DWEL_AUTHORITY_LITE`, `DWEL_AUTHORITY_SANDBOX`, proposed `DWEL_TOGETHER`, `DWEL_ROOMMATE_MATCH`
- Branch preservation pushes recorded in the session report after secret heuristic
