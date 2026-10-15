# Dwel staging Terraform (`envs/staging`)

**Status:** Code prep. **Do not `terraform apply` without explicit human authorization.**

See `docs/deployment/DWEL_STAGING_ROLLOUT_RUNBOOK.md` and `DWEL_STAGING_CHANGE_MANIFEST.md`.

## Model (Candidate C)

- Same account/region as production-serving `rbit-dev*` (`941612827888` / `us-east-2`)
- Data-sources shared VPC, ALB, cluster
- Creates staging-only Aurora/ECS/TG/host rules/KMS/S3/secrets/logs
- Optional CloudFront (`enable_cloudfront=true`) with **viewer Host forwarded** to ALB
- Public-subnet Fargate (`assign_public_ip=true`) — no NAT
- Hostname: `dwel-staging.rbitfinancial.com` only

## Offline validate

```bash
npm run ci:staging-terraform-static
terraform -chdir=terraform/envs/staging init -backend=false
terraform -chdir=terraform/envs/staging fmt -check
terraform -chdir=terraform/envs/staging validate
```

Default `app_image_uri` is `…:validate-only-do-not-apply` — rejected by `check` blocks / preflight before authorized plan.
