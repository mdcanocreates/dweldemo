resource "aws_elasticache_subnet_group" "redis" {
  name       = "rbit-${var.environment}-redis"
  subnet_ids = data.aws_subnets.private.ids
}

resource "aws_elasticache_serverless_cache" "redis" {
  engine = "redis"
  name   = "rbit-${var.environment}-cache"

  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 1000
    }
  }

  subnet_ids         = data.aws_subnets.private.ids
  security_group_ids = [aws_security_group.redis.id]

  tags = { Environment = var.environment }
}
