variable "vpc_id" {
  type = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-2"
}

variable "kms_pii_key_arn" {
  type = string
}

variable "documents_bucket" {
  type = string
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "app_image_uri" {
  type    = string
  default = "public.ecr.aws/amazonlinux/amazonlinux:latest"
}

# Scaling ceilings — dev defaults (staging/prod override these)
variable "aurora_min_acu" {
  type    = number
  default = 0.5
}

variable "aurora_max_acu" {
  type    = number
  default = 4
}

variable "fargate_min_count" {
  type    = number
  default = 1
}

variable "fargate_max_count" {
  type    = number
  default = 3
}

variable "acm_certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate ARN. Leave empty to skip HTTPS listener until DNS is configured."
}

variable "ecs_cluster_name" {
  type        = string
  description = "Existing ECS cluster name from account_baseline (e.g. rbit-dev-cluster)."
}
