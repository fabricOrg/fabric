locals {
  testing_edge_origins = {
    api = {
      domain_name = trimprefix(aws_apigatewayv2_api.testing.api_endpoint, "https://")
      comment     = "Fabric testing API edge"
    }
    dashboard = {
      domain_name = trimprefix(aws_apigatewayv2_api.dashboard_testing.api_endpoint, "https://")
      comment     = "Fabric testing dashboard edge"
    }
    admin_console = {
      domain_name = trimprefix(aws_apigatewayv2_api.admin_console_testing.api_endpoint, "https://")
      comment     = "Fabric testing admin console edge"
    }
  }
}

resource "aws_wafv2_web_acl" "testing_edge" {
  provider = aws.useast1

  name        = "fabric-testing-edge"
  description = "Production-like testing edge protection for public CloudFront/API Gateway surfaces."
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-by-ip"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = 1000
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "fabric-testing-rate-limit-by-ip"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "fabric-testing-aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "fabric-testing-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "fabric-testing-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "fabric-testing-edge"
    sampled_requests_enabled   = true
  }
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "testing_edge" {
  for_each = local.testing_edge_origins

  enabled         = true
  is_ipv6_enabled = true
  comment         = each.value.comment
  price_class     = "PriceClass_All"
  web_acl_id      = aws_wafv2_web_acl.testing_edge.arn

  origin {
    domain_name = each.value.domain_name
    origin_id   = "api-gateway-${each.key}"

    custom_header {
      name  = "x-fabric-edge-secret"
      value = random_password.edge_shared_secret.result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "api-gateway-${each.key}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
