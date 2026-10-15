# Target group + host-header rules on the SHARED ALB. Does not create an ALB.
#
# HTTP rule is required because CloudFront→ALB commonly uses http-only
# (matching production). Without an HTTP host rule, default redirect-to-HTTPS
# would miss the staging target group. HTTPS rule covers direct TLS clients.

resource "aws_lb_target_group" "api" {
  name        = "${var.name_prefix}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.shared_vpc_id
  target_type = "ip"

  health_check {
    path                = "/health/live"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "staging_host_https" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = [var.hostname]
    }
  }

  tags = local.tags

  lifecycle {
    precondition {
      condition     = var.hostname != "dwel.rbitfinancial.com"
      error_message = "Refusing to attach staging rule to production hostname."
    }
  }
}

resource "aws_lb_listener_rule" "staging_host_http" {
  listener_arn = data.aws_lb_listener.http.arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = [var.hostname]
    }
  }

  tags = local.tags
}
