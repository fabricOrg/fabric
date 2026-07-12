data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "fabric-testing-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_secret_access" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      aws_secretsmanager_secret.database_admin.arn,
      aws_secretsmanager_secret.database_owner.arn,
      aws_secretsmanager_secret.database_runtime.arn,
      aws_secretsmanager_secret.database_provisioner.arn,
      aws_secretsmanager_secret.operator_token.arn,
      aws_secretsmanager_secret.webhook_ingress_token.arn,
      aws_secretsmanager_secret.bff_internal_token.arn,
      aws_secretsmanager_secret.dashboard_cookie_password.arn,
      aws_secretsmanager_secret.dashboard_workos.arn,
      aws_secretsmanager_secret.tenant_token_secret.arn,
      aws_secretsmanager_secret.arkesel_sms.arn,
      aws_secretsmanager_secret.paystack.arn,
      aws_secretsmanager_secret.workos_webhook.arn,
      aws_secretsmanager_secret.edge_shared_secret.arn,
      aws_secretsmanager_secret.admin_console_cookie_password.arn,
      aws_secretsmanager_secret.admin_console_workos.arn,
      aws_secretsmanager_secret.dev_portal_cookie_password.arn,
      aws_secretsmanager_secret.dev_portal_workos.arn,
      # Both were injected into the api task definition without ever being granted here, so the task
      # could not have read them — an ECS task fails to START on a secret it cannot fetch.
      aws_secretsmanager_secret.virtual_phone_encryption_key.arn,
      aws_secretsmanager_secret.pii_master_key.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ecs_secret_access" {
  name   = "fabric-testing-database-secrets"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_secret_access.json
}

