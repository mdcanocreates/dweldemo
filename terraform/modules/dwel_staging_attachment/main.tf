/**
 * dwel_staging_attachment — Candidate C staging plane.
 *
 * Attaches Dwel staging to SHARED network/compute:
 *   VPC, ALB (rbit-dev), ECS cluster (rbit-dev-cluster).
 *
 * Creates ONLY staging-scoped resources.
 * NEVER creates: VPC, NAT, second ALB, ECS cluster, Redis, prod Aurora.
 * NEVER targets hostname dwel.rbitfinancial.com.
 */

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  tags = merge(var.tags, {
    Project     = "rbit"
    Product     = "dwel"
    Environment = "staging"
    Owner       = var.owner
    ManagedBy   = "terraform"
    Module      = "dwel_staging_attachment"
  })

  secrets_prefix = "rbit/staging/dwel"
  log_group      = "/rbit/staging/dwel/api"
  db_name        = "dwel_staging"
}

# ── Shared plane (read-only) ───────────────────────────────────────────────

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.shared_vpc_id]
  }
  filter {
    name = "tag:Name"
    values = [
      "${var.shared_subnet_name_prefix}-private-a",
      "${var.shared_subnet_name_prefix}-private-b",
    ]
  }
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [var.shared_vpc_id]
  }
  filter {
    name = "tag:Name"
    values = [
      "${var.shared_subnet_name_prefix}-public-a",
      "${var.shared_subnet_name_prefix}-public-b",
    ]
  }
}

data "aws_ecs_cluster" "shared" {
  cluster_name = var.shared_ecs_cluster_name
}

data "aws_lb" "shared" {
  name = var.shared_alb_name
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.shared.arn
  port              = 443
}

data "aws_lb_listener" "http" {
  load_balancer_arn = data.aws_lb.shared.arn
  port              = 80
}

locals {
  ecs_subnet_ids = var.ecs_assign_public_ip ? tolist(data.aws_subnets.public.ids) : tolist(data.aws_subnets.private.ids)
  alb_sg_ids     = data.aws_lb.shared.security_groups
  alb_dns_name   = var.alb_dns_name_override != "" ? var.alb_dns_name_override : data.aws_lb.shared.dns_name
}

check "shared_subnets_present" {
  assert {
    condition     = length(data.aws_subnets.private.ids) >= 2
    error_message = "Expected ≥2 shared private subnets tagged ${var.shared_subnet_name_prefix}-private-a/b."
  }
  assert {
    condition     = !var.ecs_assign_public_ip || length(data.aws_subnets.public.ids) >= 1
    error_message = "Public-IP Fargate requires ≥1 shared public subnet."
  }
}

# ── Staging KMS + documents / web S3 ───────────────────────────────────────

resource "aws_kms_key" "pii" {
  description             = "${var.name_prefix} PII DEK wrapping key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.tags

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableRootAccountAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowRds"
        Effect    = "Allow"
        Principal = { Service = "rds.amazonaws.com" }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "rds.${var.region}.amazonaws.com"
          }
        }
      },
      {
        Sid       = "AllowSecretsManager"
        Effect    = "Allow"
        Principal = { Service = "secretsmanager.amazonaws.com" }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com"
          }
        }
      },
      {
        Sid       = "AllowCloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ]
        Resource = "*"
        Condition = {
          ArnEquals = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${var.account_id}:log-group:${local.log_group}"
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "pii" {
  name          = "alias/${var.name_prefix}-pii"
  target_key_id = aws_kms_key.pii.key_id
}

resource "aws_s3_bucket" "documents" {
  bucket = "${var.name_prefix}-documents-${var.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.pii.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "documents_tls" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.documents.arn,
        "${aws_s3_bucket.documents.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

resource "aws_s3_bucket" "web" {
  bucket = "${var.name_prefix}-web-${var.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.log_group
  retention_in_days = 30
  kms_key_id        = aws_kms_key.pii.arn
  tags              = local.tags
}
