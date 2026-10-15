# Dwel staging change manifest (authorized plan expectation)

Generated for Candidate C attachment TF. **Not** an applied plan output.

## Creates (staging-owned)

| Type | Name / identity |
|------|-----------------|
| `aws_kms_key` + alias | `alias/dwel-staging-pii` |
| `aws_s3_bucket` | `dwel-staging-documents-941612827888` |
| `aws_s3_bucket` | `dwel-staging-web-941612827888` |
| `aws_cloudwatch_log_group` | `/rbit/staging/dwel/api` |
| `aws_security_group` | `dwel-staging-app`, `dwel-staging-aurora` |
| `aws_db_subnet_group` | `dwel-staging-aurora` |
| `aws_rds_cluster` + instance | `dwel-staging`, `dwel-staging-writer` |
| `aws_secretsmanager_secret` | `rbit/staging/dwel/*` (shells) |
| `aws_iam_role` + policies | `dwel-staging-execution`, `dwel-staging-task` |
| `aws_lb_target_group` | `dwel-staging-api` |
| `aws_lb_listener_rule` ×2 | host `dwel-staging.rbitfinancial.com` on shared HTTP+HTTPS |
| `aws_ecs_task_definition` | family `dwel-staging-api` |
| `aws_ecs_service` | `dwel-staging-api` on shared cluster |
| `aws_appautoscaling_*` | staging service CPU tracking |
| Optional CF | OAC, distribution, origin request/cache policies (when `enable_cloudfront=true`) |

## References only (shared / existing — do not recreate)

| Resource | Identity |
|----------|----------|
| VPC | `rbit-dev-vpc` |
| Subnets | `rbit-dev-private-a/b`, `rbit-dev-public-a/b` |
| ALB | `rbit-dev` |
| ALB listeners | ports 80 / 443 on shared ALB |
| ECS cluster | `rbit-dev-cluster` |

## Shared resource modifications (narrow — approval required)

| Change | Risk |
|--------|------|
| Add HTTP listener rule priority 120 (default) for staging host | Low if priority free; **conflict if 120 taken** |
| Add HTTPS listener rule same priority | Same |

No ALB replace, no default action change, no prod host rule edits.

## Explicitly not created

VPC, NAT/EIP, second ALB, ECS cluster, Redis/ElastiCache, production Aurora, production DNS/`dwel.rbitfinancial.com`.
