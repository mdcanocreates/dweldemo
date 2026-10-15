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
  name               = "${var.name_prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_base" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_kms_key" "aurora_master_secret" {
  count  = length(aws_rds_cluster.main.master_user_secret) > 0 ? 1 : 0
  key_id = aws_rds_cluster.main.master_user_secret[0].kms_key_id
}

locals {
  execution_kms_decrypt_arns = compact([
    aws_kms_key.pii.arn,
    length(data.aws_kms_key.aurora_master_secret) > 0 && data.aws_kms_key.aurora_master_secret[0].key_manager == "CUSTOMER" ? data.aws_kms_key.aurora_master_secret[0].arn : null,
  ])
  aurora_master_secret_arn = try(aws_rds_cluster.main.master_user_secret[0].secret_arn, null)
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:${local.secrets_prefix}/*",
      local.aurora_master_secret_arn,
    ])
  }
  statement {
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = local.execution_kms_decrypt_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task_permissions" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${aws_s3_bucket.documents.bucket}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${aws_s3_bucket.documents.bucket}"]
  }
  statement {
    actions   = ["kms:GenerateDataKey", "kms:Encrypt", "kms:Decrypt"]
    resources = [aws_kms_key.pii.arn]
  }
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:${local.secrets_prefix}/*",
      local.aurora_master_secret_arn,
    ])
  }
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:${local.log_group}:*"]
  }
  dynamic "statement" {
    for_each = var.email_provider == "ses" ? [1] : []
    content {
      sid = "SesSendStaging"
      actions = [
        "ses:SendEmail",
        "ses:SendRawEmail",
      ]
      # Staging SES must still use sandbox/allowlisted recipients out-of-band.
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${var.name_prefix}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_permissions.json
}
