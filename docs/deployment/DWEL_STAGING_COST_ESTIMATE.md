# Cost estimate — Dwel staging incremental (+ shared spine context)

**Label: ESTIMATES — not invoices.** Region us-east-2. List-price planning only.

## Shared baseline (already paid — do not double-count)

| Component | Products | Notes |
|-----------|----------|-------|
| ALB `rbit-dev` | Dwel + Lumis | Shared ingress |
| ECS cluster `rbit-dev-cluster` | Dwel + Lumis | Shared compute plane |
| Aurora `rbit-dev` | Dwel + Lumis schemas | **Production-serving** |
| Admin | Separate deployable | DynamoDB today; no always-on Fargate assumed |

## Staging incremental (Dwel only)

| Component | Idle / min viable | Notes |
|-----------|-------------------|-------|
| Aurora Serverless v2 `dwel-staging` (min 0, pause 600s) | ~$0–5 idle | Wakes on migrate/test |
| Fargate `dwel-staging-api` (0.25 vCPU / 1GB) | ~$0 at desired 0; ~$8–9 if always 1 | Public IP ~+$3.65 if running |
| Shared ALB incremental LCU | ~$0–2 | Host rule only |
| S3 docs + web | ~$1–3 | |
| CloudFront (optional) | ~$1–5 | |
| KMS / Secrets / CW Logs | ~$1–3 | |
| Redis | **$0** | Not created |
| NAT | **$0** | Not created; public-subnet Fargate |
| **Approx staging idle** | **~$5–15** (scale-to-0) / **~$18–30** (1 task) | |

## Lumis / Admin staging

| Product | Staging posture | Incremental |
|---------|-----------------|-------------|
| Lumis | Not in this TF root | $0 from this change |
| Admin | Product-specific; env fence to staging Dwel later | Prefer no always-on Admin Fargate without evidence |

## Rejected cost drivers

Second ALB (~+$16), NAT (~+$33), Redis Serverless, separate AWS account tax for v1.
