resource "aws_sns_topic" "alerts" {
  name = "fabric-testing-alerts"
}

resource "aws_sns_topic" "global_alerts" {
  provider = aws.useast1

  name = "fabric-testing-global-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count = var.testing_alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.testing_alarm_email
}

resource "aws_sns_topic_subscription" "global_alerts_email" {
  provider = aws.useast1
  count    = var.testing_alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.global_alerts.arn
  protocol  = "email"
  endpoint  = var.testing_alarm_email
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "fabric-testing-database-high-cpu"
  alarm_description   = "Testing PostgreSQL CPU exceeded 80 percent for ten minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "fabric-testing-database-low-storage"
  alarm_description   = "Testing PostgreSQL has less than 2 GiB free storage."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  alarm_name          = "fabric-testing-api-gateway-5xx"
  alarm_description   = "The testing API returned at least five server errors in five minutes."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = aws_apigatewayv2_api.testing.id
    Stage = aws_apigatewayv2_stage.default.name
  }
}

resource "aws_cloudwatch_metric_alarm" "dashboard_gateway_5xx" {
  alarm_name          = "fabric-testing-dashboard-gateway-5xx"
  alarm_description   = "The testing dashboard returned at least five server errors in five minutes."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = aws_apigatewayv2_api.dashboard_testing.id
    Stage = aws_apigatewayv2_stage.dashboard_default.name
  }
}

resource "aws_cloudwatch_metric_alarm" "admin_console_gateway_5xx" {
  alarm_name          = "fabric-testing-admin-console-gateway-5xx"
  alarm_description   = "The testing admin console returned at least five server errors in five minutes."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = aws_apigatewayv2_api.admin_console_testing.id
    Stage = aws_apigatewayv2_stage.admin_console_default.name
  }
}

resource "aws_cloudwatch_metric_alarm" "waf_blocked_requests" {
  provider = aws.useast1

  alarm_name          = "fabric-testing-waf-blocked-requests"
  alarm_description   = "Testing WAF blocked at least 25 requests in five minutes."
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 25
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.global_alerts.arn]

  dimensions = {
    Region = "CloudFront"
    Rule   = "ALL"
    WebACL = aws_wafv2_web_acl.testing_edge.name
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_service_cpu" {
  for_each = local.ecs_autoscaled_services

  alarm_name          = "fabric-testing-${replace(each.key, "_", "-")}-ecs-high-cpu"
  alarm_description   = "Testing ${replace(each.key, "_", "-")} ECS CPU exceeded 85 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.testing.name
    ServiceName = each.value.name
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_service_memory" {
  for_each = local.ecs_autoscaled_services

  alarm_name          = "fabric-testing-${replace(each.key, "_", "-")}-ecs-high-memory"
  alarm_description   = "Testing ${replace(each.key, "_", "-")} ECS memory exceeded 90 percent for ten minutes."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 90
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.testing.name
    ServiceName = each.value.name
  }
}

resource "aws_cloudwatch_log_metric_filter" "webhook_delivery_alerts" {
  for_each = {
    dead           = "webhook delivery sweep produced"
    worker_failure = "webhook delivery sweep failed"
    oldest_pending = "webhook delivery oldest pending age"
    retry_volume   = "webhook delivery retry volume"
  }

  name           = "fabric-testing-webhook-${replace(each.key, "_", "-")}"
  pattern        = each.value
  log_group_name = aws_cloudwatch_log_group.api.name

  metric_transformation {
    name      = "Webhook${replace(title(each.key), "_", "")}"
    namespace = "Fabric/Webhooks"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "webhook_delivery_alerts" {
  for_each = toset(["dead", "worker_failure", "oldest_pending", "retry_volume"])

  alarm_name          = "fabric-testing-webhook-${replace(each.key, "_", "-")}"
  alarm_description   = "Testing webhook delivery raised ${replace(each.key, "_", " ")}."
  namespace           = "Fabric/Webhooks"
  metric_name         = "Webhook${replace(title(each.key), "_", "")}"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
