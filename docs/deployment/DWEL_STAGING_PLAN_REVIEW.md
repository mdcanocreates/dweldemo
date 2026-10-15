# Staging Terraform plan-review procedure (no apply)

## Preconditions

```bash
npm run ci:staging-terraform-static
npm run staging:preflight -- --image "<ACCOUNT>.dkr.ecr.us-east-2.amazonaws.com/dwel-staging-api@sha256:<DIGEST>"
terraform -chdir=terraform/envs/staging init -backend-config=backend.hcl   # after real bucket exists
```

## Plan command

```bash
terraform -chdir=terraform/envs/staging plan \
  -var="app_image_uri=<ACCOUNT>.dkr.ecr.us-east-2.amazonaws.com/dwel-staging-api@sha256:<DIGEST>" \
  -out=staging.tfplan
terraform -chdir=terraform/envs/staging show -no-color staging.tfplan > staging.tfplan.txt
```

## Must create

See `DWEL_STAGING_CHANGE_MANIFEST.md` (Aurora, ECS service, TG, host rules, KMS, S3, secrets shells, logs).

## Must NOT create

`aws_vpc`, `aws_nat_gateway`, `aws_lb` (full), `aws_ecs_cluster`, Redis.

## Shared modifications (highlight)

Only additive `aws_lb_listener_rule` on shared HTTP/HTTPS listeners for `dwel-staging.rbitfinancial.com`.

## Stop

Human approval required before `terraform apply staging.tfplan`.
