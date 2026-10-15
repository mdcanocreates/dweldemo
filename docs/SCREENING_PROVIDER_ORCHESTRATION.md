# Screening Provider Orchestration (Certn + Checkr Tenant)

## Summary

Dwel uses one provider-agnostic screening orchestration layer. Application workflows never hardcode Certn or Checkr. Adapters implement a shared `ScreeningProvider` contract. Admin selects the default provider for **new** orders; historical orders remain permanently bound to their originating provider.

**Default:** `selected_provider = disabled` (production stays off until explicitly approved).

## Architecture

```
Renter / HP UI
    → POST /v1/applications/:id/provider-screening/initiate
    → initiateProviderScreening()
         → resolveProviderForNewScreening()  // admin setting ∩ env readiness
         → ScreeningProvider.createScreeningRequest()
         → persist provider_screening (provider immutable)
    → webhooks (provider-specific verify) update same row by provider+order_id
```

| Component | Path |
|-----------|------|
| Contract | `src/modules/screening/providers/types.ts` |
| CertnAdapter | `src/modules/screening/providers/certn-adapter.ts` |
| CheckrTenantAdapter | `src/modules/screening/providers/checkr-adapter.ts` |
| Selection + audit | `src/modules/screening/providers/selection.ts` |
| Orchestration | `src/modules/screening/providers/orchestrate.ts` |
| Comparison | `src/modules/screening/providers/comparison.ts` |
| Migration | `migrations/0068_screening_provider_orchestration.sql` |

Legacy Checkr routes (`/checkr-screening/*`) remain and call the same orchestrator with `providerOverride: 'checkr_tenant'`.

## Provider selection

| Layer | Mechanism |
|-------|-----------|
| Infrastructure | Env vars (`CERTN_*`, `CHECKR_TENANT_*`) — fail closed if invalid |
| Default for new orders | `screening_provider_setting.selected_provider` |
| Who can change | `rbit_super_admin` only |
| Audit | `screening_provider_setting_change` (actor, timestamp, old, new) |
| Historical | `provider_screening.provider` never rewritten |

API:
- `GET /v1/admin/screening/providers`
- `PUT /v1/admin/screening/providers` `{ "provider": "certn"|"checkr_tenant"|"disabled" }`
- `GET /v1/admin/screening/providers/history`

UI: `/admin/screening`

## Persistence

`provider_screening` records:

- screening_id, application_id, provider, provider_order_id, provider_report_id
- environment, status, product_statuses, result_summary
- idempotency_key (app-level dedup)
- requester party/org, timestamps, webhook touch time

`screening_order.provider` also set for saga/legacy rows.

## Security

- Credentials server-side only; sandbox vs live keys isolated (Checkr live key rejected outside approved production)
- Provider-specific webhook verification (Certn HMAC body; Checkr `Tenant-Signature`)
- Webhooks for historical providers continue when that provider is disabled for new orders
- Reports gated by application/org relationship; `consider` never auto-rejects

## Comparison dashboard

`GET /v1/admin/screening/comparison`  
`POST /v1/admin/screening/comparison/probe`

Shows provider, scenario, status, latency, webhook/report flags, errors — synthetic scenarios only.

## Testing

```bash
npx vitest run tests/unit/screening-providers.test.ts tests/unit/checkr-tenant.test.ts
```

Covered: shared contract, readiness, status normalization, webhook signatures, comparison report aggregation.

## Deployment

- Feature branch: `feat/screening-provider-orchestration`
- Apply migrations `0067` + `0068`
- Do **not** set live Checkr keys or enable production selection without explicit approval
- Keep `selected_provider=disabled` until sandbox sign-off

## Completion checklist

- [x] Both adapters implement `ScreeningProvider`
- [x] One renter-facing screening workflow (`provider-screening`)
- [x] Admin default provider selection with audit
- [x] Historical provider binding
- [x] Unused provider can be disabled without code changes
- [x] Auditable selection + webhook store
- [x] Production disabled by default
