# Infrastructure

Terraform is isolated by AWS account and environment. Every deployed environment owns separate
state so an apply cannot modify another environment.

See [AWS testing architecture](../docs/AWS-TESTING-ARCHITECTURE.md) for the provisioned request,
network, deployment, migration, IAM, and observability flows.

```text
infra/
  bootstrap/  # encrypted, versioned S3 state backend with native lockfiles
  modules/    # reusable infrastructure modules
  dev/        # testing deployment in the current dev AWS account, eu-west-1
  staging/    # separate-account scaffold, not provisioned
  prod/       # separate-account scaffold, not provisioned
```

## Environment mapping

| Git branch | Runtime | AWS account and region | Status |
|---|---|---|---|
| Work branch | CI only | GitHub runner | Ephemeral |
| `dev` | CI only | None | Integration gate |
| `testing` | Testing | Dev account, `eu-west-1` | Runtime provisioned and deploying from GitHub Actions |
| `staging` | Staging | Separate account, `af-south-1` | Not provisioned |
| `main` | Production | Separate account, `af-south-1` | Not provisioned |

The pipeline builds one immutable image when `testing` is deployed, then promotes the same image
through staging and production. Environment differences are configuration and secrets, not rebuilt
application code.

## State

The current account stores Terraform state in
`fabric-terraform-state-677035504110-eu-west-1` with:

- separate `bootstrap/` and `testing/` state keys;
- native S3 lockfiles;
- versioning and AWS-managed KMS encryption;
- complete public-access blocking;
- a bucket policy denying non-TLS requests.

Staging and production must use separate accounts and state buckets.

## Current scope

The API ECR repository, state backend, and testing GitHub OIDC role exist. The testing ECS, RDS,
API Gateway, Cloud Map, secrets, logging, alarms, and migration runner are provisioned. The API runs
one Fargate task after a successful migration-first deployment. Staging and production remain
separate-account scaffolds.
