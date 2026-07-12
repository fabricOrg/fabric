####################################################################################################
# Fabric dev-portal testing runtime. Same topology as the dashboard (dashboard.tf): a private
# Fargate ECS service behind its own API Gateway HTTP API + VPC Link, sharing the testing cluster,
# VPC, and ECS-tasks security group. No load balancer.
#
# Org-scoped like the dashboard (a developer is a tenant member): carries WORKOS_ORGANIZATION_ID and
# reuses the dashboard's Fabric API key (same testing tenant) for its BFF calls. Reuses the SHARED
# WorkOS app; register this stack's <url>/auth/callback + <url>/login in that app's Redirects.
####################################################################################################

resource "aws_ecr_repository" "dev_portal" {
  name                 = "app/dev-portal"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "dev_portal" {
  repository = aws_ecr_repository.dev_portal.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 20 tagged images"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
        action       = { type = "expire" }
      }
    ]
  })
}

resource "aws_iam_role" "dev_portal_task" {
  name               = "fabric-testing-dev-portal-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_cloudwatch_log_group" "dev_portal" {
  name              = "/fabric/testing/dev-portal"
  retention_in_days = 90
}

locals {
  dev_portal_bootstrap_image = "${aws_ecr_repository.dev_portal.repository_url}:bootstrap"
}

resource "aws_ecs_task_definition" "dev_portal" {
  family                   = "fabric-dev-portal-testing"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.dev_portal_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "dev-portal"
      image     = local.dev_portal_bootstrap_image
      essential = true
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [
        { name = "PORT", value = "3000" },
        { name = "API_BASE_URL", value = "https://${aws_cloudfront_distribution.testing_edge["api"].domain_name}" },
        { name = "DASHBOARD_BASE_URL", value = "https://${aws_cloudfront_distribution.testing_edge["dashboard"].domain_name}" },
        # The portal's OWN public origin — auth redirect/logout URIs + the trusted-origin check derive
        # from this (behind API Gateway the container sees the internal host as request.url).
        { name = "DEV_PORTAL_BASE_URL", value = "https://${aws_cloudfront_distribution.testing_edge["dev_portal"].domain_name}" },
      ]
      secrets = [
        {
          name      = "BFF_INTERNAL_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.bff_internal_token.arn}:BFF_INTERNAL_TOKEN::"
        },
        {
          name      = "WORKOS_COOKIE_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.dev_portal_cookie_password.arn}:WORKOS_COOKIE_PASSWORD::"
        },
        {
          name      = "WORKOS_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.dev_portal_workos.arn}:WORKOS_API_KEY::"
        },
        {
          name      = "WORKOS_CLIENT_ID"
          valueFrom = "${aws_secretsmanager_secret.dev_portal_workos.arn}:WORKOS_CLIENT_ID::"
        },
        {
          name      = "WORKOS_ORGANIZATION_ID"
          valueFrom = "${aws_secretsmanager_secret.dev_portal_workos.arn}:WORKOS_ORGANIZATION_ID::"
        },
        {
          name      = "EDGE_SHARED_SECRET"
          valueFrom = "${aws_secretsmanager_secret.edge_shared_secret.arn}:EDGE_SHARED_SECRET::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.dev_portal.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "dev-portal"
        }
      }
      healthCheck = {
        command = [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:3000/healthz').then(()=>process.exit(0)).catch(()=>process.exit(1))\"",
        ]
        interval    = 30
        timeout     = 10
        retries     = 5
        startPeriod = 60
      }
    },
  ])

  depends_on = [
    aws_secretsmanager_secret_version.bff_internal_token,
    aws_secretsmanager_secret_version.dev_portal_cookie_password,
    aws_secretsmanager_secret_version.dev_portal_workos,
    aws_secretsmanager_secret_version.edge_shared_secret,
  ]
}

resource "aws_service_discovery_service" "dev_portal" {
  name = "dev-portal"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.testing.id

    dns_records {
      ttl  = 10
      type = "SRV"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_service" "dev_portal" {
  name            = "fabric-dev-portal-testing"
  cluster         = aws_ecs_cluster.testing.id
  task_definition = aws_ecs_task_definition.dev_portal.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.private : subnet.id]
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.dev_portal.arn
    container_name = "dev-portal"
    container_port = 3000
  }

  lifecycle {
    ignore_changes = [
      desired_count,
      task_definition,
    ]
  }
}

resource "aws_apigatewayv2_api" "dev_portal_testing" {
  name          = "fabric-dev-portal-testing"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "dev_portal" {
  api_id                 = aws_apigatewayv2_api.dev_portal_testing.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = aws_service_discovery_service.dev_portal.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.testing.id
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "dev_portal_default" {
  api_id    = aws_apigatewayv2_api.dev_portal_testing.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.dev_portal.id}"
}

resource "aws_cloudwatch_log_group" "dev_portal_api_gateway" {
  name              = "/fabric/testing/dev-portal-gateway"
  retention_in_days = 90
}

resource "aws_apigatewayv2_stage" "dev_portal_default" {
  api_id      = aws_apigatewayv2_api.dev_portal_testing.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.dev_portal_api_gateway.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

output "testing_dev_portal_url" {
  description = "Managed HTTPS endpoint for the testing dev-portal. Register <this>/auth/callback + <this>/login in the shared WorkOS app before first login."
  value       = aws_apigatewayv2_api.dev_portal_testing.api_endpoint
}

output "ecr_dev_portal_repository_url" {
  value = aws_ecr_repository.dev_portal.repository_url
}

output "ecs_dev_portal_service_name" {
  value = aws_ecs_service.dev_portal.name
}

output "ecs_dev_portal_task_definition_family" {
  value = aws_ecs_task_definition.dev_portal.family
}
