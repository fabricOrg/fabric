####################################################################################################
# Fabric admin-console (staff) — testing runtime. Same topology as the dashboard (dashboard.tf): a
# Fargate ECS service behind its own API Gateway HTTP API + VPC Link, sharing the testing cluster,
# VPC, and ECS-tasks security group. No load balancer, no NAT — same cost stance as the rest of the
# stack.
#
# Staff aren't org-scoped, so there's NO WORKOS_ORGANIZATION_ID and no tenant API key: the console
# reaches the api only as the BFF (BFF_INTERNAL_TOKEN). It reuses the SHARED WorkOS app, so register
# this stack's <url>/auth/callback + <url>/login in that app's Redirects (see database.tf).
####################################################################################################

resource "aws_ecr_repository" "admin_console" {
  name                 = "app/admin-console"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "admin_console" {
  repository = aws_ecr_repository.admin_console.name
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

resource "aws_iam_role" "admin_console_task" {
  name               = "fabric-testing-admin-console-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_cloudwatch_log_group" "admin_console" {
  name              = "/fabric/testing/admin-console"
  retention_in_days = 14
}

locals {
  admin_console_bootstrap_image = "${aws_ecr_repository.admin_console.repository_url}:bootstrap"
}

resource "aws_ecs_task_definition" "admin_console" {
  family                   = "fabric-admin-console-testing"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.admin_console_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "admin-console"
      image     = local.admin_console_bootstrap_image
      essential = true
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [
        { name = "PORT", value = "3000" },
        { name = "API_BASE_URL", value = aws_apigatewayv2_api.testing.api_endpoint },
        # The console's OWN public origin — auth redirect/logout URIs + the trusted-origin check derive
        # from this (behind API Gateway the container sees the internal host as request.url).
        { name = "ADMIN_CONSOLE_BASE_URL", value = aws_apigatewayv2_api.admin_console_testing.api_endpoint },
      ]
      secrets = [
        {
          name      = "BFF_INTERNAL_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.bff_internal_token.arn}:BFF_INTERNAL_TOKEN::"
        },
        {
          name      = "WORKOS_COOKIE_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.admin_console_cookie_password.arn}:WORKOS_COOKIE_PASSWORD::"
        },
        {
          name      = "WORKOS_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.admin_console_workos.arn}:WORKOS_API_KEY::"
        },
        {
          name      = "WORKOS_CLIENT_ID"
          valueFrom = "${aws_secretsmanager_secret.admin_console_workos.arn}:WORKOS_CLIENT_ID::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.admin_console.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "admin-console"
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
    aws_secretsmanager_secret_version.admin_console_cookie_password,
    aws_secretsmanager_secret_version.admin_console_workos,
  ]
}

resource "aws_service_discovery_service" "admin_console" {
  name = "admin-console"

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

resource "aws_ecs_service" "admin_console" {
  name            = "fabric-admin-console-testing"
  cluster         = aws_ecs_cluster.testing.id
  task_definition = aws_ecs_task_definition.admin_console.arn
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
    registry_arn   = aws_service_discovery_service.admin_console.arn
    container_name = "admin-console"
    container_port = 3000
  }

  lifecycle {
    ignore_changes = [
      desired_count,
      task_definition,
    ]
  }
}

resource "aws_apigatewayv2_api" "admin_console_testing" {
  name          = "fabric-admin-console-testing"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "admin_console" {
  api_id                 = aws_apigatewayv2_api.admin_console_testing.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = aws_service_discovery_service.admin_console.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.testing.id
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "admin_console_default" {
  api_id    = aws_apigatewayv2_api.admin_console_testing.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.admin_console.id}"
}

resource "aws_cloudwatch_log_group" "admin_console_api_gateway" {
  name              = "/fabric/testing/admin-console-gateway"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "admin_console_default" {
  api_id      = aws_apigatewayv2_api.admin_console_testing.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.admin_console_api_gateway.arn
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

output "testing_admin_console_url" {
  description = "Managed HTTPS endpoint for the testing admin-console. Register <this>/auth/callback + <this>/login in the shared WorkOS app before first login."
  value       = aws_apigatewayv2_api.admin_console_testing.api_endpoint
}

output "ecr_admin_console_repository_url" {
  value = aws_ecr_repository.admin_console.repository_url
}

output "ecs_admin_console_service_name" {
  value = aws_ecs_service.admin_console.name
}

output "ecs_admin_console_task_definition_family" {
  value = aws_ecs_task_definition.admin_console.family
}
