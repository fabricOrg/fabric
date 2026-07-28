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

ephemeral "random_password" "database_provisioner" {
  length  = 40
  special = false
}

ephemeral "random_password" "operator_token" {
  length  = 48
  special = false
}

ephemeral "random_password" "bff_internal_token" {
  length  = 48
  special = false
}

ephemeral "random_password" "tenant_token_secret" {
  length  = 48
  special = false
}

ephemeral "random_password" "dashboard_cookie_password" {
  length  = 40
  special = false
}

ephemeral "random_password" "webhook_ingress_token" {
  length  = 48
  special = false
}

ephemeral "random_password" "virtual_phone_encryption_key" {
  length  = 48
  special = false
}

# Wraps the per-subject DEKs in the PII vault (COMPLIANCE §5). It never encrypts PII directly — a
# platform-wide key cannot be destroyed for one person, which is the whole point of crypto-shredding.
# Losing this key makes ALL tenant PII permanently unreadable, so it is generated once and never
# rotated in place without a re-wrap migration.
ephemeral "random_password" "pii_master_key" {
  length  = 48
  special = false
}

resource "random_password" "edge_shared_secret" {
  length  = 48
  special = false
}

data "aws_iam_policy_document" "rds_monitoring_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_enhanced_monitoring" {
  name               = "fabric-testing-rds-enhanced-monitoring"
  assume_role_policy = data.aws_iam_policy_document.rds_monitoring_assume_role.json
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_subnet_group" "testing" {
  name       = "fabric-testing-private"
  subnet_ids = [for subnet in aws_subnet.database : subnet.id]

}

