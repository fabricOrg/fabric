# prod environment — 🔒 DEFINED, NOT PROVISIONED

Production. Runs the exact image validated in staging (build once, promote — no rebuild).

**Status:** structure only. No `resource` blocks yet; the production AWS account does not exist yet.
Per the account plan, prod is a **separate account** (not the current dev account), created with the
full landing zone when we're ready to deploy for real.

## Provision when
First production release is approved. Then:
1. Create the prod AWS account + landing zone (Organizations/Control Tower, SSO, guardrails) — see
   `docs/DEPLOYMENT-AND-DEVOPS.md` and `infra/bootstrap`.
2. Enable `af-south-1`; set up the `app-prod` profile (SSO, not long-lived IAM keys).
3. `cd infra/bootstrap` → apply against prod (remote-state bucket + lock table).
4. Uncomment the `backend "s3"` block in `main.tf`; compose modules from `../modules/`.
5. `terraform init -reconfigure && terraform plan && terraform apply`.

## Prod-specific concerns (not present in dev)
- **Data residency:** `af-south-1` (Cape Town) — keep customer PII in-region (COMPLIANCE doc).
- **Landing zone:** dedicated account, SSO access only, CloudTrail + guardrails.
- **HA sizing:** multi-AZ RDS, ≥2 Fargate tasks, autoscaling — staging mirrors the shape at smaller size.
- **Change gate:** deploys to prod are a **promotion of a staging-validated image**, human-approved.
