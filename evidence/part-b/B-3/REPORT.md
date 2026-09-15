# B-3 — Device fraud prescreen — acceptance

| Criterion | Status |
|---|---|
| 3 identities / 30d → prescreen_failed | PASS |
| 4 devices / 7d same party → fail | PASS |
| 5 apps / 24h same device → fail | PASS |
| No Certn vendor_request_archive on fail | PASS |
| Thresholds from fraud_thresholds config | PASS |
| Admin clear → resume from prescreen | PASS |
| Generic decline (no reason leak) | PASS |

Module: `src/modules/screening/device-prescreen.ts`; migration `0044_device_prescreen.sql`.
