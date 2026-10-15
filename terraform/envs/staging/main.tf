# Dwel staging — Candidate C attachment to shared plane (same AWS account).
#
# DO NOT terraform apply without explicit human authorization.
# This root MUST NOT create VPC / NAT / ALB / ECS cluster.
# Production hostname dwel.rbitfinancial.com is never targeted.
#
# Account: 941612827888 (shared) · Region: us-east-2
# Host: dwel-staging.rbitfinancial.com

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "rbit"
      Product     = "dwel"
      Environment = "staging"
      Owner       = var.owner
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "shared" {
  filter {
    name   = "tag:Name"
    values = [var.shared_vpc_name_tag]
  }
}

check "account_is_expected" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
    error_message = "Wrong AWS account — refusing staging workspace (expected ${var.expected_account_id})."
  }
}

check "image_not_placeholder" {
  assert {
    condition = (
      !can(regex("validate-only|do-not-apply|amazonlinux|:latest$", var.app_image_uri))
    )
    error_message = "app_image_uri looks like a validate/placeholder image — pin a real SHA/tag before plan/apply."
  }
}

module "staging" {
  source = "../../modules/dwel_staging_attachment"

  account_id                    = data.aws_caller_identity.current.account_id
  region                        = var.region
  name_prefix                   = "dwel-staging"
  owner                         = var.owner
  shared_vpc_id                 = data.aws_vpc.shared.id
  shared_ecs_cluster_name       = var.shared_ecs_cluster_name
  shared_alb_name               = var.shared_alb_name
  shared_subnet_name_prefix     = var.shared_subnet_name_prefix
  hostname                      = var.hostname
  alb_listener_rule_priority    = var.alb_listener_rule_priority
  app_image_uri                 = var.app_image_uri
  enable_cloudfront             = var.enable_cloudfront
  acm_certificate_arn_us_east_1 = var.acm_certificate_arn_us_east_1

  aurora_min_acu                  = 0
  aurora_max_acu                  = 4
  aurora_seconds_until_auto_pause = 600
  fargate_min_count               = 0
  fargate_max_count               = 2
  ecs_assign_public_ip            = true
  public_app_url                  = "https://${var.hostname}"
}

output "guardrails" {
  value = {
    creates_vpc         = false
    creates_nat         = false
    creates_alb         = false
    creates_ecs_cluster = false
    creates_redis       = false
    production_hostname = "dwel.rbitfinancial.com"
    staging_hostname    = module.staging.hostname
    shared_vpc_id       = data.aws_vpc.shared.id
    shared_cluster      = module.staging.ecs_cluster_name
    shared_referenced   = module.staging.shared_resources_referenced
  }
}
