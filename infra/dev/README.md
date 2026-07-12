# Testing environment in the dev AWS account

This stack defines the first deployed runtime in `eu-west-1`. The `testing` branch deploys here;
the `dev` branch is an integration branch and does not deploy.

## Topology

- API Gateway HTTP API with managed HTTPS and request throttling
- CloudFront plus global AWS WAF in front of every public HTTP API
- VPC Link to ECS through Cloud Map SRV service discovery
- ECS Fargate services with Application Auto Scaling plus an on-demand migration task
- dedicated three-AZ VPC with public, private, and database subnet tiers
- private ECS services with outbound access through NAT gateways
- private, encrypted Multi-AZ PostgreSQL RDS with separate admin, migration-owner, and runtime roles
- encrypted Multi-AZ Redis replication groups for queue and cache workloads
- Secrets Manager for database URLs, testing ingress tokens, WorkOS, Paystack, and SMS provider values
- CloudWatch logs, testing alarms for API Gateway, global WAF, ECS, and RDS, and SNS alert topics

There is no load balancer or public database endpoint. ECS tasks run in private subnets without
public IP addresses; their security group accepts inbound traffic only from the API Gateway VPC Link.

## Credentials

```powershell
$env:AWS_PROFILE = "app-dev"
aws sts get-caller-identity
```

Terraform state is encrypted, versioned, and locked in the account's S3 state bucket.

## Plan and apply

```powershell
$env:AWS_PROFILE = "app-dev"
terraform -chdir=infra/dev init
terraform -chdir=infra/dev fmt -check -recursive
terraform -chdir=infra/dev validate
terraform -chdir=infra/dev plan
terraform -chdir=infra/dev apply
```

Applying creates production-like recurring-cost resources. Review
[`docs/TESTING-RUNTIME-RUNBOOK.md`](../../docs/TESTING-RUNTIME-RUNBOOK.md) first. The ECS service is
created at zero tasks; the first enabled deployment runs migrations and then starts one API task.
