# Dwel staging rollout runbook (approval-gated)

**Do not execute apply/DNS/migrate/deploy steps without a named human approval.**

Base branch for prep: `staging/engineering-continue` (from `fddec9a`).

## 0. Preconditions

- [ ] Remote state bucket + DynamoDB lock created (names in `backend.hcl`, not the example placeholders)
- [ ] `npm run ci:staging-terraform-static` pass
- [ ] `terraform -chdir=terraform/envs/staging fmt -check` + `validate` pass
- [ ] `npm run staging:preflight -- --image <pinned-ecr-uri>` pass
- [ ] Release tag `dwel-charter-v3-staging-rc1` on a clean SHA
- [ ] Sandbox Certn + Stripe test keys ready (never prod)

## 1. Backend init (authorized)

```bash
cp terraform/envs/staging/backend.hcl.example terraform/envs/staging/backend.hcl
# edit: replace PLACEHOLDER_* values with real bucket/table
# uncomment backend block in backend.tf
terraform -chdir=terraform/envs/staging init -backend-config=backend.hcl
```

## 2. Reviewed plan (authorized)

```bash
terraform -chdir=terraform/envs/staging plan \
  -var="app_image_uri=<ACCOUNT>.dkr.ecr.us-east-2.amazonaws.com/dwel-staging-api:<SHA>" \
  -out=staging.tfplan
```

Review checklist:

- Creates: Aurora `dwel-staging`, ECS `dwel-staging-api`, TG, HTTP+HTTPS host rules, KMS, S3, secrets shells, logs
- Does **not** create: VPC, NAT, ALB, ECS cluster, Redis
- Shared refs only: `rbit-dev-vpc`, `rbit-dev`, `rbit-dev-cluster`
- Hostname only `dwel-staging.rbitfinancial.com`
- Highlight any in-place change to shared listener (rule add only)

## 3. Apply staging resources (authorized)

```bash
terraform -chdir=terraform/envs/staging apply staging.tfplan
```

Optional later: `-var="enable_cloudfront=true" -var="acm_certificate_arn_us_east_1=arn:..."` after ACM exists in **us-east-1**.

## 4. Secrets (authorized)

Populate `rbit/staging/dwel/*` with sandbox/test values only. Reject `sk_live`, prod Certn keys.

## 5. DNS / ACM (authorized)

- ACM (us-east-1) for `dwel-staging.rbitfinancial.com`
- Cloudflare CNAME → CloudFront (or temporary ALB while CF disabled)
- Never touch `dwel.rbitfinancial.com`

## 6. Migrations (authorized — staging Aurora only)

```bash
# after bastion/tunnel or one-off task with staging DB endpoint
DATABASE_URL=postgres://...@dwel-staging.../dwel_staging npm run migrate
```

Confirm endpoint ≠ production `rbit-dev` cluster.

## 7. Deploy by SHA

- Register ECS task revision with pinned image
- Build web with `VITE_APP_ENV=staging`
- Sync to `dwel-staging-web-*`; invalidate CF

## 8. Smoke / E2E

- `GET https://dwel-staging.rbitfinancial.com/health/live`
- Login + interest + missing-info doc path
- Browser E2E when disposable staging is up

## 9. Rollback

- ECS desired count → 0
- Delete host listener rules / destroy staging workspace only
- Never apply destroy against `envs/dev` state
