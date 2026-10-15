/**
 * Staging CloudFront — optional (enable_cloudfront=true).
 *
 * Host-header strategy (explicit):
 * - Viewer alias: dwel-staging.rbitfinancial.com
 * - ALB origin uses http-only (matches production CF pattern) so TLS on ALB
 *   does not need a staging SAN on the shared cert.
 * - Origin request policy AllViewerExceptHostHeader would send ALB DNS as Host
 *   and MISS the host-based listener rule → production default TG. Forbidden.
 * - Instead: custom origin request policy that forwards viewer Host + auth/
 *   cookies/query, paired with HTTP listener host rule on the shared ALB.
 * - Cache policy CachingDisabled for /v1/* and /health* (no auth response cache).
 * - Default behavior: S3 web via OAC; SPA 403/404 → /index.html.
 */

locals {
  cloudfront_enabled = var.enable_cloudfront
}

resource "aws_cloudfront_origin_access_control" "web" {
  count = local.cloudfront_enabled ? 1 : 0

  name                              = "${var.name_prefix}-web-oac"
  description                       = "OAC for Dwel staging web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_request_policy" "alb_forward_viewer_host" {
  count = local.cloudfront_enabled ? 1 : 0

  name    = "${var.name_prefix}-alb-viewer-host"
  comment = "Forward viewer Host so shared ALB host rule matches staging, not prod default TG."

  cookies_config {
    cookie_behavior = "all"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "Host",
        "Authorization",
        "Origin",
        "Referer",
        "Accept",
        "Content-Type",
        "X-Requested-With",
      ]
    }
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_cache_policy" "api_disabled" {
  count = local.cloudfront_enabled ? 1 : 0

  name        = "${var.name_prefix}-api-no-cache"
  comment     = "Disable caching for authenticated API paths"
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

resource "aws_s3_bucket_policy" "web_oac" {
  count  = local.cloudfront_enabled ? 1 : 0
  bucket = aws_s3_bucket.web.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.staging[0].arn
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.web.arn,
          "${aws_s3_bucket.web.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })
}

resource "aws_cloudfront_distribution" "staging" {
  count = local.cloudfront_enabled ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Dwel staging — ${var.hostname}"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = [var.hostname]
  tags                = local.tags

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web[0].id
  }

  origin {
    domain_name = local.alb_dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Defense-in-depth marker (ALB primary match remains Host header).
    custom_header {
      name  = "X-Rbit-Env"
      value = "staging"
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed CachingOptimized
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  ordered_cache_behavior {
    path_pattern             = "/v1/*"
    target_origin_id         = "alb-api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.api_disabled[0].id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.alb_forward_viewer_host[0].id
  }

  ordered_cache_behavior {
    path_pattern             = "/health*"
    target_origin_id         = "alb-api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.api_disabled[0].id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.alb_forward_viewer_host[0].id
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn_us_east_1
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = var.acm_certificate_arn_us_east_1 != ""
      error_message = "enable_cloudfront=true requires acm_certificate_arn_us_east_1 (us-east-1)."
    }
    precondition {
      condition     = !contains(var.hostname == null ? [] : [var.hostname], "dwel.rbitfinancial.com")
      error_message = "CloudFront must not alias production hostname."
    }
  }
}
