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
- **Auth = WorkOS as the identity engine; sessions are user-level (ADR-0007).** email+password +
  Google + passkeys, SSO optional. The **customer realm is self-serve sign-up** (PI-6); the **staff
  realm stays invite-only/allowlist**. **Fabric owns the credential screens** (ADR-0008): the
  dashboard renders `/signin` + `/signup` (+ verify / reset / magic-code) and the BFF calls WorkOS
  **User Management APIs** — passwords transit our server in flight, **never stored or logged**;
  WorkOS keeps the store, hashing, breach detection, auth emails, and session crypto. The **hosted
  AuthKit page stays wired + themed as the FALLBACK** for MFA / SSO / passkeys / Radar challenges.
  Every path ends in the same sealed WorkOS session cookie. `@app/fe-auth` holds the realm +
  credential logic. Authorization is the **local membership role**, never WorkOS claims. Tenancy is
  Fabric `memberships` only — no per-tenant WorkOS org (ADR-0007). (No local dev-login bypass —
  local sign-in goes through the WorkOS Test env like every other environment.)
- **BFF pattern**: a browser never calls the API directly. Next route handler → server-only client →
  NestJS `/internal/*` guarded by `BFF_INTERNAL_TOKEN`; data-plane `/v1/*` calls use a short-lived
  minted tenant token (ADR-0003), customer integrations use `sk_*` keys. The BFF
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
  nothing) is worse than a clear "not configured" error. Delete such fallbacks. And **no stale
  code or lying comment**: once a path is live, delete the mock data + the "TODO: wire real
  endpoint" comment, and don't let a mock-shaped type (`@/lib/mock-*`) leak into a real flow — a
  comment or type that contradicts the running code is a defect, not documentation.
