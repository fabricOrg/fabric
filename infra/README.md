# Infrastructure — environment topology

Terraform for the platform, organized **one directory per environment** with **shared modules**.
Each environment owns its own state, so a `terraform apply` can only ever touch one environment —
there is no way to fat-finger a dev change into prod.

```
infra/
  bootstrap/    # one-time: creates the S3 bucket + DynamoDB lock table for remote state (prod/CI pattern)
  modules/      # reusable building blocks (ecr, network, ecs-service, db, …) — the "how"
  dev/          # ✅ LIVE   — shared team integration (current dev AWS account, eu-west-1)
  staging/      # 🔒 DEFINED, NOT PROVISIONED — prod-like pre-release validation / UAT
  prod/         # 🔒 DEFINED, NOT PROVISIONED — production (af-south-1 + data residency)
```

## The four tiers

| Tier | Purpose | Account / region | Status |
|------|---------|------------------|--------|
| **test / CI** | Automated tests + ephemeral PR checks. No standing infra — DB via Testcontainers/local Postgres, torn down per run. | CI runner | provisioned by CI, not Terraform |
| **dev** | Where the `dev` branch deploys; shared team integration. | dev account · `eu-west-1` | **live** |
| **staging** | Prod-like gate before release. Runs the **same artifact** that will go to prod; used for UAT + smoke. | prod org (own account) · `af-south-1` | defined, not provisioned |
| **prod** | Production. | prod org · `af-south-1` + residency | defined, not provisioned |

## Why "define now, provision later"

Standing up four always-on environments before there is a deployable service is wasted cost and
process. So the **structure and config live in the repo now** (adding an environment later is filling
in variables, not restructuring), but only `dev` is actually applied. `staging`/`prod` are inert
scaffolds — they have no `resource` blocks yet and point at an account that doesn't exist until we
create it near first release.

## Build once, promote — not rebuild per environment

The environments differ by **config only** (Terraform vars + secrets), never by code. The pipeline
builds **one** container image on merge to `dev`, then promotes that exact image forward:

```
feature/*  ──►  test/CI (automated)           # per PR, ephemeral
   dev     ──►  build image ──► deploy DEV     # on merge to dev
   main    ──►  promote image ──► STAGING ──► (gate) ──► PROD   # on release tag
```

This is what keeps a 4-tier setup lean: no per-environment rebuilds, no "works in dev, broken in
prod" drift from recompiling. See `docs/DEPLOYMENT-AND-DEVOPS.md` for the full flow.

## Provisioning a new environment (later)

1. Create the AWS account (prod org) and an access profile.
2. `cd infra/bootstrap` → apply, to create that environment's remote-state bucket + lock table.
3. Fill in the environment's `main.tf` (compose the shared `modules/`) and `variables.tf`.
4. Uncomment its `backend "s3"` block, `terraform init -reconfigure`, `plan`, `apply`.
