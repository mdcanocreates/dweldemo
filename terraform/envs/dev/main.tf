# Account: rbit-dev — isolated AWS account (D-08 / §16.1)
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # backend "s3" {
  #   bucket = "rbit-terraform-state-dev"
  #   key    = "phase0/terraform.tfstate"
  #   region = "us-east-2"
  # }
}

provider "aws" {
  region = "us-east-2"
  # assume_role { role_arn = "arn:aws:iam::DEV_ACCOUNT_ID:role/terraform" }
}

# account_baseline does not export account_id — resolve via caller identity (no baseline edits).
data "aws_caller_identity" "current" {}

module "baseline" {
  source = "../../modules/account_baseline"

  environment       = "dev"
  aurora_min_acu    = 0
  aurora_max_acu    = 4
  fargate_min_tasks = 0
  fargate_max_tasks = 4
}

module "application_stack" {
  source = "../../modules/application_stack"

  vpc_id           = module.baseline.vpc_id
  account_id       = data.aws_caller_identity.current.account_id
  kms_pii_key_arn  = module.baseline.kms_pii_key_arn
  documents_bucket = module.baseline.documents_bucket
  ecs_cluster_name = module.baseline.ecs_cluster_name
  environment      = "dev"

  aurora_min_acu    = 0.5
  aurora_max_acu    = 4
  fargate_min_count = 1
  fargate_max_count = 3

  app_image_uri = "${data.aws_caller_identity.current.account_id}.dkr.ecr.us-east-2.amazonaws.com/rbit-dev-api:latest"

  # Leave empty until ACM cert is issued — HTTP listener forwards to TG temporarily
  acm_certificate_arn = ""
}

output "ceilings" {
  value = {
    aurora  = module.baseline.aurora_acu_ceiling
    fargate = module.baseline.fargate_task_ceiling
  }
}
