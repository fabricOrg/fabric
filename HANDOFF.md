# Fabric — session handoff

_Snapshot: 2026-08-08. Point-in-time. **Verify against code and git before treating any of it as
fact** — `git fetch && git log HEAD..origin/dev` first, always. Companion to
[CLAUDE.md](./CLAUDE.md) (how we build) and `docs/`. Superseded entries live in
[docs/HANDOFF-ARCHIVE.md](./docs/HANDOFF-ARCHIVE.md)._

> **Keep this file short.** It is a snapshot of the CURRENT state, not a log — it had grown to 2,800
> lines of append-only history, which every session then paid to read. When you finish a milestone,
> REPLACE the state below; move the old entry to the archive only if it carries reasoning a commit
> message would lose. Git already records what happened.

---

## Where things stand

| ref | sha | note |
| --- | --- | --- |
| `origin/dev` | `03e51b1` | PR #250 + three Dependabot bumps |
| `origin/testing` | `3d58df0` | deployed 2026-08-08, all jobs green incl. `Migrate · testing db` |

Nothing uncommitted. `dev` and `testing` are in sync.

### Just shipped — every runtime grant hole is closed

PR #250 (migrations 0131 + 0132) finished the sweep #242/#243/#244 began. Verified against the live
schema after applying: **68 tables — 45 protected by RLS, 23 by REVOKE, 0 unprotected.**

Six tables had neither RLS nor a REVOKE, so `app_runtime` (the tenant-facing role) held full DML:
`auto_topup`, `payment_authorizations`, `plugin_instances`, `proposals`, `kill_switches`,
`audit_events`. All six are now in the `db:assert security` loop — that loop, not the prose, is what
stops the boundary drifting back.

**Find these by asking Postgres, never by reading comments.** `has_table_privilege('app_runtime', …)`
against `relrowsecurity` plus the presence of `tenant_id`. Four of the six carried a schema comment
asserting protection that did not exist, and two cited a SIBLING as the reason they were safe —
`kill-switches.ts` named `plugin_instances`, `audit.ts` named `staff_users`. Every table so cited was
itself a hole at the time. A comment is not a grant.

One caveat recorded in 0132: the provisioner narrowing on `audit_events` (SELECT+INSERT, no
UPDATE/DELETE) **records intent and does not enforce it** — `prepareRoles()`
(`src/cloud-migrate.ts:123`) re-grants `app_provisioner` full DML on ALL TABLES every deploy.
Enforcing append-only needs a re-assertion in `cloud-migrate-privileges.ts`, the mechanism the GL
tables already use.

---

## Read this before touching sends

**There is no "go live" step, and any non-sandbox workspace is already live.**
`virtual-phone.service.ts:60` makes live the default; virtual is opt-IN. Go-live gates the transition
OUT of the `sandbox` plan, so a workspace seeded straight onto a paid plan starts on the far side of
it. `Fabric Local` is `plan = growth` with `settings = {}` → live.

Combined with an armed live provider instance, that means **real carrier, real money**, including
from `pnpm test:integration`. Two incidents came from this:

- The integration suite reached a live vendor. Fixed — the spec pins its own provider.
- The integration suite **destroyed** the armed Arkesel live credential via an unqualified
  `delete(pluginInstances)`. Unrecoverable; re-installed by hand. Guarded since by
  `assertDisposablePluginCatalog()`.

Consider seeding local/testing workspaces as `plan = 'sandbox'` (forced virtual, `locked: true`) and
flipping deliberately. Seed change only, no product code.

**Live sends read `accepted` → `expired` even when they arrive**, because the Arkesel DLR callback is
not configured. Money and credits are unaffected; only status. Route is
`/webhooks/dlr/arkesel-sms`, guarded by `WEBHOOK_INGRESS_TOKEN` (header `x-webhook-token` or
`?token=`, since Arkesel GETs with `?sms_id=..&status=..`).

---

## Open work

