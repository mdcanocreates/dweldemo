terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type        = string
  description = "dev | staging | prod"
}

variable "aws_region" {
  type    = string
  default = "us-east-2"
}

variable "aurora_min_acu" {
  type        = number
  description = "Aurora Serverless v2 min ACU. Non-prod may be 0."
}

variable "aurora_max_acu" {
  type        = number
  description = "Hard ceiling (P11)."
}

variable "fargate_min_tasks" {
  type    = number
  default = 1
}

variable "fargate_max_tasks" {
  type        = number
  description = "Hard ceiling (P11)."
}

variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  name_prefix = "rbit-${var.environment}"
  tags = merge(var.tags, {
    Project     = "rbit"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

data "aws_caller_identity" "current" {}

resource "aws_vpc" "main" {
  cidr_block           = var.environment == "prod" ? "10.30.0.0/16" : var.environment == "staging" ? "10.20.0.0/16" : "10.10.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = "${local.name_prefix}-vpc" })
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 4, 0)
  availability_zone = "${var.aws_region}a"
  tags              = merge(local.tags, { Name = "${local.name_prefix}-private-a" })
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 4, 1)
  availability_zone = "${var.aws_region}b"
  tags              = merge(local.tags, { Name = "${local.name_prefix}-private-b" })
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 4, 8)
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.name_prefix}-public-a" })
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name_prefix}-igw" })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${local.name_prefix}-nat-eip" })
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  tags          = merge(local.tags, { Name = "${local.name_prefix}-nat" })
}

resource "aws_kms_key" "pii" {
  description             = "${local.name_prefix} PII DEK wrapping key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.tags

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootAccountAdmin"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
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
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/rbit/${var.environment}/api"
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "pii" {
  name          = "alias/${local.name_prefix}-pii"
  target_key_id = aws_kms_key.pii.key_id
}

resource "aws_s3_bucket" "documents" {
  bucket = "${local.name_prefix}-documents-${data.aws_caller_identity.current.account_id}"
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

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"
  tags = local.tags
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/rbit/${var.environment}/api"
  retention_in_days = var.environment == "prod" ? 90 : 30
  kms_key_id        = aws_kms_key.pii.arn
  tags              = local.tags
}

resource "aws_secretsmanager_secret" "db" {
  name       = "${local.name_prefix}/database"
  kms_key_id = aws_kms_key.pii.arn
  tags       = local.tags
}

# Cost guardrail ceilings documented as outputs for autoscaler wiring.
output "aurora_acu_ceiling" {
  value = {
    min = var.aurora_min_acu
    max = var.aurora_max_acu
  }
}

output "fargate_task_ceiling" {
  value = {
    min = var.fargate_min_tasks
    max = var.fargate_max_tasks
  }
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "kms_pii_key_arn" {
  value = aws_kms_key.pii.arn
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}
