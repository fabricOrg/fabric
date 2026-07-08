# Deploying admin-console + dev-portal to testing

_Companion to [PATH-TO-TESTING.md](./PATH-TO-TESTING.md). Adds the two remaining frontends to the
testing environment, mirroring the dashboard's OIDC→ECR→ECS path._

This PR ships the **plumbing** (Terraform + CI jobs + healthz probes). The steps below are the
**operator actions** that need AWS credentials + WorkOS/GitHub access — they can't run from CI or the
dev machine used to author this.

## What the PR added

- `infra/dev/admin-console.tf`, `infra/dev/dev-portal.tf` — ECR repo, Fargate task def + service
  (desired_count 0), own API Gateway HTTP API + VPC Link, log groups, service discovery, outputs.
- `infra/dev/database.tf` — per-app cookie-password secrets (Terraform-generated) + WorkOS credential
  containers (placeholder `REPLACE_ME`, drift-ignored).
- `infra/dev/ecs.tf` — execution role can read the new secrets.
- `infra/dev/github-oidc.tf` + `variables.tf` — ECR push, ECS deploy, PassRole, and OIDC trust for the
  `testing-admin-console` + `testing-dev-portal` GitHub Environments.
- `.github/workflows/deploy.yml` — `deploy-admin-console-testing` + `deploy-dev-portal-testing` jobs
  (testing only; build image, no migration, smoke `/login`).
- `app/healthz/route.ts` in both apps + Dockerfile healthcheck → `/healthz` (trivial liveness, no SSR).

Both reuse the **shared** WorkOS app (one client). admin-console is **not** org-scoped (no
`WORKOS_ORGANIZATION_ID`, no tenant API key — BFF token only). dev-portal is org-scoped and reuses
the dashboard's Fabric API key (same testing tenant).

## Operator steps

### 1. Apply the infra (needs AWS creds)

```bash
cd infra/dev
terraform init
terraform apply       # creates ECR repos, ECS services (count 0), API Gateways, secrets, log groups
terraform output      # note testing_admin_console_url + testing_dev_portal_url + the deploy role ARN
```

### 2. Populate the placeholder secrets (AWS console/CLI, once)

The shared WorkOS values are the same ones already in `fabric/testing/dashboard-workos`.

```bash
# admin-console: shared API key + client ID only (staff aren't org-scoped)
aws secretsmanager put-secret-value --secret-id fabric/testing/admin-console-workos \
  --secret-string '{"WORKOS_API_KEY":"sk_...","WORKOS_CLIENT_ID":"client_..."}'

# dev-portal: + the org ID
aws secretsmanager put-secret-value --secret-id fabric/testing/dev-portal-workos \
  --secret-string '{"WORKOS_API_KEY":"sk_...","WORKOS_CLIENT_ID":"client_...","WORKOS_ORGANIZATION_ID":"org_..."}'
```

Cookie passwords are auto-generated; the BFF token + dashboard API key are reused (already set).

### 3. Register the app URLs in WorkOS (shared app → Redirects)

For each of `testing_admin_console_url` and `testing_dev_portal_url`, add to the **Fabric Customer
Dashboard** app:

- **Redirect URIs**: `<url>/auth/callback`
- **Sign-out redirects**: `<url>/login`

(Same fallback trap as the localhost fix — an unregistered sign-out returnTo bounces to the default.)

### 4. Create the GitHub Environments

`testing-admin-console` and `testing-dev-portal`, each with these **variables** (values from
`terraform output`, mirroring the `testing-dashboard` environment):

| Variable | Value |
|---|---|
| `AWS_REGION` | `eu-west-1` |
| `AWS_ROLE_ARN` | `github_testing_deploy_role_arn` output |
| `ECR_REPOSITORY` | `app/admin-console` / `app/dev-portal` |
| `ECS_CLUSTER` | `fabric-testing` |
| `ECS_SERVICE` | `fabric-admin-console-testing` / `fabric-dev-portal-testing` |
| `ECS_TASK_DEFINITION` | `fabric-admin-console-testing` / `fabric-dev-portal-testing` |
| `ECS_CONTAINER_NAME` | `admin-console` / `dev-portal` |
| `ECS_SUBNET_IDS` | same as testing-dashboard |
| `ECS_SECURITY_GROUP_ID` | same as testing-dashboard |
| `ECS_DESIRED_COUNT` | `1` |
| `SMOKE_TEST_URL` | the app's `testing_*_url` |

### 5. Deploy

Push to `testing` (or run the **Deploy** workflow via dispatch with `environment: testing`). The new
jobs build each image, register the task def, and roll the service. Smoke test hits `/login`.

### 6. Verify

Open each `testing_*_url` → the branded login → **Continue with WorkOS SSO**. Until the dev/staff
invite/provisioning flow exists, an authenticated-but-unprovisioned identity correctly lands back on
that app's own `/login` with the **Access denied** banner (confirms both the deploy and the SSO
journey fix).

## Not in scope

- **Provisioning** dev/staff members (so login actually succeeds) — separate work.
- **Staging/production** jobs for these two apps — wire later, mirroring the dashboard's job set.
- **Splitting admin-console into its own WorkOS app** — deferred; reuses the shared app for now.
