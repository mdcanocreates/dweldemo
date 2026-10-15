output "aurora_endpoint" {
  value = module.staging.aurora_endpoint
}

output "documents_bucket" {
  value = module.staging.documents_bucket
}

output "web_bucket" {
  value = module.staging.web_bucket
}

output "ecs_service_name" {
  value = module.staging.ecs_service_name
}

output "hostname" {
  value = module.staging.hostname
}

output "log_group" {
  value = module.staging.log_group
}

output "secrets_prefix" {
  value = module.staging.secrets_prefix
}

output "kms_pii_key_arn" {
  value = module.staging.kms_pii_key_arn
}

output "target_group_arn" {
  value = module.staging.target_group_arn
}

output "cloudfront_domain_name" {
  value = module.staging.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.staging.cloudfront_distribution_id
}

output "change_manifest_shared_refs" {
  value       = module.staging.shared_resources_referenced
  description = "Existing shared resources referenced (not created)."
}
