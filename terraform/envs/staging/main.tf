# Account: rbit-staging — isolated AWS account (D-08 / §16.1)
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
  region = "us-east-2"
}

module "baseline" {
  source = "../../modules/account_baseline"

  environment       = "staging"
  aurora_min_acu    = 0
  aurora_max_acu    = 8
  fargate_min_tasks = 0
  fargate_max_tasks = 8
}

output "ceilings" {
  value = {
    aurora  = module.baseline.aurora_acu_ceiling
    fargate = module.baseline.fargate_task_ceiling
  }
}
