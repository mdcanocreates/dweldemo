# App — inbound only from the shared ALB security groups
resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  vpc_id      = var.shared_vpc_id
  description = "Dwel staging API inbound from shared ALB"

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = local.alb_sg_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.name_prefix}-app" })
}

# Aurora — inbound from staging app SG only
resource "aws_security_group" "aurora" {
  name        = "${var.name_prefix}-aurora"
  vpc_id      = var.shared_vpc_id
  description = "Dwel staging Aurora inbound from staging app"

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.name_prefix}-aurora" })
}
