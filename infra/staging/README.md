# staging environment — 🔒 DEFINED, NOT PROVISIONED

Prod-like environment for pre-release validation (UAT + smoke tests). It runs the **same container
image** that will be promoted to prod, so a green staging is real evidence prod will work.

**Status:** structure only. There are **no `resource` blocks** here yet and the target AWS account
does not exist. `terraform init` works (for validation); `terraform apply` is a no-op until we add
resources and a real account profile.

## Provision when
We reach first-release readiness (a deployable NestJS api + a real release to gate). Then:
1. Create the staging AWS account in the prod org; set up the `app-staging` profile.
2. `cd infra/bootstrap` and apply against that account (remote-state bucket + lock table).
3. Uncomment the `backend "s3"` block in `main.tf`; compose modules from `../modules/`.
4. `terraform init -reconfigure && terraform plan && terraform apply`.

## Parity intent
Same region as prod (`af-south-1`), same module composition as prod, smaller instance sizes. Config
differs; **code does not** — see `docs/DEPLOYMENT-AND-DEVOPS.md` (build once, promote).
