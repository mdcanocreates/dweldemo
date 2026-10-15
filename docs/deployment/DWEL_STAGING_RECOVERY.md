# Dwel staging recovery (primary — not blanket destroy)

## Disable staging without touching production

1. ECS: set service `dwel-staging-api` desired count → `0`
2. ALB: delete listener rules for host `dwel-staging.rbitfinancial.com` only (HTTP+HTTPS)
3. CloudFront (if enabled): disable distribution or remove staging alias
4. DNS: remove staging CNAME only — never touch `dwel.rbitfinancial.com`

## Roll back ECS task revision

```bash
# List recent task definitions
aws ecs list-task-definitions --family-prefix dwel-staging-api --sort DESC --max-items 5

# Force prior revision
aws ecs update-service \
  --cluster rbit-dev-cluster \
  --service dwel-staging-api \
  --task-definition dwel-staging-api:<PRIOR_REVISION> \
  --force-new-deployment
```

Verify: `GET https://dwel-staging.rbitfinancial.com/health/live`

## Restore prior frontend artifacts

1. Redeploy previous web build (known SHA) to `dwel-staging-web-*`
2. CloudFront invalidation: `/*`
3. Confirm `VITE_APP_ENV=staging` banner present

## Failed database migrations

1. Do **not** run against production Aurora
2. Capture staging endpoint + migration error from logs
3. Prefer restore from Aurora staging snapshot (see below) then re-run migrate from clean schema
4. Forward-only: do not hand-edit `schema_migrations` on a half-applied DB unless offline forensics says otherwise

## Restore staging Aurora snapshot

```bash
aws rds describe-db-cluster-snapshots --db-cluster-identifier dwel-staging
# Restore to a NEW cluster identifier (e.g. dwel-staging-restore-YYYYMMDD)
# Point staging ECS task DB_HOST at restored endpoint after smoke
# Retire broken cluster after cutover
```

## Incorrect listener rules

1. Identify rule ARN(s) for host `dwel-staging.rbitfinancial.com`
2. Delete those rules only
3. Re-apply from staging Terraform workspace (authorized) or recreate manually with priority from tfvars
4. Confirm production default action / `dwel.rbitfinancial.com` rules unchanged

## Verify recovery

| Check | Expect |
|-------|--------|
| `/health/live` | 200, no DB dependency |
| `/health` | 200 when DB up; 503 when DB down |
| Staging banner | Present |
| Prod `dwel.rbitfinancial.com` | Unchanged response |
| Lumis on shared ALB | Unchanged |