**Tenant-targetable kill switches — designed, implemented, WITHDRAWN.** Do not restart from scratch;
the design survived review and only the implementation was wrong. Design: nullable `tenant_id` on
`kill_switches` (NULL = platform breaker); two PARTIAL unique indexes, because a plain
`unique(key, tenant_id)` lets NULLs repeat and would permit several platform rows per key;
precedence is `platform OR tenant` so a tenant row may pause but never resume. Must fix before it
ships:

1. `toggle` must not cache a value derived from the tenant row alone — that defeated the precedence
   rule the migration claimed to enforce.
2. Thread `tenantId` through all 12 `isPaused` call sites, or the feature is inert (it was).
3. Repair the `kill-switches.service.spec.ts` mock FIRST — it silently swallowed the rewrite, which
   is how the cache bug survived.
4. Tests for all six platform/tenant combinations plus toggle-then-read.
5. `prune.integration.spec.ts:33` needs the same partial-index predicate as `ensureCatalog`.
6. Admin console must render and send `tenant_id` — today its "Resume" resumes the platform breaker.
7. Split the service under 300 lines; regenerate the drizzle snapshot for the schema change.

**Dependabot — #248 (bullmq 6) and #249 (ioredis 6) held.** ioredis 6 defaults to **RESP3**, which
changes reply shapes for the Lua/`EVALSHA` token bucket (`rate-limit.service.ts:78`) and the queue
connection (`queue.service.ts:58`); neither passes `protocol`. bullmq 6 makes `ioredis` a peer
(`>=5.0.0`) where 5.81 hard-pinned it, so the two interact. **No CI workflow starts a Redis**, so
their green tick proves typecheck, not behaviour — `verify` is `validate && build`, and
`integration:gate` is not wired into CI. Both Redis containers now run locally, so these can be
tested for real before merging. Also open: #251, #214, #203 (typescript 7), #200.

**Standards audit — safety net only.** Route error boundaries and shared `RouteError`/`RouteLoading`
landed. Still open: ~25 missing `loading.tsx`; five empty-vs-error conflations where a fetch failure
renders as "you have nothing" (`dashboard/senders:121`, `dashboard/templates:236`,
`admin-console/senders:40`, `admin-console/maker-checker:53`, `tenants/[slug]:182`); nine separate
`StatusBadge` implementations; ~30 ad-hoc date formats. `Card` now draws blueprint corner marks
app-wide — anything inside `overflow-hidden` or a grid tighter than `gap-6` needs `corners={false}`.

---

## Local environment

Postgres and both Redis containers run under `channel-packages-*`. **Port 5432 is contested** — a
different project's `lesson2_postgres` held it, which surfaces as `password authentication failed for
user "app_owner"` rather than anything obviously about the wrong container. Check `docker ps` first.

`drizzle.config.ts` reads `process.env` with no dotenv loading, so `pnpm db:migrate` needs the env in
process. Each worktree needs its own gitignored `.env`.

**The local DB has pre-existing data damage**: `token_counters` holds balances while `token_lots`,
`token_holds` and `ledger_entries` are all empty, so `db:assert` fails on reconciliation (the
security section passes). Cause undetermined — every spec's ledger delete is tenant-scoped and no
spec hardcodes the seed tenant. A reset would clear it, at the cost of the re-installed Arkesel
credential.

---

## Traps this repo keeps re-learning

Durable ones live in [CLAUDE.md](./CLAUDE.md) §9. These are recent and not yet promoted:

- **`tsc` cannot see a client/server boundary error.** Exporting a parser from a `"use client"`
  module made every export a client reference; the server component calling it threw at request time
  with perfectly valid types.
- **Green typecheck + a passing DB script is not a tested change.** A service rewrite shipped with
  three failing unit tests because the specs were never run — and the broken mock meant the rewritten
  method was never executed by any test at all.
- **Unlayered CSS beats every Tailwind utility** regardless of specificity. Custom classes need
  `@layer components` or per-call-site overrides silently do nothing.
- **`git cherry` is useless against a squash-merge workflow** — it is patch-id based and reports
  every commit as unmerged. Use a two-dot `git diff` to ask whether content actually landed.
- Windows: bash writes `/tmp/x`, node reads `D:\tmp\x`. Use an absolute scratchpad path. Heredocs
  also mangle backticks inside doc comments — use the Edit tool.
