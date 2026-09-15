data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "rbit-${var.environment}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy_attachment" "execution_base" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Aurora manage_master_user_password encrypts with a KMS key recorded on the cluster.
# AWS-managed keys (e.g. aws/secretsmanager backing key) do not need explicit
# kms:Decrypt on the execution role — only customer-managed keys do.
data "aws_kms_key" "aurora_master_secret" {
  count  = length(aws_rds_cluster.main.master_user_secret) > 0 ? 1 : 0
  key_id = aws_rds_cluster.main.master_user_secret[0].kms_key_id
}

locals {
  execution_kms_decrypt_arns = compact([
    var.kms_pii_key_arn,
    length(data.aws_kms_key.aurora_master_secret) > 0 && data.aws_kms_key.aurora_master_secret[0].key_manager == "CUSTOMER" ? data.aws_kms_key.aurora_master_secret[0].arn : null,
  ])
}

# Execution role must read Secrets Manager + decrypt with KMS for container secrets.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:rbit-${var.environment}/*",
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:rds!cluster*",
    ]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = local.execution_kms_decrypt_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "rbit-${var.environment}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "rbit-${var.environment}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = { Environment = var.environment }
}

data "aws_iam_policy_document" "task_permissions" {
  # S3: documents bucket only
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.documents_bucket}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.documents_bucket}"]
  }
  # KMS: PII key only
  statement {
    actions   = ["kms:GenerateDataKey", "kms:Encrypt", "kms:Decrypt"]
    resources = [var.kms_pii_key_arn]
  }
  # Secrets Manager: rbit-<env>/* only
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:rbit-${var.environment}/*"]
  }
  # Aurora master password secret (manage_master_user_password)
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:rds!cluster*"]
  }
  # CloudWatch Logs
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/rbit/${var.environment}/*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "rbit-${var.environment}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_permissions.json
}
