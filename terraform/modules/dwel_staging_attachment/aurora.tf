resource "aws_db_subnet_group" "aurora" {
  name       = "${var.name_prefix}-aurora"
  subnet_ids = data.aws_subnets.private.ids
  tags       = local.tags
}

resource "aws_rds_cluster" "main" {
  cluster_identifier          = var.name_prefix
  engine                      = "aurora-postgresql"
  engine_version              = "15.18"
  database_name               = local.db_name
  master_username             = "rbit_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.aurora.name
  vpc_security_group_ids      = [aws_security_group.aurora.id]

  serverlessv2_scaling_configuration {
    min_capacity             = var.aurora_min_acu
    max_capacity             = var.aurora_max_acu
    seconds_until_auto_pause = var.aurora_seconds_until_auto_pause
  }

  enable_http_endpoint         = false
  storage_encrypted            = true
  kms_key_id                   = aws_kms_key.pii.arn
  deletion_protection          = false
  skip_final_snapshot          = true
  backup_retention_period      = 7
  preferred_backup_window      = "03:00-04:00"
  preferred_maintenance_window = "sun:05:00-sun:06:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = local.tags
}

resource "aws_rds_cluster_instance" "writer" {
  identifier           = "${var.name_prefix}-writer"
  cluster_identifier   = aws_rds_cluster.main.id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.main.engine
  engine_version       = aws_rds_cluster.main.engine_version
  db_subnet_group_name = aws_db_subnet_group.aurora.name
  publicly_accessible  = false

  tags = local.tags
}
