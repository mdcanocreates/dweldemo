variable "region" {
  type    = string
  default = "us-east-2"
}

variable "expected_account_id" {
  type        = string
  default     = "941612827888"
  description = "Shared platform account. Staging is same-account Candidate C."
}

variable "owner" {
  type    = string
  default = "dwel-engineering"
}

variable "shared_vpc_name_tag" {
  type        = string
  default     = "rbit-dev-vpc"
  description = "Name tag of the shared VPC owned by envs/dev (production plane)."
}

variable "shared_ecs_cluster_name" {
  type    = string
  default = "rbit-dev-cluster"
}

variable "shared_alb_name" {
  type    = string
  default = "rbit-dev"
}

variable "shared_subnet_name_prefix" {
  type    = string
  default = "rbit-dev"
}

variable "hostname" {
  type    = string
  default = "dwel-staging.rbitfinancial.com"

  validation {
    condition     = var.hostname == "dwel-staging.rbitfinancial.com"
    error_message = "Staging hostname must be exactly dwel-staging.rbitfinancial.com."
  }
}

variable "alb_listener_rule_priority" {
  type    = number
  default = 120
}

variable "app_image_uri" {
  type        = string
  description = "Pinned ECR image. Default is validate-only and rejected by check/preflight before apply."
  # Pinned-looking default so `terraform validate` passes variable validation;
  # env check + ci:staging-terraform-static reject this before authorized plan/apply.
  default = "941612827888.dkr.ecr.us-east-2.amazonaws.com/dwel-staging-api:validate-only-do-not-apply"
}

variable "enable_cloudfront" {
  type    = bool
  default = false
}

variable "acm_certificate_arn_us_east_1" {
  type    = string
  default = ""
}
