# CLAUDE.md — Fabric engineering guide

Operative guide for working in this repo. Depth lives in `docs/` (ARCHITECTURE, CONVENTIONS,
DEPLOYMENT-AND-DEVOPS, COMPLIANCE, CONTROL-PLANE-ADMIN, PI-*). This file is the summary you must
follow; when it and a `docs/` page disagree, fix the discrepancy rather than guessing.

Product brand is **Fabric** (repo/packages stay `jojo` / `@app/*`). Multi-tenant CPaaS + payments +
identity for Ghana / Nigeria (West Africa). Region `eu-west-1` (af-south-1 unavailable).

---

## 1. What this is (locked architecture — do not relitigate)

- **Modular monolith**, not microservices. One NestJS API (`services/api`, Fastify adapter), three
  Next.js App-Router frontends (`apps/dashboard` :3100 customer, `apps/dev-portal` :3200 developer,
  `apps/admin-console` :3300 staff). Shared packages under `packages/@app/*`.
- **pnpm 11 + Turbo** workspace. Node 22. React 19, Tailwind v4, shadcn (new-york).
- **Postgres tenancy via row-level security (RLS)**, FORCE on tenant tables. The runtime role
  (`app_runtime`) is NON-superuser and cannot bypass RLS. Every tenant-scoped query runs inside
  `withTenant(tenantId, fn)` / `withTenantDrizzle`. Cross-tenant/admin work uses a separate
  provisioning connection (`app_provisioner`, reached via a permissive RLS policy since RDS forbids
  BYPASSRLS) or the owner/super role for migrations/tests only.
- **Money = `bigint` minor units**, branded `MinorUnits`. Never floats. **Double-entry** wallet —
  every movement is a balanced set of ledger entries; credits are **idempotent on a reference**.
- **Auth = WorkOS AuthKit SSO**, invite-only. No password/email forms we own. `@app/fe-auth` holds
  the realm logic; sessions are sealed cookies. Authorization is the **local membership role**, never
  WorkOS claims.
- **BFF pattern**: a browser never calls the API directly. Next route handler → server-only client →
  NestJS `/internal/*` guarded by `BFF_INTERNAL_TOKEN` (+ a tenant API key for customer/dev). The BFF
  supplies the tenant id from the authenticated session, never from the client, and enforces the
  role gate before calling the API.

## 2. Engineering values (first-class, govern every change)

Maintainability · Scalability · Code quality · **Strong type safety** · **Security**. When a
trade-off appears, these win over speed. Security is not negotiable: fail closed, least privilege,
no secret in logs/prose, respect RLS + the redlines below.

## 3. What "good code" means here

- **Type-safe end to end.** Strict TS, `noUncheckedIndexedAccess` on. No `any`, no unchecked casts to
  dodge the compiler. Use branded types (`MinorUnits`, `TenantId`, `UserId`). Let the types catch the
  bug — if `tsc` complains, the code is wrong, not the compiler.
- **Contracts are the boundary.** DTOs live in `@app/contracts` as **zod** schemas; both the API and
  the BFF parse against them. A shape crossing a boundary is validated, not trusted.
- **Idempotent, reconcilable side effects.** External writes (WorkOS invite, Paystack charge, ledger
  credit) go **external-first, then persist**, keyed by a stable reference so a replay/retry is safe.
  A webhook is the source of truth for "it cleared", not optimistic UI.
- **Structured errors.** Throw `invalidRequest(code, message, param?)` (always 400 — 3rd arg is a
  param name, NOT a status), `notFound`, `unauthorized`, `forbidden`. Every error has a stable `code`
  the UI can branch on. No bare `throw new Error` across a boundary.
- **Guard clauses over nesting.** Early-return on the invalid/denied case; keep the happy path flat.
- **Conditional `if`-blocks over ternaries** for render branching. Treat **error / loading / empty as
  first-class states**, not afterthoughts — render them explicitly.
- **Comments explain _why_, not _what_.** The non-obvious constraint (RLS, the API-Gateway host quirk,
  an idempotency guard) gets a sentence. Match the surrounding file's density and idiom.
- **No mock that masks reality.** A fallback that fakes success (e.g. a provisioning "OK" that creates
  nothing) is worse than a clear "not configured" error. Delete such fallbacks.
- **Tested against the real thing.** Business logic gets integration tests on a **real Postgres**
  (`*.integration.spec.ts`, run via `test:integration`, needs `DATABASE_URL_SUPER` + `DATABASE_URL_APP`).
  Assert the invariant (balance, idempotency, RLS denial), not just the happy call.
- **Files stay small** (a length guard runs on commit). Split before a file sprawls.

## 4. Patterns to reuse (don't reinvent)

- **Session resolution** (`services/api/src/identity`): invite-only. A user + membership must
  pre-exist (provisioned by email); `resolve*` only **binds** the WorkOS subject on first login and
  activates the invite. No membership → denied. Never JIT-create access.
