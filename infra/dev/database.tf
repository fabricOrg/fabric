ephemeral "random_password" "database_admin" {
  length  = 40
  special = false
}

ephemeral "random_password" "database_owner" {
  length  = 40
  special = false
}

ephemeral "random_password" "database_runtime" {
  length  = 40
  special = false
}

ephemeral "random_password" "operator_token" {
  length  = 48
  special = false
}

ephemeral "random_password" "webhook_ingress_token" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "testing" {
  name       = "fabric-testing"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "postgres" {
  identifier = "fabric-testing-postgres"

  engine         = "postgres"
  engine_version = "16.9"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "app"
  username = "app_admin"

  password_wo         = ephemeral.random_password.database_admin.result
  password_wo_version = 1

  db_subnet_group_name   = aws_db_subnet_group.testing.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:03:00-sun:04:00"

  auto_minor_version_upgrade = true
  apply_immediately          = true
  deletion_protection        = false
  skip_final_snapshot        = true
  copy_tags_to_snapshot      = true

  performance_insights_enabled = false
  monitoring_interval          = 0
}

resource "aws_secretsmanager_secret" "database_admin" {
  name                    = "fabric/testing/database/admin"
  description             = "Deployment-only PostgreSQL administrator URL."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret" "database_owner" {
  name                    = "fabric/testing/database/owner"
  description             = "PostgreSQL migration-owner URL."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret" "database_runtime" {
  name                    = "fabric/testing/database/runtime"
  description             = "RLS-constrained PostgreSQL runtime URL."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret" "operator_token" {
  name                    = "fabric/testing/operator-token"
  description             = "Testing API-key management token."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret" "webhook_ingress_token" {
  name                    = "fabric/testing/webhook-ingress-token"
  description             = "Testing fake-provider webhook ingress token."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_admin" {
  secret_id = aws_secretsmanager_secret.database_admin.id
  secret_string_wo = jsonencode({
    DATABASE_URL_ADMIN = "postgresql://app_admin:${urlencode(ephemeral.random_password.database_admin.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "database_owner" {
  secret_id = aws_secretsmanager_secret.database_owner.id
  secret_string_wo = jsonencode({
    DATABASE_URL_OWNER = "postgresql://app_migrator:${urlencode(ephemeral.random_password.database_owner.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "database_runtime" {
  secret_id = aws_secretsmanager_secret.database_runtime.id
  secret_string_wo = jsonencode({
    DATABASE_URL_APP = "postgresql://app_runtime:${urlencode(ephemeral.random_password.database_runtime.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "operator_token" {
  secret_id = aws_secretsmanager_secret.operator_token.id
  secret_string_wo = jsonencode({
    OPERATOR_TOKEN = ephemeral.random_password.operator_token.result
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "webhook_ingress_token" {
  secret_id = aws_secretsmanager_secret.webhook_ingress_token.id
  secret_string_wo = jsonencode({
    WEBHOOK_INGRESS_TOKEN = ephemeral.random_password.webhook_ingress_token.result
  })
  secret_string_wo_version = 1
}
