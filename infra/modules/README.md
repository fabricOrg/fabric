# infra/modules — shared Terraform building blocks

A module is a reusable package of Terraform (`resource`/`variable`/`output`) that an environment
*calls*, instead of copy-pasting the same resources into `dev/`, `staging/`, and `prod/`. The
environment dirs become thin: they wire modules together and pass environment-specific variables.

```hcl
# infra/staging/main.tf (later)
module "api_repo" {
  source = "../modules/ecr"
  name   = "app/api"
}
```

## Why we don't have modules yet

**Rule of three / extract-on-second-consumer.** `dev` currently owns its `ecr` resource inline
because it's the *only* consumer — extracting a one-use module adds indirection for no reuse. The
moment `staging` needs the same resource, we lift it into `modules/ecr/` and both environments call
it. Extract when the second consumer appears, not before.

## Expected modules (as services get deployed)

- `ecr/` — image registry (first to be extracted — `dev` already has the inline version)
- `network/` — VPC, subnets, security groups
- `ecs-service/` — Fargate service + task def + ALB target group (the NestJS api)
- `db/` — RDS Postgres (with the `app_owner` / `app_runtime` two-role setup)
- `cache-queue/` — ElastiCache Redis (queue + cache)

Each module: `main.tf`, `variables.tf`, `outputs.tf`, `README.md`. Keep them provider-agnostic of
environment — no hardcoded account IDs, regions, or names; those come in as variables.
