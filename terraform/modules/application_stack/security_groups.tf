# ALB — accepts HTTPS from anywhere, HTTP (redirect or forward per ACM)
resource "aws_security_group" "alb" {
  name        = "rbit-${var.environment}-alb"
  vpc_id      = var.vpc_id
  description = "ALB inbound"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "rbit-${var.environment}-alb"
    Environment = var.environment
  }
}

# App — accepts traffic from ALB only
resource "aws_security_group" "app" {
  name        = "rbit-${var.environment}-app"
  vpc_id      = var.vpc_id
  description = "App inbound from ALB"

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "rbit-${var.environment}-app"
    Environment = var.environment
  }
}

# Aurora — accepts from app only
resource "aws_security_group" "aurora" {
  name        = "rbit-${var.environment}-aurora"
  vpc_id      = var.vpc_id
  description = "Aurora inbound from app"

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

  tags = {
    Name        = "rbit-${var.environment}-aurora"
    Environment = var.environment
  }
}

# Redis — accepts from app only
resource "aws_security_group" "redis" {
  name        = "rbit-${var.environment}-redis"
  vpc_id      = var.vpc_id
  description = "Redis inbound from app"

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "rbit-${var.environment}-redis"
    Environment = var.environment
  }
}
