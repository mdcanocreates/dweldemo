output "aurora_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "aurora_reader_endpoint" {
  value = aws_rds_cluster.main.reader_endpoint
}

output "aurora_secret_arn" {
  value = aws_rds_cluster.main.master_user_secret[0].secret_arn
}

output "redis_endpoint" {
  value = aws_elasticache_serverless_cache.redis.endpoint[0].address
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  value = data.aws_ecs_cluster.existing.cluster_name
}

output "ecs_cluster_arn" {
  value = data.aws_ecs_cluster.existing.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "jwt_signing_secret_arn" {
  value = aws_secretsmanager_secret.jwt_signing.arn
}

output "stripe_secret_key_arn" {
  value = aws_secretsmanager_secret.stripe.arn
}

output "certn_api_key_secret_arn" {
  value = aws_secretsmanager_secret.certn_api_key.arn
}

output "certn_webhook_secret_arn" {
  value = aws_secretsmanager_secret.certn_webhook_secret.arn
}
