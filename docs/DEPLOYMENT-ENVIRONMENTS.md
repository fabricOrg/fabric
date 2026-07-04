# Deployment environments

Fabric promotes changes through four long-lived branches:

| Branch | GitHub Environment | Purpose | AWS region |
|---|---|---|---|
| `dev` | None | Integrate work branches before deployment | N/A |
| `testing` | `testing` | Integration and internal verification | `eu-west-1` |
| `staging` | `staging` | Production-like UAT and smoke tests | `af-south-1` |
| `main` | `production` | Customer production | `af-south-1` |

Work branches merge into `dev`. Promotion pull requests then move the same tree through
`dev` -> `testing` -> `staging` -> `main`. The `dev` branch runs CI but does not deploy. The
container tag is the Git tree hash, so an unchanged promotion
keeps one immutable artifact identity even when GitHub creates a different merge commit.

Squash work-branch pull requests into `dev`. Merge environment promotion pull requests with a merge
commit; do not squash them. Preserving ancestry between the long-lived branches keeps each next
promotion conflict-free while the tree-hash tag proves that the promoted artifact is unchanged.

## Current status

The branches, GitHub Environments, branch deployment policies, workflow, regions, ECR repository,
and container name are configured. Testing Terraform state is encrypted, versioned, remotely stored,
and locked in S3. The testing runtime is provisioned and deploys through GitHub OIDC after running
database migrations. Staging and production remain disabled and require separate AWS accounts and
infrastructure.

Repository enable flags:

- `TESTING_DEPLOYMENTS_ENABLED`
- `STAGING_DEPLOYMENTS_ENABLED`
- `PRODUCTION_DEPLOYMENTS_ENABLED`

All default to `false`. Enable an environment only after its required variables are configured.

Testing API-key management requires `x-operator-token`; fake-provider DLR ingress requires
`x-webhook-token`. Their values are generated during Terraform apply and remain in Secrets Manager,
not GitHub.

## Required environment variables

| Variable | Purpose |
|---|---|
| `AWS_REGION` | Target AWS region |
| `AWS_ACCOUNT_ID` | Expected account used by the OIDC smoke check |
| `AWS_ROLE_ARN` | GitHub OIDC deployment role |
| `ECR_REPOSITORY` | Destination ECR repository, currently `app/api` |
| `ECS_CLUSTER` | ECS cluster name |
| `ECS_SERVICE` | ECS service name |
| `ECS_TASK_DEFINITION` | Existing task-definition family |
| `ECS_MIGRATION_TASK_DEFINITION` | One-off database migration task family |
| `ECS_CONTAINER_NAME` | Container to replace, currently `api` |
| `ECS_SUBNET_IDS` | Comma-separated subnets used for the migration task |
| `ECS_SECURITY_GROUP_ID` | Security group used by the migration task |
| `ECS_DESIRED_COUNT` | Service task count after a successful migration, defaults to `1` |
| `SMOKE_TEST_URL` | Optional public service URL |

Staging and production also require:

| Variable | Purpose |
|---|---|
| `PROMOTION_SOURCE_IMAGE` | Full source ECR image path without a tag |
| `PROMOTION_SOURCE_REGION` | Region containing the source ECR repository |

The destination deployment role needs permission to pull from the source repository. Use
cross-account ECR repository policies rather than long-lived AWS access keys.

## Bundles and static assets

The API image builds only `@app/api` and its workspace dependency closure, then copies a
production-only pnpm deployment bundle into the runtime stage. Dashboard, developer portal, and
admin console assets are never included in the API image.

Each Next.js app emits standalone output for a separate runtime image. Next/Turbopack performs
route-level JavaScript splitting, tree shaking, minification, CSS extraction, and content-hashed
static assets. Static `_next` assets should be served through the load balancer or CDN with their
immutable cache headers. Use `next/image` for future bitmap assets so Sharp can resize and encode
responsive formats at runtime; remote image hosts must be explicitly allow-listed.

## Enablement sequence

1. Create separate staging and production AWS accounts and remote state backends.
2. Provision each environment's network, ECS, ingress, RDS, logs, alarms, and secrets.
3. Create least-privilege GitHub OIDC roles scoped to this repository and environment branch.
4. Configure the required GitHub Environment variables.
5. Confirm forward-only database migration and application rollback procedures.
6. Set only the target environment's repository enable flag to `true`.
7. Integrate on `dev`, promote to and verify `testing`, then promote to `staging`; production remains last.
