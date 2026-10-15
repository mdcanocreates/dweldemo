variable "account_id" {
  type = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account id."
  }
}

variable "region" {
  type    = string
  default = "us-east-2"
}

variable "name_prefix" {
  type        = string
  default     = "dwel-staging"
  description = "Resource name prefix. Must not collide with production rbit-dev*."

  validation {
    condition     = can(regex("^dwel-staging", var.name_prefix)) && !can(regex("^rbit-dev", var.name_prefix))
    error_message = "name_prefix must start with dwel-staging and must not start with rbit-dev."
  }
}

variable "owner" {
  type        = string
  default     = "dwel-engineering"
  description = "Ownership tag value."
}

variable "shared_vpc_id" {
  type        = string
  description = "Existing shared VPC (production plane). Data-sourced; never recreated."
}

variable "shared_ecs_cluster_name" {
  type        = string
  default     = "rbit-dev-cluster"
  description = "Existing shared ECS cluster name."
}

variable "shared_alb_name" {
  type        = string
  default     = "rbit-dev"
  description = "Existing shared ALB name."
}

variable "shared_subnet_name_prefix" {
  type        = string
  default     = "rbit-dev"
  description = "Name-tag prefix for shared private/public subnets."
}

variable "hostname" {
  type        = string
  default     = "dwel-staging.rbitfinancial.com"
  description = "Host header for ALB rules and CloudFront alias. Never production hostname."

  validation {
    condition     = var.hostname == "dwel-staging.rbitfinancial.com"
    error_message = "Staging hostname must be exactly dwel-staging.rbitfinancial.com."
  }
}

variable "alb_listener_rule_priority" {
  type        = number
  default     = 120
  description = "Unique priority on shared HTTPS and HTTP listeners."

  validation {
    condition     = var.alb_listener_rule_priority >= 10 && var.alb_listener_rule_priority <= 50000
    error_message = "alb_listener_rule_priority must be a valid ALB rule priority."
  }
}

variable "app_image_uri" {
  type        = string
  description = "Pinned image URI (SHA or release tag). Never deploy :latest alone."

  validation {
    condition     = !can(regex(":latest$", var.app_image_uri)) && var.app_image_uri != ""
    error_message = "app_image_uri must be a pinned tag/digest — :latest is prohibited."
  }
}

variable "aurora_min_acu" {
  type    = number
  default = 0
}

variable "aurora_max_acu" {
  type    = number
  default = 4
}

variable "aurora_seconds_until_auto_pause" {
  type    = number
  default = 600
}

variable "fargate_min_count" {
  type    = number
  default = 0
}

variable "fargate_max_count" {
  type    = number
  default = 2
}

variable "ecs_assign_public_ip" {
  type        = bool
  default     = true
  description = "Public-subnet Fargate (no NAT). Required for ECR/SM/vendor egress without endpoints."
}

variable "public_app_url" {
  type    = string
  default = "https://dwel-staging.rbitfinancial.com"
}

variable "email_provider" {
  type    = string
  default = "ses"
}

variable "email_from_address" {
  type    = string
  default = "noreply@rbitfinancial.com"
}

variable "email_reply_to" {
  type    = string
  default = "support@rbitfinancial.com"
}

variable "ses_configuration_set" {
  type    = string
  default = ""
}

variable "auth_return_redeem_token" {
  type    = string
  default = "false"
}

variable "dwel_internal_preview_enabled" {
  type    = string
  default = "false"
}

variable "dwel_internal_preview_emails" {
  type    = string
  default = ""
}

variable "enable_cloudfront" {
  type        = bool
  default     = false
  description = "Create staging CloudFront + OAC. Requires acm_certificate_arn_us_east_1."
}

variable "acm_certificate_arn_us_east_1" {
  type        = string
  default     = ""
  description = "ACM cert in us-east-1 covering dwel-staging.rbitfinancial.com (CloudFront only)."
}

variable "alb_dns_name_override" {
  type        = string
  default     = ""
  description = "Optional ALB DNS override; empty uses data.aws_lb.shared.dns_name."
}

variable "tags" {
  type    = map(string)
  default = {}
}