- **Availability posture — the data plane never dies because a dependency did.** The control plane
  is never in the hot path (Principle #7): a per-request check against control-plane state
  (kill-switch, rate limit, entitlement) reads through a short TTL cache and, on store failure,
  **serves last-known-good or fails open** — a provisioning/Redis outage must not fail every send.
  The exception is money: the wallet path **fails closed** (no reserve → no send). Know which
  posture a given check needs and say so in a comment.
- **Ship the trigger, not just the capability.** A scheduled/queued job (reservation sweeper,
  ledger-invariant check, outbox delivery) that exists only as library code + a test **is not
  shipped** — it needs a production caller (cron/worker) and a test that drives that caller. Money
  correctness that only holds in a unit test doesn't hold in prod.
- **Cross-boundary events go through the transactional outbox.** A domain event that a webhook or
  another system must see is INSERTed in the **same transaction** as the write it describes, then
  delivered by the poller/worker (at-least-once, signed, retried) — never a fire-and-forget
  `void promise` that a crash loses.
- **Tested against the real thing.** Business logic gets integration tests on a **real Postgres**
  (`*.integration.spec.ts`, run via `test:integration`, needs `DATABASE_URL_SUPER` + `DATABASE_URL_APP`).
  Assert the invariant (balance, idempotency, RLS denial), not just the happy call.
- **Files stay small** (a length guard runs on commit). Split before a file sprawls.

## 4. Patterns to reuse (don't reinvent)

- **Session resolution** (`services/api/src/identity`): the **customer realm self-serve provisions**
  on first login (ADR-0002/0004) — a verified stranger gets a fresh workspace + membership; a
  returning user binds their WorkOS subject and activates any pending invite. The **staff realm stays
  invite-only** — a staff user + allowlist row must pre-exist; no membership → denied, never
  JIT-create staff access.
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
- **No trailers of any kind.** No `Co-Authored-By`, no `Claude-Session:`, no generated-by footer. A
  commit is authored by the committer's own GitHub profile and carries nothing after the body.
- **Commit as your GitHub identity**, not a placeholder. This repo's history carries both
  `ABOAGYE SOLOMON <123629842+dacostaaboagye@users.noreply.github.com>` and a local
  `app-platform team <team@app-platform.local>` that does not link to a GitHub account — the former is
  correct. Check `git config user.email` before your first commit in a fresh clone or worktree.
- **The pre-commit hook cannot run during a rebase.** `validate-branch-name.mjs` rejects `<detached>`,
  which is what HEAD always is mid-rebase, so `git rebase --exec 'git commit --amend …'` fails on a
  false negative. Author-only rewrites need `--no-verify` on the *amend* — this is the one sanctioned
  exception and it does not extend to the pre-push gate above, which still runs in full.
- Biome formats + lints (`biome.jsonc`). Run `biome check --write` on changed files before commit.

### The review gate — HARD, no exceptions

**No change merges, and no change is reported as done, without an independent review. Logic and UI
alike.** Not a guideline and not scoped to money or security seams. If a review has not run, the work
is not finished — say so rather than merging.

- **Independent means not the author.** Self-review inherits the framing that produced the bug, so it
  does not satisfy this gate. Green gates do not either: they catch mechanical defects, never
  semantics. When delegates are unavailable, use a subagent — an outage is not a waiver.
- **Verify what the review claims.** A reviewer's finding is a hypothesis; confirm it against the code
  before acting, and confirm the fix by making the test fail without it. Reviewers also miss things,
  so a clean review is not proof either.
- **Size the review to the blast radius, never to the diff.** A twenty-line seed script that grants a
  membership or writes `plan` is authorization and go-live policy; a one-line copy change that
  describes a delivery gate is what a customer will act on.

**For a UI diff the reviewer gets these lenses explicitly** — none of them is picked by default:

1. **Trace every user-supplied value to where it is consumed.** A form field looks like taste and
   behaves like policy: `template_category` never reaches Meta, it selects our message class, and a
   free-text version let a caller skip both promotional gates and bill the wrong traffic class.
2. **Least user effort.** Fewest steps, clicks and decisions to the outcome. Derive what can be
   derived instead of asking; default what can be defaulted. Every error and empty state either
   offers the next action or names plainly who can act — a dead end is a defect, not a state.
3. **Consistency.** Reuse the shared primitives (`@app/ui` states, `DataTable`, the Form kit, `Card`)
   and the existing copy voice. One concept, one implementation. The standing debt is the warning:
   nine separate `StatusBadge`s and ~30 ad-hoc date formats all began as one reasonable local choice.
4. **Reusability.** A pattern appearing twice belongs in `@app/ui`, not copied a third time.
5. **One state per view.** A view early-returns exactly ONE of loading / error / empty
   (`states.tsx`). Two competing empty states on a page means the layout, not just the copy, is wrong
   — and an empty branch that renders a different information architecture is a different page, so the
   first success visibly reorganises it.

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
- **Never point an ECS service at a raw `terraform apply` task-def revision of the api/dashboard.**
  Terraform hardcodes the `:bootstrap` placeholder image; the REAL content-addressed image is
  injected only by the deploy workflow. A config-only task-def change (e.g. adding a secret) must
  ship through a deploy — or, for a hotfix, register a new revision that grafts the change onto the
  currently-running real image, then `update-service` to it.

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

## 9. Verify the artefact, not the report

Every false "done" in this repo has had the same shape: a *report* was trusted instead of the
*thing*. A command's own output, a green status, a schema file — none of them are the state. Check
what changed.

- **The Neon CLI is available — measure testing instead of inferring it.** `neondb` is owned by
  `app_migrator` like production, and `ALTER DEFAULT PRIVILEGES` is grantor-scoped, so an
  `app_owner`-owned LOCAL database hides grant holes that testing shows plainly. A local
  `has_table_privilege` reading "no DELETE" is not evidence there is no hole. Pass `--org-id` (the org
  prompt is interactive and will hang), capture the connection string into a variable and never echo it,
  and stay read-only unless a human said otherwise. See HANDOFF for the exact ids.
- **Never pipe a command whose exit code matters.** `cmd | tail` returns **tail's** status, so a
  failed push and a no-op promotion both reported success. Redirect to a file and capture `$?`.
- **Confirm a push/merge/deploy against the ref**, not the command's output:
  `git ls-remote --heads origin <branch>` vs `git rev-parse`. A `--ff-only` merge that refuses still
  leaves a clean-looking exit if it is piped, and `dev`→`testing` is a real merge (testing carries
  merge commits, so `--ff-only` cannot work).
- **A send is proven by `provider_ref`, never by `status`.** FakeProvider returns `accepted` exactly
  as a carrier does: `fake-<messageId>` vs a real vendor UUID. `/v1/sms/send` only reserves and
  enqueues — the **worker** calls the provider, so any API process sharing `REDIS_QUEUE_URL`
  competes for the job, and a sandbox-configured worker can swallow a live send silently.
- **Read grants back after a migration.** `ALTER DEFAULT PRIVILEGES` grants `app_runtime` DML on
  every new table, so a credentials table arrives world-readable to the tenant-facing role unless the
  migration explicitly `REVOKE`s. The schema file will not show you this.
- **A green *local* gate is not CI.** `@app/contracts` is consumed as built `dist`, so changing a
  contract type and running `typecheck` validates against **stale `.d.ts`** and passes falsely —
  `pnpm --filter @app/contracts build` first. Root `pnpm typecheck` also does not cover what
  `verify:push` runs (it misses `astro build` entirely).
- **`verify:push` gates the WORKING TREE, not the commit.** Editing files while a push runs fails it
  with errors from unrelated half-finished work, and a stale `.next` from another branch fails
  typecheck after a switch.
- **When a fix "should work" but doesn't, test the null hypothesis.** Three attempts went into Shiki
  theme *names* before trying Astro's own default and finding it failed too — which proved instantly
  that no named theme could work and the config was irrelevant.
- **`packages/ui` is consumed as RAW TS SOURCE** (`"./hooks/*": "./src/hooks/*.ts"`). NodeNext wants
  `.js` on relative imports; the apps' bundler then cannot resolve it. Keep shared hooks in one file.
- The file-length guard counts **one more line** than `wc -l`.

## 10. Delegating to external CLIs (codex / gemini)

Bulk work is routed to external agent CLIs to conserve Claude quota — see
`~/.claude/CLAUDE.md` for the routing table and the `delegate-*` skills. What that means
*here*:

- **What may be delegated.** Migrations, test scaffolding, mechanical refactors, renames,
  boilerplate, clear-spec feature work (codex); "where is X", subsystem maps, wide file
  sweeps, log analysis (gemini).
- **What may not.** Anything with taste: dashboard/portal UI, user-facing copy, API and
  contract shape, naming, error messages, UX flow. Codex scores 5 on taste and this repo
  is mostly user-facing surface. Architecture and boundary decisions stay on Opus too.
- **A delegate cannot see this file.** Paste the constraints the diff could violate into
  its prompt — the ones that actually bite: no `any` and no unchecked casts; zod DTOs in
  `@app/contracts` at every boundary; tenant-scoped queries inside `withTenant` /
  `withTenantDrizzle`; money as `bigint` `MinorUnits` with balanced double-entry;
  structured errors (`invalidRequest` / `notFound` / `unauthorized` / `forbidden`) with
  stable codes, never bare `throw new Error` across a boundary; cross-boundary events via
  the transactional outbox, not `void promise`; no mock or fallback that fakes success.
- **Gates run on the delegate's quota, not ours.** Tell it to run `pnpm verify:push` (or
  the narrower typecheck/lint/test commands) and `biome check --write` on changed files,
  and to loop until green before reporting. Claude does not run builds here.
