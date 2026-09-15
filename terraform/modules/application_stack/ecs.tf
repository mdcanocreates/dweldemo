# ECS cluster is owned by account_baseline — look up by name, do not recreate.
data "aws_ecs_cluster" "existing" {
  cluster_name = var.ecs_cluster_name
}

# NOTE: Log group /rbit/<env>/api is created by account_baseline.
# Do not recreate it here (would conflict on apply).

resource "aws_ecs_task_definition" "app" {
  family                   = "rbit-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.app_image_uri
    essential = true
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3000" },
      { name = "AWS_REGION", value = var.region },
      { name = "DB_HOST", value = aws_rds_cluster.main.endpoint },
      { name = "DB_PORT", value = "5432" },
      { name = "DB_NAME", value = "rbit" },
      { name = "DB_USER", value = "rbit_admin" },
      {
        name  = "REDIS_URL"
        value = "rediss://${aws_elasticache_serverless_cache.redis.endpoint[0].address}:6379"
      },
      { name = "S3_BUCKET", value = var.documents_bucket },
      { name = "KMS_KEY_ID", value = var.kms_pii_key_arn },
      { name = "CERTN_BASE_URL", value = "https://api.sandbox.certn.co" },
      # Sandbox-only check types — NOT an RS-tier business mapping.
      { name = "CERTN_SANDBOX_CHECK_TYPES", value = "IDENTITY_VERIFICATION_1" }
    ]
    secrets = [
      {
        name      = "DB_PASSWORD"
        valueFrom = "${aws_rds_cluster.main.master_user_secret[0].secret_arn}:password::"
      },
      {
        name      = "JWT_SECRET"
        valueFrom = aws_secretsmanager_secret.jwt_signing.arn
      },
      {
        name      = "STRIPE_SECRET_KEY"
        valueFrom = aws_secretsmanager_secret.stripe.arn
      },
      # CERTN_API_KEY is injected only after the secret has been populated.
      # Do not add CERTN_WEBHOOK_SECRET until a real webhook signing secret exists.
      {
        name      = "CERTN_API_KEY"
        valueFrom = aws_secretsmanager_secret.certn_api_key.arn
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = local.app_log_group
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "rbit-${var.environment}-api"
  cluster         = data.aws_ecs_cluster.existing.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.fargate_min_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.private.ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 120

  depends_on = [aws_lb_listener.http]

  tags = { Environment = var.environment }
}

resource "aws_appautoscaling_target" "app" {
  max_capacity       = var.fargate_max_count
  min_capacity       = var.fargate_min_count
  resource_id        = "service/${data.aws_ecs_cluster.existing.cluster_name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "rbit-${var.environment}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 70.0
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
