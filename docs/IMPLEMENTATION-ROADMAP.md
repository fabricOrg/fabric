# Implementation Roadmap — two interleaved tracks

**Date:** 2026-06-04 · **Audience:** the team (and a learning reference — explains the *why*).
This sequences the two tracks that run in parallel toward the PI-1 thin thread.

> **Track A — AWS foundation** (where the system runs). Mostly Terraform + some AWS console.
> **Track B — Application + data** (the system itself). Node/TS + NestJS + Drizzle + Postgres.
> They're independent until late: you build & test Track B locally (Docker) while Track A's
> cloud foundation is stood up; they meet when we first deploy to staging.

---

## Why this order (the mental model)
- **You can't `terraform apply` into a single root account.** Best practice is a *landing zone*:
  a multi-account structure with guardrails, set up once, that every later account inherits. So
  Track A step 1 is org/account structure, not servers.
- **Terraform needs somewhere to store its "state."** That store (an S3 bucket) must exist before
  Terraform manages anything else — a chicken-and-egg solved by a tiny *bootstrap* step.
- **Track B doesn't need the cloud to start.** Postgres + Redis run in Docker locally, so we build
  and test the schema, RLS, and money logic on your laptop first. Cloud comes when we deploy.

```
Track A (AWS)                              Track B (app + data)
─────────────                              ────────────────────
A0  install Terraform + AWS CLI            B0  repo skeleton + local Docker (PG + Redis)   ← you are here
A1  landing zone (Control Tower, console)  B1  first migration: roles + RLS + PII vault
A2  TF state backend (bootstrap/)          B2  migration: identity (accounts, users)
A3  per-env: VPC + RDS + 2×Redis + KMS     B3  migration: wallet + double-entry ledger
A4  ECS service skeleton + pipeline (OIDC) B4  app: NestJS + Drizzle wired to the schema
        └──────────────── meet at staging deploy ────────────────┘
                       then build the thin-thread features
```

---

## Track A — AWS foundation

### A0. Prerequisites (install)
- **Terraform** (`winget install Hashicorp.Terraform` or scoop/choco) — infra-as-code engine.
- **AWS CLI v2** (`winget install Amazon.AWSCLI`) — auth + API access.
- *Why these two:* Terraform describes the infra; the AWS CLI provides the credentials Terraform
  uses (we'll wire it to IAM Identity Center SSO, not static keys — safer, see A1).

### A1. Landing zone — **console (you do this), I explain**
This is **AWS Organizations + Control Tower**. You can't fully Terraform it from a cold start; the
standard path is to enable Control Tower in the console once, which creates the structure, then
Terraform everything *inside* it.

**Concepts (the why):**
- **AWS Organizations** — turns one account into a *tree* of accounts under a root. Lets you apply
  org-wide rules and consolidate billing.
- **Control Tower** — a wizard that sets up a *well-architected* Organizations layout for you:
  recommended OUs, a log-archive + audit account, CloudTrail, Config, and *guardrails* (SCPs).
  Think "landing zone in a box."
- **OU (Organizational Unit)** — a folder of accounts you can govern together.
- **Account-per-environment** — staging and prod are *separate AWS accounts*, not separate VPCs in
  one account. Why: hard blast-radius isolation (a mistake in staging can't touch prod) and clean
  billing/audit — this is what makes ISO 27001 / SOC 2 achievable later.
- **IAM Identity Center (SSO)** — human login to AWS with roles ("permission sets"), instead of
  per-person IAM users with long-lived keys. Mirrors our staff RBAC.

**Steps (in the AWS console of your new account):**
1. Set the root account email to a *group* inbox; enable MFA on root; then **stop using root**.
2. **Enable Control Tower** in **af-south-1** (Cape Town) as the home region. It provisions the
   **Security** OU (log-archive + audit accounts) automatically.
3. Create OUs: `Infrastructure`, `Workloads` (with child accounts `staging`, `production`),
   `Sandbox`.
4. Enable **IAM Identity Center**; create permission sets (`AdministratorAccess` for you now;
   later: `platform_ops`, `finance`, `support`, `read_only`). Assign yourself.
5. Turn on baseline **guardrails / SCPs**: e.g. *deny leaving allowed regions* (lock to af-south-1
   + global services), *deny disabling CloudTrail/Config*, *require encryption*. (Control Tower
   ships many of these; enable the "strongly recommended" set.)
6. Set a **budget + cost anomaly alert** (af-south-1 carries a ~20–32% premium — watch it early).

> After this, you'll `aws configure sso` on your laptop to log in via Identity Center — that's the
> credential Terraform uses. **No static access keys anywhere.**

### A2. Terraform state backend — **`infra/bootstrap/`** (code I provide)
A tiny Terraform config that creates the **S3 bucket** (versioned, encrypted) + **DynamoDB table**
that hold and lock Terraform's state for everything else. Run once, in the **Infrastructure**
account. See `infra/bootstrap/README.md`.

### A3. Per-environment infra (next, after A1–A2)
Per env (staging, then prod), in its own account: **VPC** (large /20+ subnets ×3 AZs), **RDS
Postgres** (Multi-AZ, PITR), **two ElastiCache Redis** (queue: noeviction+AOF; cache: LRU), **KMS**
key, **Secrets Manager**, **ECR**. All Terraform; modules so per-tenant/region is `for_each`.

### A4. Compute + pipeline
One **ECS Fargate** service skeleton behind an ALB + WAF; **GitHub Actions** deploying via **GitHub
OIDC** (a federated role — no AWS keys in CI); Grafana Cloud + Sentry wired with PII scrubbed at source.

---

## Track B — Application + data

### B0. Repo skeleton + local Docker (code I provide)
- A **`docker-compose.yml`** runs Postgres 16 + the two Redis tiers locally — your dev "cloud."
- Why local-first: you learn and test the schema, RLS isolation, and ledger math with zero AWS cost
  or latency; the same SQL later runs on RDS unchanged.

### B1. First migration — roles + RLS + PII vault (code I provide: `db/migrations/0001`)
The hardest, most foundational concepts land first (they're "schema-shaping" — painful to retrofit):
- **Two Postgres roles** (owner for migrations, app role for runtime) — so the app can't bypass RLS
  (B4 from the pre-impl review).
- **Row-Level Security + `FORCE ROW LEVEL SECURITY`** + the `SET LOCAL app.tenant_id` pattern (B3).
- **`data_subjects` + `pii_vault`** — the tokenization model so PII lives in one encrypted place and
  erasure = destroy a key (B7).

### B2–B3. identity, then wallet + ledger
`accounts`/`users`/`memberships`; then `wallets` (per tenant+currency) + the append-only
`ledger_transactions`/`ledger_entries` with the balance invariant.

### B4. App wiring
NestJS app, Drizzle pointed at the schema, the tenant-context transaction wrapper, the first
`/v1/sms/send` path against the `FakeProvider`.

---

## Where we are now
- ✅ A0 tooling checked: Node/pnpm/git/Docker present; **install Terraform + AWS CLI** for Track A.
- ✅ A2 bootstrap Terraform scaffolded (`infra/bootstrap/`).
- ✅ B0 local Docker scaffolded (`docker-compose.yml`).
- ✅ B1 first migration scaffolded (`db/migrations/0001_foundation.sql`).
- ⏭️ **You:** do A1 (Control Tower) in the console. **Us next:** run B1 locally (teach), then B2/B3.