- **Green gates are not a review.** Gates catch mechanical defects; read `git diff` for
  the semantics — does it fit the architecture, does it hold tenancy isolation, did it
  invent an abstraction nobody asked for.
- **The review gate in §5 is a hard gate and applies to delegated work too** — a delegate's
  output is reviewed by someone that is not the delegate, and "the delegate ran the gates"
  is not a review. Read §5 for the lenses, including the UI ones.
- **Delegates inherit §7 redlines, and they cannot ask for a human go.** No
  `terraform apply`, no deploy-gate flips, no live external writes, no production DB
  access, no live SMS or payments. State this in the prompt; never hand a delegate a task
  that requires crossing one.
- **`dev` is shared** (§5) — a delegate never rebases, resets, or force-pushes it, and
  never advances it outside a squash-merge.


---

## 11. Pre-production: breaking changes are ALLOWED

**Status: DEVELOPMENT. This section is live until the project owner says we are in production.**

Fabric has no external callers to protect. Treating a pre-prod codebase as if it did is how an
inconsistency becomes permanent at launch — three different webhook acknowledgement shapes, a list
endpoint returning a bare array while every sibling returns an envelope, a request body parsed with
an unchecked cast. Each of those survived a review by being labelled "breaking to change".

So, until told otherwise:

- **Break freely.** Response shapes, request contracts, enum values, route paths, database columns.
- **Do not build a compatibility path** — no deprecation window, no dual-shape adapter, no
  `v2` alias — unless explicitly asked for one.
- **Fix the inconsistency at its source** rather than documenting it as a known quirk. A doc entry
  describing a wart is a decision to keep the wart.
- **Say so in the commit body**: "breaking, pre-prod, allowed by §11". The change still gets a
  message explaining what moved and why.

**This does NOT waive §7.** Those redlines are about SAFETY, not compatibility: no `terraform
apply`, no deploy-gate flips, no live SMS or payments, no production database access, no live
external write without explicit human confirmation. "Breaking changes are allowed" means
compatibility is not a constraint. It does not mean risk is not a constraint.

**The §5 review gate still applies.** A breaking change is reviewed like any other — arguably more
carefully, since nothing downstream will catch it.

**When production is declared, delete this section** and replace it with the versioning policy
(F8.1). Leaving it in place after go-live would authorise exactly the wrong thing.
