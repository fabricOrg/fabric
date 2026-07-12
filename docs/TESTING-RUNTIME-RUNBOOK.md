# Testing runtime runbook

## Status

The AWS account bootstrap, remote state, ECR repository, GitHub OIDC role, and testing runtime are
applied. The first successful migration-first deployment completed on 4 July 2026. The testing
surfaces run on healthy private Fargate tasks with autoscaling enabled. Resolve the API endpoint when
needed:

```powershell
terraform -chdir=infra/dev output -json testing_edge_urls
```

Terraform reports no drift. `TESTING_DEPLOYMENTS_ENABLED=true`.

The testing topology is production-like enough to exercise deployment, migration, networking,
secrets, alerting, Redis, and external-provider integration paths before market launch. It still
lives in the dev AWS account and must not be treated as the production environment of record.

## Cost envelope

Testing now favors production parity over minimum monthly spend. The recurring baseline includes:

- a dedicated three-AZ VPC with public, private, and database subnet tiers;
- NAT gateways so ECS tasks stay private while retaining outbound dependency access;
- Multi-AZ RDS PostgreSQL with deletion protection, final snapshots, account-limited automated
  backups, enhanced
  monitoring, and Performance Insights;
- two encrypted Multi-AZ Redis replication groups, one for queues and one for cache;
- API Gateway private integrations through VPC Link and Cloud Map;
- CloudFront plus global AWS WAF in front of every public HTTP API;
- ECS Application Auto Scaling for the API, dashboard, admin console, and dev portal;
- CloudWatch logs, alarms, and an SNS alert topic.

Configure `testing_alarm_email` to subscribe an operator mailbox to testing alerts. Configure an AWS
Budget separately so spending is visible, but do not reduce this environment below the production
behaviors it is meant to validate.

## Change gate

```powershell
$env:AWS_PROFILE = "app-dev"
aws sts get-caller-identity
terraform -chdir=infra/dev init
terraform -chdir=infra/dev fmt -check -recursive
terraform -chdir=infra/dev validate
terraform -chdir=infra/dev plan
```

Verify the account is `677035504110`, the region is `eu-west-1`, and the plan has no unapproved
destroys or replacements. Database and application secret values must appear only as write-only
attributes.

## Initial apply

The initial apply has completed. For future infrastructure changes, run apply only after reviewing
the plan for data loss, replacements, and security exposure:

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
$url = (terraform -chdir=infra/dev output -json testing_edge_urls | ConvertFrom-Json).api
Invoke-RestMethod "$url/health"
aws ecs describe-services --cluster fabric-testing --services fabric-api-testing
aws cloudwatch describe-alarms --alarm-name-prefix fabric-testing
aws application-autoscaling describe-scalable-targets --service-namespace ecs
aws wafv2 list-web-acls --region us-east-1 --scope CLOUDFRONT --query "WebACLs[?Name=='fabric-testing-edge']"
```

Inspect `/fabric/testing/api` and `/fabric/testing/api-gateway` logs. Confirm API-key administration
returns 401 without `x-operator-token`, and DLR ingress returns 401 without `x-webhook-token`.
The raw API Gateway endpoint must return 403 for public requests; customer/provider traffic must use
the CloudFront edge URL from `terraform -chdir=infra/dev output -json testing_edge_urls`.
Testing uses the real Arkesel provider path by default (`testing_sms_provider=arkesel` and
`testing_arkesel_sandbox=false`) so release validation can prove real SMS delivery before market
deployment. Keep provider credentials in Secrets Manager and restrict live-send drills to approved
test recipients and explicit test accounts.

Run the live SMS canary only with an approved test tenant, active sender ID, funded wallet, and
recipient:

```powershell
.\scripts\ops\testing-live-sms-canary.ps1 `
  -ApiKey "sk_live_..." `
  -To "+233XXXXXXXXX" `
  -SenderId "FABRIC"
```

After the canary, verify the message through `GET /v1/messages`, provider delivery receipt logs,
global WAF sampled requests, and the wallet ledger.

## Rollback

Application rollback is a redeploy of a previously successful immutable tree-hash image and task
definition. Database migrations are forward-only: fix a failed schema change with a new migration,
not by automatically reversing a partially applied migration.

To stop compute cost while retaining the database:

```powershell
aws ecs update-service --cluster fabric-testing --service fabric-api-testing --desired-count 0
```

To remove the whole testing runtime, disable testing deployments first, review a destroy plan, and
then run `terraform -chdir=infra/dev destroy`. Testing RDS has deletion protection and a final
snapshot policy, so deliberate teardown requires disabling protection and preserving the snapshot
identifier from the destroy plan.

## Promotion blockers

Before market production:

- create separate staging and production AWS accounts from the tested Terraform pattern;
- upgrade the AWS account plan, then raise testing RDS automated backup retention above the current
  free-tier account limit;
- decide production RTO/RPO, backup retention, restore-test cadence, and incident escalation;
- replace remaining shared testing ingress tokens with customer auth and real provider signature
  validation where the public surface requires it;
- add SLO dashboards and pager destinations;
- complete live-SMS canary approval, compliance review, and customer onboarding runbooks.
