# Shell secrets only — values populated out-of-band after authorized apply.
# Prefix: rbit/staging/dwel/* (never rbit-dev/*).

resource "aws_secretsmanager_secret" "jwt_signing" {
  name       = "${local.secrets_prefix}/jwt-signing-secret"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

resource "aws_secretsmanager_secret" "stripe" {
  name       = "${local.secrets_prefix}/stripe_test"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

resource "aws_secretsmanager_secret" "certn_api_key" {
  name       = "${local.secrets_prefix}/certn_sandbox"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

resource "aws_secretsmanager_secret" "certn_webhook_secret" {
  name       = "${local.secrets_prefix}/certn_webhook_sandbox"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name       = "${local.secrets_prefix}/stripe-webhook-secret"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

resource "aws_secretsmanager_secret" "dwel_internal_service_token" {
  name       = "${local.secrets_prefix}/dwel-internal-service-token"
  kms_key_id = aws_kms_key.pii.arn
  tags = merge(local.tags, {
    Purpose = "dwel-internal-service-auth-staging"
  })
}
