resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
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
      { name = "NODE_ENV", value = "production" },
      { name = "APP_ENV", value = "staging" },
      { name = "PORT", value = "3000" },
      { name = "AWS_REGION", value = var.region },
      { name = "DB_HOST", value = aws_rds_cluster.main.endpoint },
      { name = "DB_PORT", value = "5432" },
      { name = "DB_NAME", value = local.db_name },
      { name = "DB_USER", value = "rbit_admin" },
      { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
      { name = "KMS_KEY_ID", value = aws_kms_key.pii.arn },
      { name = "PUBLIC_APP_URL", value = var.public_app_url },
      { name = "EMAIL_PROVIDER", value = var.email_provider },
      { name = "EMAIL_FROM_ADDRESS", value = var.email_from_address },
      { name = "EMAIL_REPLY_TO", value = var.email_reply_to },
      { name = "SES_CONFIGURATION_SET", value = var.ses_configuration_set },
      { name = "AUTH_RETURN_REDEEM_TOKEN", value = var.auth_return_redeem_token },
      { name = "DWEL_INTERNAL_PREVIEW_ENABLED", value = var.dwel_internal_preview_enabled },
      { name = "DWEL_INTERNAL_PREVIEW_EMAILS", value = var.dwel_internal_preview_emails },
      { name = "CERTN_BASE_URL", value = "https://api.sandbox.certn.co" },
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
      {
        name      = "CERTN_API_KEY"
        valueFrom = aws_secretsmanager_secret.certn_api_key.arn
      },
      {
        name      = "CERTN_WEBHOOK_SECRET"
        valueFrom = aws_secretsmanager_secret.certn_webhook_secret.arn
      },
      {
        name      = "DWEL_INTERNAL_SERVICE_TOKEN"
        valueFrom = aws_secretsmanager_secret.dwel_internal_service_token.arn
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = local.log_group
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/health/live || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  # Bootstrap definition only. Image/env deploys register new revisions outside TF.
  lifecycle {
    ignore_changes = [container_definitions]
  }

  tags = local.tags
}

resource "aws_ecs_service" "app" {
  name            = "${var.name_prefix}-api"
  cluster         = data.aws_ecs_cluster.shared.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.fargate_min_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.ecs_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = var.ecs_assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 120

  depends_on = [
    aws_lb_listener_rule.staging_host_https,
    aws_lb_listener_rule.staging_host_http,
  ]

  tags = local.tags

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_appautoscaling_target" "app" {
  max_capacity       = var.fargate_max_count
  min_capacity       = var.fargate_min_count
  resource_id        = "service/${data.aws_ecs_cluster.shared.cluster_name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name_prefix}-cpu"
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
