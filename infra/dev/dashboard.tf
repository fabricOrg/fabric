####################################################################################################
# Fabric customer dashboard — testing runtime. Same topology as the api (ecs.tf/gateway.tf): a
# Fargate ECS service behind its own API Gateway HTTP API + VPC Link, sharing the testing cluster,
# VPC, and ECS-tasks security group (already opens 3000 from the shared VPC Link SG). No load
# balancer, no NAT — same cost stance as the rest of this stack.
#
# WORKOS_ORGANIZATION_ID / WORKOS_REDIRECT_URI / WORKOS_LOGOUT_REDIRECT_URI / DASHBOARD_API_KEY are
# only knowable AFTER this stack is applied (they depend on this API's real URL + a tenant provisioned
# against the testing database) — see database.tf's placeholder secrets and
# docs/PI-3/PATH-TO-TESTING.md for the exact order of operations.
####################################################################################################

resource "aws_ecr_repository" "dashboard" {
  name                 = "app/dashboard"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "dashboard" {
  repository = aws_ecr_repository.dashboard.name
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

resource "aws_iam_role" "dashboard_task" {
  name               = "fabric-testing-dashboard-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_cloudwatch_log_group" "dashboard" {
  name              = "/fabric/testing/dashboard"
  retention_in_days = 14
}

locals {
  dashboard_bootstrap_image = "${aws_ecr_repository.dashboard.repository_url}:bootstrap"
}

resource "aws_ecs_task_definition" "dashboard" {
  family                   = "fabric-dashboard-testing"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.dashboard_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "dashboard"
      image     = local.dashboard_bootstrap_image
      essential = true
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [
        { name = "PORT", value = "3000" },
        # The api's public HTTPS endpoint (API Gateway) — simplest path for the BFF's server-side
        # fetches; avoids depending on Cloud Map SRV resolution from a second, unrelated service.
        { name = "API_BASE_URL", value = aws_apigatewayv2_api.testing.api_endpoint },
        # The dashboard's OWN public origin. Behind API Gateway + VPC Link the container sees the
        # internal host as request.url, so auth redirects + the trusted-origin check must use this.
        { name = "DASHBOARD_BASE_URL", value = aws_apigatewayv2_api.dashboard_testing.api_endpoint },
      ]
      secrets = [
        {
          name      = "DASHBOARD_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.dashboard_api_key.arn}:DASHBOARD_API_KEY::"
        },
        {
          name      = "BFF_INTERNAL_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.bff_internal_token.arn}:BFF_INTERNAL_TOKEN::"
        },
        {
          name      = "WORKOS_COOKIE_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.dashboard_cookie_password.arn}:WORKOS_COOKIE_PASSWORD::"
        },
        {
          name      = "WORKOS_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_API_KEY::"
        },
        {
          name      = "WORKOS_CLIENT_ID"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_CLIENT_ID::"
        },
        {
          name      = "WORKOS_ORGANIZATION_ID"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_ORGANIZATION_ID::"
        },
        {
          name      = "WORKOS_REDIRECT_URI"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_REDIRECT_URI::"
        },
        {
          name      = "WORKOS_LOGOUT_REDIRECT_URI"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_LOGOUT_REDIRECT_URI::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.dashboard.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "dashboard"
        }
      }
      healthCheck = {
        # No /health route on the dashboard; the public /login page returns 200 unauthenticated.
        command = [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"",
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    },
  ])

  depends_on = [
    aws_secretsmanager_secret_version.dashboard_api_key,
    aws_secretsmanager_secret_version.bff_internal_token,
    aws_secretsmanager_secret_version.dashboard_cookie_password,
    aws_secretsmanager_secret_version.dashboard_workos,
  ]
}

resource "aws_service_discovery_service" "dashboard" {
  name = "dashboard"

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

resource "aws_ecs_service" "dashboard" {
  name            = "fabric-dashboard-testing"
  cluster         = aws_ecs_cluster.testing.id
  task_definition = aws_ecs_task_definition.dashboard.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.dashboard.arn
    container_name = "dashboard"
    container_port = 3000
  }

  lifecycle {
    ignore_changes = [
      desired_count,
      task_definition,
    ]
  }
}

# Separate HTTP API (own public URL) reusing the same VPC Link — the dashboard is a distinct public
# surface from the api, not a route under it.
resource "aws_apigatewayv2_api" "dashboard_testing" {
  name          = "fabric-dashboard-testing"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "dashboard" {
  api_id                 = aws_apigatewayv2_api.dashboard_testing.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = aws_service_discovery_service.dashboard.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.testing.id
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "dashboard_default" {
  api_id    = aws_apigatewayv2_api.dashboard_testing.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.dashboard.id}"
}

resource "aws_cloudwatch_log_group" "dashboard_api_gateway" {
  name              = "/fabric/testing/dashboard-gateway"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "dashboard_default" {
  api_id      = aws_apigatewayv2_api.dashboard_testing.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.dashboard_api_gateway.arn
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

output "testing_dashboard_url" {
  description = "Managed HTTPS endpoint for the testing dashboard. Register <this>/auth/callback in WorkOS before first login."
  value       = aws_apigatewayv2_api.dashboard_testing.api_endpoint
}

output "ecr_dashboard_repository_url" {
  value = aws_ecr_repository.dashboard.repository_url
}

output "ecs_dashboard_service_name" {
  value = aws_ecs_service.dashboard.name
}

output "ecs_dashboard_task_definition_family" {
  value = aws_ecs_task_definition.dashboard.family
}