- **Roles.** Customer membership: `owner | admin | member | developer`. `developer` is least-privilege
  (API keys + logs + wallet-read; NOT sms:send or org management) and is what clears the dev-portal
  gate. Staff (`staff_users`, no tenant / no RLS): `operator | admin`. Permissions come from a
  role→permissions map in the API, not the IdP.
- **Invite flow.** Customer/member/developer → dashboard Team → WorkOS org invitation + `invited`
  membership. Staff → admin-console Staff → allowlist row + **org-less** WorkOS invitation
  (best-effort). Genesis (first operator) only: `packages/db/cloud-seed.ts` via an ECS run-task.
- **Auth redirects must resolve against the PUBLIC base URL** (`<APP>_BASE_URL`), never
  `request.url` — behind API Gateway + VPC Link the container sees its internal host
  (`0.0.0.0:3000`). Use each app's `redirectUrl()` helper.
- **Flash notice across the WorkOS logout hop.** A `?error=` query can't survive the external logout
  round-trip, so denial/sign-out reasons ride a short-lived same-site cookie the `/login` page reads.
- **Migrations.** Schema via `drizzle-kit generate`; RLS policies, grants, and enum `ADD VALUE` as
  hand-written raw SQL migrations (idempotent, `IF NOT EXISTS`). Both are journaled + snapshotted.
- **Frontend data.** TanStack Query (client fetching) + TanStack Table via shared `@app/ui`
  `DataTable` + TanStack Form via the shared Form kit. Per app: `components/tables/` + `components/forms/`.
  Charts get typed skeletons and lazy-render (don't block the page). No mock data on real surfaces.
- **Kill-switches** gate risky operations (`platform.payments`, sms). Check them before the side effect.
- **BFF route handlers must read the session with a refresh fallback** — `readXSession() ?? refreshXSession()` — so an in-page action (invite / remove / role-change) doesn't 401 when the short-lived WorkOS access token lapsed since page load. Pages/Server Components instead use `requireXSession`, which redirects to `/auth/refresh`. A plain `readXSession()` in a mutation route is a bug.

## 5. Process + git

- **Conventional Commits.** `feat|fix|refactor|chore(scope): summary`. Body explains the why.
- **Linear history.** Branch off the current `dev` SHA (`feature/…`, `fix/…`, `ci/…` — the name
  validator requires a scope token, e.g. `fix/ops-…`). PR → **squash-merge** into `dev`.
- **Only advance `dev` via squash-merge** — never rebase/reset a shared ref out from under others.
- **`verify:push`** (build + lint + typecheck + tests) runs on pre-push; **do not** `--no-verify`.
  A transient failure re-runs clean; a real failure gets fixed.
- **No `Co-Authored-By` trailers.** Keep the `Claude-Session:` trailer.
- Biome formats + lints (`biome.jsonc`). Run `biome check --write` on changed files before commit.

## 6. Deploy (see docs/DEPLOYMENT-AND-DEVOPS.md)

- OIDC → ECR → ECS Fargate, behind API Gateway HTTP API + VPC Link. Image tag is content-addressed
  (`git rev-parse HEAD^{tree}`). **Build once in testing → promote the same image** to staging/prod.
- Terraform in `infra/{dev,staging,prod}`; local state; apply with the **`app-dev`** AWS CLI profile
  (`AWS_PROFILE=app-dev`, `MSYS_NO_PATHCONV=1` on git-bash). Migrations run as a pre-deploy ECS task.
- Env gates (repo vars): `TESTING_DEPLOYMENTS_ENABLED=true`; **staging/production OFF**. Promote to
  testing by merging `dev`→`testing` (workflow_dispatch can't target the testing environment).
- Secrets via **AWS Secrets Manager** (Infisical is local-only, not in the deploy path). WorkOS =
  **Staging** env, Test IdP. Each app resolves its redirect/logout URIs from `<APP>_BASE_URL`, which
  must be registered in the WorkOS app's Redirects (both `/auth/callback` and `/login`).
- Health: a trivial `/healthz` route per frontend; Dockerfile forces `HOSTNAME=0.0.0.0`.

## 7. Redlines — never cross without an explicit human go

- **Never `terraform apply`, flip a deploy gate, or run a live external write without explicit human
  confirmation.** Testing already-enabled ≠ blanket permission for staging/prod.
- **Live SMS** (Arkesel: real sender-ID + funded wallet) and **live payments** (Paystack live keys)
  stay OFF — sandbox `sk_test_` / `SMS_PROVIDER=fake` only until a human flips them per engagement.
- Never enter credentials/card/API keys into a third party; never create accounts/passwords on the
  user's behalf; never seed the production DB casually. Print secret **prefixes** only, never values.

## 8. Local dev

- Full stack (SSO needs the API to resolve identity): `pnpm dev:stack:infisical` (db + API +
  frontends under Infisical) — NOT `dev:all` (frontends only). Postgres on **5432**. If sign-in fails,
  check the DB is up + the tenant/staff rows are seeded (`pnpm dev:seed:infisical`).
- Windows/git-bash: prefer the dedicated file/search tools; `MSYS_NO_PATHCONV=1` for `aws`/`gh` calls
  with `/`-paths; kill stale `.next` before a push if the dev server is fighting the build.
