output "aurora_endpoint" {
  value = module.application_stack.aurora_endpoint
}

output "aurora_reader_endpoint" {
  value = module.application_stack.aurora_reader_endpoint
}

output "aurora_secret_arn" {
  value     = module.application_stack.aurora_secret_arn
  sensitive = true
}

output "redis_endpoint" {
  value = module.application_stack.redis_endpoint
}

output "alb_dns_name" {
  value = module.application_stack.alb_dns_name
}

output "ecs_cluster_name" {
  value = module.application_stack.ecs_cluster_name
}

output "task_role_arn" {
  value = module.application_stack.task_role_arn
}

output "documents_bucket" {
  value = module.baseline.documents_bucket
}

output "kms_key_arn" {
  value = module.baseline.kms_pii_key_arn
}

output "vpc_id" {
  value = module.baseline.vpc_id
}
