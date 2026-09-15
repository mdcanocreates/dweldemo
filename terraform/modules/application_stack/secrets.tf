# Application secrets referenced by the ECS task definition.
# Secret values must be populated outside Terraform (Phase 2+).
resource "aws_secretsmanager_secret" "jwt_signing" {
  name       = "rbit-${var.environment}/jwt-signing-secret"
  kms_key_id = var.kms_pii_key_arn

  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret" "stripe" {
  name       = "rbit-${var.environment}/stripe-secret-key"
  kms_key_id = var.kms_pii_key_arn

  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret" "certn_api_key" {
  name       = "rbit-${var.environment}/certn-api-key"
  kms_key_id = var.kms_pii_key_arn

  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret" "certn_webhook_secret" {
  name       = "rbit-${var.environment}/certn-webhook-secret"
  kms_key_id = var.kms_pii_key_arn

  tags = { Environment = var.environment }
}

# Shell only — Stripe Connect out of scope for this phase.
resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name       = "rbit-${var.environment}/stripe-webhook-secret"
  kms_key_id = var.kms_pii_key_arn

  tags = { Environment = var.environment }
}