resource "aws_db_instance" "postgres" {
  identifier = "fabric-testing-postgres-private"

  engine = "postgres"
  # AWS auto_minor_version_upgrade has moved this to 16.13; keep the declared version in sync so
  # plans stay clean (not part of the dashboard change — pre-existing drift found while planning it).
  engine_version = "16.13"
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
  multi_az               = true

  backup_retention_period = 1
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:03:00-sun:04:00"

  auto_minor_version_upgrade = true
  apply_immediately          = false
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "fabric-testing-postgres-final-20260710"
  copy_tags_to_snapshot      = true

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_enhanced_monitoring.arn

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_secretsmanager_secret" "database_admin" {
  name                    = "fabric/testing/database/admin"
  description             = "Deployment-only PostgreSQL administrator URL."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "database_owner" {
  name                    = "fabric/testing/database/owner"
  description             = "PostgreSQL migration-owner URL."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "database_runtime" {
  name                    = "fabric/testing/database/runtime"
  description             = "RLS-constrained PostgreSQL runtime URL."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "database_provisioner" {
  name                    = "fabric/testing/database/provisioner"
  description             = "BYPASSRLS provisioning URL — cross-tenant identity/tenant provisioning (internal only)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "operator_token" {
  name                    = "fabric/testing/operator-token"
  description             = "Testing API-key management token."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "webhook_ingress_token" {
  name                    = "fabric/testing/webhook-ingress-token"
  description             = "Testing fake-provider webhook ingress token."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "virtual_phone_encryption_key" {
  name = "fabric/testing/virtual-phone-encryption-key"
  # SUPERSEDED by pii_master_key. Retained only so the one-off backfill can still read virtual
  # deliveries written under the old platform-wide key; delete once the ciphertext columns drop.
  description             = "DEPRECATED — legacy virtual-phone projection key. Backfill-only."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "pii_master_key" {
  name                    = "fabric/testing/pii-master-key"
  description             = "Master key wrapping per-subject DEKs in the PII vault. Destroying a DEK is how erasure works; losing THIS key makes all PII unreadable."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "arkesel_sms" {
  name                    = "fabric/testing/arkesel-sms"
  description             = "Arkesel SMS credentials and verified live-recipient allowlist for testing provider drills. Populate manually before selecting SMS_PROVIDER=arkesel."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "paystack" {
  name                    = "fabric/testing/paystack"
  description             = "Paystack sandbox/live key for testing payment drills. Populate manually before top-up drills."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "workos_webhook" {
  name                    = "fabric/testing/workos-webhook"
  description             = "WorkOS webhook signing secret for testing identity lifecycle drills. Populate from WorkOS."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "edge_shared_secret" {
  name                    = "fabric/testing/edge-shared-secret"
  description             = "Shared origin-lock secret injected by CloudFront and verified by the API."
  recovery_window_in_days = 7
}

# Shared between the api and dashboard tasks: dashboard's BFF routes present this to authenticate
# as the BFF against api's internal/* routes (BffTokenGuard). Symmetric — we generate it ourselves.
resource "aws_secretsmanager_secret" "bff_internal_token" {
  name                    = "fabric/testing/bff-internal-token"
  description             = "Shared token: dashboard BFF -> api internal/* routes."
  recovery_window_in_days = 7
}

# ADR-0003: api-only HMAC secret signing the short-lived bfft_ tenant tokens the BFFs use as their
# data-plane credential (replaces the manually minted dashboard API key). Symmetric — we generate it.
resource "aws_secretsmanager_secret" "tenant_token_secret" {
  name                    = "fabric/testing/tenant-token-secret"
  description             = "HMAC secret for BFF tenant tokens (ADR-0003). Read by the api only."
  recovery_window_in_days = 7
}

# Seals/verifies the dashboard's WorkOS session cookie. Symmetric, dashboard-only — we generate it.
resource "aws_secretsmanager_secret" "dashboard_cookie_password" {
  name                    = "fabric/testing/dashboard-cookie-password"
  description             = "Seals the dashboard's WorkOS session cookie."
  recovery_window_in_days = 7
}

# Real WorkOS credentials (API key, client ID, org ID, redirect URIs) come from the WorkOS
# dashboard, not Terraform. This resource is a CONTAINER: apply creates it with a placeholder value,
# then populate the real JSON once via the AWS console/CLI. Terraform ignores drift on the value so
# subsequent applies don't stomp what you set.
resource "aws_secretsmanager_secret" "dashboard_workos" {
  name                    = "fabric/testing/dashboard-workos"
  description             = "WorkOS AuthKit credentials for the dashboard (populate manually after apply)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "dashboard_workos" {
  secret_id = aws_secretsmanager_secret.dashboard_workos.id
  secret_string_wo = jsonencode({
    WORKOS_API_KEY             = "REPLACE_ME"
    WORKOS_CLIENT_ID           = "REPLACE_ME"
    WORKOS_ORGANIZATION_ID     = "REPLACE_ME"
    WORKOS_REDIRECT_URI        = "REPLACE_ME"
    WORKOS_LOGOUT_REDIRECT_URI = "REPLACE_ME"
  })
  secret_string_wo_version = 1

  lifecycle {
    ignore_changes = [secret_string_wo, secret_string_wo_version]
  }
}

resource "aws_secretsmanager_secret_version" "virtual_phone_encryption_key" {
  secret_id = aws_secretsmanager_secret.virtual_phone_encryption_key.id
  secret_string_wo = jsonencode({
    VIRTUAL_PHONE_ENCRYPTION_KEY = ephemeral.random_password.virtual_phone_encryption_key.result
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "pii_master_key" {
  secret_id = aws_secretsmanager_secret.pii_master_key.id
  secret_string_wo = jsonencode({
    PII_MASTER_KEY = ephemeral.random_password.pii_master_key.result
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "database_admin" {
  secret_id = aws_secretsmanager_secret.database_admin.id
  secret_string_wo = jsonencode({
    DATABASE_URL_ADMIN = "postgresql://app_admin:${urlencode(ephemeral.random_password.database_admin.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 2
}

resource "aws_secretsmanager_secret_version" "database_owner" {
  secret_id = aws_secretsmanager_secret.database_owner.id
  secret_string_wo = jsonencode({
    DATABASE_URL_OWNER = "postgresql://app_migrator:${urlencode(ephemeral.random_password.database_owner.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 2
}

resource "aws_secretsmanager_secret_version" "database_runtime" {
  secret_id = aws_secretsmanager_secret.database_runtime.id
  secret_string_wo = jsonencode({
    DATABASE_URL_APP = "postgresql://app_runtime:${urlencode(ephemeral.random_password.database_runtime.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 2
}

resource "aws_secretsmanager_secret_version" "database_provisioner" {
  secret_id = aws_secretsmanager_secret.database_provisioner.id
  secret_string_wo = jsonencode({
    DATABASE_URL_PROVISIONER = "postgresql://app_provisioner:${urlencode(ephemeral.random_password.database_provisioner.result)}@${aws_db_instance.postgres.address}:5432/app?sslmode=require"
  })
  secret_string_wo_version = 2
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

resource "aws_secretsmanager_secret_version" "arkesel_sms" {
  secret_id = aws_secretsmanager_secret.arkesel_sms.id
  secret_string_wo = jsonencode({
    ARKESEL_API_KEY = "REPLACE_ME"
  })
  secret_string_wo_version = 1

  lifecycle {
    ignore_changes = [secret_string_wo, secret_string_wo_version]
  }
}

resource "aws_secretsmanager_secret_version" "paystack" {
  secret_id = aws_secretsmanager_secret.paystack.id
  secret_string_wo = jsonencode({
    PAYSTACK_SECRET_KEY = "REPLACE_ME"
  })
  secret_string_wo_version = 1

  lifecycle {
    ignore_changes = [secret_string_wo, secret_string_wo_version]
  }
}

resource "aws_secretsmanager_secret_version" "workos_webhook" {
  secret_id = aws_secretsmanager_secret.workos_webhook.id
  secret_string_wo = jsonencode({
    WORKOS_WEBHOOK_SECRET = "REPLACE_ME"
  })
  secret_string_wo_version = 1

  lifecycle {
    ignore_changes = [secret_string_wo, secret_string_wo_version]
  }
}

resource "aws_secretsmanager_secret_version" "edge_shared_secret" {
  secret_id = aws_secretsmanager_secret.edge_shared_secret.id
  secret_string = jsonencode({
    EDGE_SHARED_SECRET = random_password.edge_shared_secret.result
  })
}

resource "aws_secretsmanager_secret_version" "bff_internal_token" {
  secret_id = aws_secretsmanager_secret.bff_internal_token.id
  secret_string_wo = jsonencode({
    BFF_INTERNAL_TOKEN = ephemeral.random_password.bff_internal_token.result
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "tenant_token_secret" {
  secret_id = aws_secretsmanager_secret.tenant_token_secret.id
  secret_string_wo = jsonencode({
    TENANT_TOKEN_SECRET = ephemeral.random_password.tenant_token_secret.result
  })
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret_version" "dashboard_cookie_password" {
  secret_id = aws_secretsmanager_secret.dashboard_cookie_password.id
  secret_string_wo = jsonencode({
    WORKOS_COOKIE_PASSWORD = ephemeral.random_password.dashboard_cookie_password.result
  })
  secret_string_wo_version = 1
}

####################################################################################################
# admin-console (mirrors the dashboard secrets above). Reuses the SHARED WorkOS app (one client), so
# WORKOS_API_KEY/WORKOS_CLIENT_ID are identical to the dashboard's — but gets its OWN secret container
# so its redirect URIs (derived from ADMIN_CONSOLE_BASE_URL) stay independent. Cookie password is
# Terraform-generated. Talks to the api only as the BFF (bff_internal_token) — the data-plane
# credential is a short-lived tenant token minted by the api per request (ADR-0003), no tenant API key.
# (dev-portal retired in PI-6 — its secrets removed.)
####################################################################################################

ephemeral "random_password" "admin_console_cookie_password" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "admin_console_cookie_password" {
  name                    = "fabric/testing/admin-console-cookie-password"
  description             = "Seals the admin-console's WorkOS session cookie."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "admin_console_cookie_password" {
  secret_id = aws_secretsmanager_secret.admin_console_cookie_password.id
  secret_string_wo = jsonencode({
    WORKOS_COOKIE_PASSWORD = ephemeral.random_password.admin_console_cookie_password.result
  })
  secret_string_wo_version = 1
}

# Placeholder containers — populate the real values (shared WorkOS API key + client ID) manually
# after apply. Terraform ignores drift so applies don't stomp what you set. Staff aren't org-scoped,
# so the admin-console bundle carries no WORKOS_ORGANIZATION_ID.
resource "aws_secretsmanager_secret" "admin_console_workos" {
  name                    = "fabric/testing/admin-console-workos"
  description             = "WorkOS AuthKit credentials for the admin-console (populate manually after apply)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "admin_console_workos" {
  secret_id = aws_secretsmanager_secret.admin_console_workos.id
  secret_string_wo = jsonencode({
    WORKOS_API_KEY   = "REPLACE_ME"
    WORKOS_CLIENT_ID = "REPLACE_ME"
  })
  secret_string_wo_version = 1

  lifecycle {
    ignore_changes = [secret_string_wo, secret_string_wo_version]
  }
}