resource "aws_iam_role" "api_task" {
  name               = "fabric-testing-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_ecs_cluster" "testing" {
  name = "fabric-testing"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/fabric/testing/api"
  retention_in_days = 90
}

locals {
  bootstrap_image = "${aws_ecr_repository.api.repository_url}:bootstrap"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "fabric-api-testing"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = local.bootstrap_image
      essential = true
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [
        {
          name  = "PORT"
          value = "3000"
        },
        # BullMQ send queue (finding 7). Endpoint is infra topology, not a secret. NOTE: this
        # task-def change reaches the RUNNING service only via a deploy (the workflow grafts the
        # real image) — never `update-service` onto the raw terraform revision (bootstrap image).
        {
          name  = "REDIS_QUEUE_URL"
          value = "redis://${aws_elasticache_replication_group.redis_queue.primary_endpoint_address}:6379"
        },
        {
          name  = "REDIS_CACHE_URL"
          value = "redis://${aws_elasticache_replication_group.redis_cache.primary_endpoint_address}:6379"
        },
        {
          name  = "SMS_PROVIDER"
          value = var.testing_sms_provider
        },
        {
          name  = "ARKESEL_SANDBOX"
          value = tostring(var.testing_arkesel_sandbox)
        },
        {
          name  = "ARKESEL_DLR_CALLBACK_URL"
          value = "https://${aws_cloudfront_distribution.testing_edge["api"].domain_name}/webhooks/dlr/arkesel-sms"
        },
        {
          name  = "DASHBOARD_BASE_URL"
          value = "https://${aws_cloudfront_distribution.testing_edge["dashboard"].domain_name}"
        },
        # ADR-0002: self-serve sandbox sign-up is ON in the testing environment (fail closed
        # elsewhere — the api treats anything but "true" as OFF).
        {
          name  = "SELF_SERVE_SIGNUP_ENABLED"
          value = "true"
        },
      ]
      secrets = [
        {
          name      = "DATABASE_URL_APP"
          valueFrom = "${aws_secretsmanager_secret.database_runtime.arn}:DATABASE_URL_APP::"
        },
        {
          name      = "OPERATOR_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.operator_token.arn}:OPERATOR_TOKEN::"
        },
        {
          name      = "WEBHOOK_INGRESS_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.webhook_ingress_token.arn}:WEBHOOK_INGRESS_TOKEN::"
        },
        {
          name      = "BFF_INTERNAL_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.bff_internal_token.arn}:BFF_INTERNAL_TOKEN::"
        },
        # ADR-0003: signs/verifies the short-lived bfft_ tenant tokens the BFFs use on /v1/*.
        {
          name      = "TENANT_TOKEN_SECRET"
          valueFrom = "${aws_secretsmanager_secret.tenant_token_secret.arn}:TENANT_TOKEN_SECRET::"
        },
        {
          name      = "DATABASE_URL_PROVISIONER"
          valueFrom = "${aws_secretsmanager_secret.database_provisioner.arn}:DATABASE_URL_PROVISIONER::"
        },
        # StaffService + MembersService send WorkOS invitations from the api (org-less staff invite,
        # org member invite). createWorkosClient needs only the API key. Reuses the shared WorkOS
        # secret populated for the dashboard.
        {
          name      = "WORKOS_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.dashboard_workos.arn}:WORKOS_API_KEY::"
        },
        {
          name      = "WORKOS_WEBHOOK_SECRET"
          valueFrom = "${aws_secretsmanager_secret.workos_webhook.arn}:WORKOS_WEBHOOK_SECRET::"
        },
        {
          name      = "PAYSTACK_SECRET_KEY"
          valueFrom = "${aws_secretsmanager_secret.paystack.arn}:PAYSTACK_SECRET_KEY::"
        },
        {
          name      = "ARKESEL_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.arkesel_sms.arn}:ARKESEL_API_KEY::"
        },
        {
          name      = "ARKESEL_SENDER_ID"
          valueFrom = "${aws_secretsmanager_secret.arkesel_sms.arn}:ARKESEL_SENDER_ID::"
        },
        {
          name      = "VIRTUAL_PHONE_ENCRYPTION_KEY"
          valueFrom = "${aws_secretsmanager_secret.virtual_phone_encryption_key.arn}:VIRTUAL_PHONE_ENCRYPTION_KEY::"
        },
        {
          name      = "PII_MASTER_KEY"
          valueFrom = "${aws_secretsmanager_secret.pii_master_key.arn}:PII_MASTER_KEY::"
        },
        {
          name      = "EDGE_SHARED_SECRET"
          valueFrom = "${aws_secretsmanager_secret.edge_shared_secret.arn}:EDGE_SHARED_SECRET::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
      healthCheck = {
        command = [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"",
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    },
  ])

  depends_on = [
    aws_secretsmanager_secret_version.database_runtime,
    aws_secretsmanager_secret_version.database_provisioner,
    aws_secretsmanager_secret_version.operator_token,
    aws_secretsmanager_secret_version.webhook_ingress_token,
    aws_secretsmanager_secret_version.bff_internal_token,
    aws_secretsmanager_secret_version.tenant_token_secret,
    aws_secretsmanager_secret_version.dashboard_workos,
    aws_secretsmanager_secret_version.workos_webhook,
    aws_secretsmanager_secret_version.paystack,
    aws_secretsmanager_secret_version.arkesel_sms,
    aws_secretsmanager_secret_version.edge_shared_secret,
  ]
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "fabric-api-testing-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "migration"
      image     = local.bootstrap_image
      essential = true
      command = [
        "node",
        "node_modules/@app/db/dist/cloud-migrate.js",
      ]
      secrets = [
        {
          name      = "DATABASE_URL_ADMIN"
          valueFrom = "${aws_secretsmanager_secret.database_admin.arn}:DATABASE_URL_ADMIN::"
        },
        {
          name      = "DATABASE_URL_OWNER"
          valueFrom = "${aws_secretsmanager_secret.database_owner.arn}:DATABASE_URL_OWNER::"
        },
        {
          name      = "DATABASE_URL_APP"
          valueFrom = "${aws_secretsmanager_secret.database_runtime.arn}:DATABASE_URL_APP::"
        },
        {
          name      = "DATABASE_URL_PROVISIONER"
          valueFrom = "${aws_secretsmanager_secret.database_provisioner.arn}:DATABASE_URL_PROVISIONER::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "migration"
        }
      }
    },
  ])

  depends_on = [
    aws_secretsmanager_secret_version.database_admin,
    aws_secretsmanager_secret_version.database_owner,
    aws_secretsmanager_secret_version.database_runtime,
    aws_secretsmanager_secret_version.database_provisioner,
  ]
}

resource "aws_service_discovery_private_dns_namespace" "testing" {
  name = "testing.fabric.internal"
  vpc  = aws_vpc.testing.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"

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

resource "aws_ecs_service" "api" {
  name            = "fabric-api-testing"
  cluster         = aws_ecs_cluster.testing.id
  task_definition = aws_ecs_task_definition.api.arn
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
    registry_arn   = aws_service_discovery_service.api.arn
    container_name = "api"
    container_port = 3000
  }

  lifecycle {
    ignore_changes = [
      desired_count,
      task_definition,
    ]
  }
}
