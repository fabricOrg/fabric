# Testing environment in the dev AWS account

This stack defines the first deployed runtime in `eu-west-1`. The `testing` branch deploys here;
the `dev` branch is an integration branch and does not deploy.

## Topology

- API Gateway HTTP API with managed HTTPS and request throttling
- VPC Link to ECS through Cloud Map SRV service discovery
- one ECS Fargate API task plus an on-demand migration task
- private, encrypted PostgreSQL RDS with separate admin, migration-owner, and runtime roles
- Secrets Manager for database URLs and testing ingress tokens
- CloudWatch logs and testing alarms
- default VPC public subnets for non-production outbound access

There is no NAT gateway, load balancer, Redis, or public database endpoint. ECS tasks receive public
IP addresses for outbound image and dependency access, but their security group accepts inbound
traffic only from the API Gateway VPC Link.

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

Applying creates recurring-cost resources. Review
[`docs/TESTING-RUNTIME-RUNBOOK.md`](../../docs/TESTING-RUNTIME-RUNBOOK.md) first. The ECS service is
created at zero tasks; the first enabled deployment runs migrations and then starts one API task.
