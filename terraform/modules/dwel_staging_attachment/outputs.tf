output "aurora_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "aurora_secret_arn" {
  value     = try(aws_rds_cluster.main.master_user_secret[0].secret_arn, null)
  sensitive = true
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "kms_pii_key_arn" {
  value = aws_kms_key.pii.arn
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "ecs_cluster_name" {
  value = data.aws_ecs_cluster.shared.cluster_name
}

output "target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "alb_listener_rule_https_arn" {
  value = aws_lb_listener_rule.staging_host_https.arn
}

output "alb_listener_rule_http_arn" {
  value = aws_lb_listener_rule.staging_host_http.arn
}

output "hostname" {
  value = var.hostname
}

output "log_group" {
  value = local.log_group
}

output "secrets_prefix" {
  value = local.secrets_prefix
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "cloudfront_domain_name" {
  value = try(aws_cloudfront_distribution.staging[0].domain_name, null)
}

output "cloudfront_distribution_id" {
  value = try(aws_cloudfront_distribution.staging[0].id, null)
}

output "shared_resources_referenced" {
  value = {
    vpc_id       = var.shared_vpc_id
    alb_arn      = data.aws_lb.shared.arn
    alb_dns_name = local.alb_dns_name
    cluster_arn  = data.aws_ecs_cluster.shared.arn
  }
}
