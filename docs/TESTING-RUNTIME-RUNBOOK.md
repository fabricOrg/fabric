# Testing runtime runbook

## Status

The AWS account bootstrap, remote state, ECR repository, and GitHub OIDC role are already applied.
The runtime plan is validated but intentionally unapplied. The latest reviewed plan contains 35
creates, one in-place IAM policy update, and no destroys.

Do not reuse this topology for staging or production. It uses a default VPC, public task IPs, a
single-AZ database, one-day backups, no deletion protection, and no alarm notification target.

## Cost envelope

Expected testing baseline in `eu-west-1` is approximately **USD 30-35/month** at low request and log
volume:

| Component | Approximate monthly cost |
|---|---:|
| RDS PostgreSQL `db.t4g.micro` plus 20 GB gp3 | USD 15 |
| one Fargate task, 0.25 vCPU and 0.5 GB | USD 9 |
| one public IPv4 address while the task runs | USD 4 |
| five Secrets Manager secrets | USD 2 |
| API Gateway, Cloud Map, logs, backups, and ECR | usage-dependent, low-volume remainder |

The estimate excludes tax, data transfer, unexpected log volume, storage autoscaling, and additional
task replicas. Confirm current AWS pricing before apply and configure an AWS Budget separately.

## Pre-apply gate

```powershell
$env:AWS_PROFILE = "app-dev"
aws sts get-caller-identity
terraform -chdir=infra/dev init
terraform -chdir=infra/dev fmt -check -recursive
terraform -chdir=infra/dev validate
terraform -chdir=infra/dev plan
```

Verify the account is `677035504110`, the region is `eu-west-1`, and the plan has no destroys or
replacements. Database and application secret values must appear only as write-only attributes.

## Apply

Run apply only after the cost gate is approved:

```powershell
terraform -chdir=infra/dev apply
terraform -chdir=infra/dev output
```

The initial ECS service has `desired_count = 0`, so apply alone does not run the API.

## Configure GitHub testing variables

Set these values from Terraform outputs in the GitHub `testing` Environment:

| GitHub variable | Value |
|---|---|
| `ECS_CLUSTER` | `ecs_cluster_name` |
| `ECS_SERVICE` | `ecs_service_name` |
| `ECS_TASK_DEFINITION` | `ecs_task_definition_family` |
| `ECS_MIGRATION_TASK_DEFINITION` | `ecs_migration_task_definition_family` |
| `ECS_SUBNET_IDS` | comma-joined `ecs_subnet_ids` |
| `ECS_SECURITY_GROUP_ID` | `ecs_security_group_id` |
| `ECS_DESIRED_COUNT` | `1` |
| `SMOKE_TEST_URL` | `testing_api_url` |

Keep the existing AWS account, region, role, ECR repository, and container variables. Then set the
repository variable `TESTING_DEPLOYMENTS_ENABLED=true`.

## Deployment contract

Promotion to `testing`:

1. builds and pushes an image tagged with the Git tree hash;
2. registers and runs the migration task;
3. stops if migration exits unsuccessfully;
4. registers the API task definition and updates the ECS service;
5. waits for service stability and checks `/health`.

The migration task receives the admin, owner, and runtime database URLs. The API task receives only
the runtime URL and ingress tokens. Runtime database access remains non-superuser and RLS-constrained.

## Verification

```powershell
$env:AWS_PROFILE = "app-dev"
$url = terraform -chdir=infra/dev output -raw testing_api_url
Invoke-RestMethod "$url/health"
aws ecs describe-services --cluster fabric-testing --services fabric-api-testing
aws cloudwatch describe-alarms --alarm-name-prefix fabric-testing
```

Inspect `/fabric/testing/api` and `/fabric/testing/api-gateway` logs. Confirm API-key administration
returns 401 without `x-operator-token`, and fake DLR ingress returns 401 without `x-webhook-token`.

## Rollback

Application rollback is a redeploy of a previously successful immutable tree-hash image and task
definition. Database migrations are forward-only: fix a failed schema change with a new migration,
not by automatically reversing a partially applied migration.

To stop compute cost while retaining the database:

```powershell
aws ecs update-service --cluster fabric-testing --service fabric-api-testing --desired-count 0
```

To remove the whole testing runtime, disable testing deployments first, review a destroy plan, and
then run `terraform -chdir=infra/dev destroy`. Testing RDS intentionally skips a final snapshot, so
destroy permanently removes its data.

## Promotion blockers

Before staging or production:

- use separate AWS accounts, purpose-built VPCs, and private subnets;
- enable Multi-AZ, longer backups, deletion protection, and a final-snapshot policy;
- add actionable SNS/PagerDuty alarm destinations and an AWS Budget;
- replace shared testing ingress tokens with customer auth and real provider signature validation;
- define autoscaling, availability targets, restore tests, and a production incident runbook.
