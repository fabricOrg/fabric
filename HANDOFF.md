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
| `origin/dev` | `742d943` | #252, #253, #255, #256 |
| `origin/testing` | `2a20286` | promoted + DEPLOYED 2026-08-08 (#257); in sync with `dev` |

Nothing uncommitted. The testing deploy ran all six jobs green — gate, **`Migrate · testing db`
(0133 applied)**, Render api, and the three Vercel apps — and the pipeline verifies the artefact
itself, not just its own exit code: the api job polls `/health/readyz` on the live Render URL and
each frontend job checks `/healthz`.

**Two traps in reading that deploy.** The separate `Deploy` workflow reported **success while
skipping all eight of its jobs** — it is the AWS/ECS path and is gated off, so its green tick is not
evidence anything shipped. And a promotion PR title must be **Conventional Commits**: `promote: …`
is rejected by the PR-policy check (`chore(ops): promote …` passes).

**What the deploy did NOT prove.** The queue and rate limiter now run RESP3 (ioredis 6) against
testing's Redis, and nothing has exercised that — `readyz` does not touch them and no CI job ever
starts a Redis. A silent fall-through to the inline path looks identical to success from outside.
Settle it the way §9 says: a send whose `provider_ref` is a real vendor id, not `fake-…`, plus the
worker log line. Likewise the tenant kill-switch path is inert until an operator creates an override
— the deploy proves the migration, not the feature.

### Just shipped — tenant-targetable kill switches (#252)

`kill_switches` gained a nullable `tenant_id` (migration 0133): NULL is the platform breaker as
before, a workspace id is an override. Precedence is **platform OR tenant**, both rows read in one
query — an override can pause one workspace but never resume one past a platform halt.

This finished the work that was designed, implemented and WITHDRAWN. The three defects that sank it:
the cache stored a value derived from the row just written (toggles now INVALIDATE, and a read that
started before a toggle is discarded via a per-key generation); `tenantId` was not threaded through
the 12 call sites, leaving it inert; and the unit spec's mock ignored its own `where()` argument, so
the cache bug passed a green suite. The spec now runs on drizzle's `pg-proxy` driver — but note what
that does NOT prove: the fake reconstructs the predicate from bound params, so the SQL is asserted
directly for the tenant read and the six-combination matrix runs against real Postgres.

Uniqueness uses `UNIQUE NULLS NOT DISTINCT (key, tenant_id)`, not the two partial indexes originally
designed — the same constraint `uniq_plugin_instance` already relies on. A plain unique would be
worse than what it replaced: NULLs are distinct in Postgres, so unlimited duplicate PLATFORM rows
would be legal.

Two defects found on the way: `platform.email_sending` was gated in `email.service.ts` since it
shipped but **never seeded**, so it could not be flipped and always read operational; and
`platform.signup` is now marked NOT tenant-scopable (it is read before any workspace exists, so an
override would sit in the table looking meaningful while `signupEnabled()` never consults it).

No grant change — `app_runtime` stays REVOKEd (0132). `tenant_id` here is a SCOPE, not a boundary:
no RLS policy, provisioning connection still the only accessor. `security-layer.check.ts` uses an
explicit allowlist, so the new column breaks no assertion.

### Just shipped — bullmq 6 + ioredis 6 (#253)

Supersedes Dependabot #248/#249, both closed. RESP3 was the held concern; it is settled by
measurement, not reasoning: `CLIENT INFO` reports **resp=3** on both the rate-limiter client and
BullMQ's own connection, so RESP3 really is in use and nothing fell back. It works because ioredis 6
still defaults `replyMapping` to `"legacy"` (RESP2 reply shapes) and the Lua token bucket returns an
integer either way. Do not flip `replyMapping` to `"resp3"` without re-reading every call site.

bullmq 6 also drops `Queue#client` / `Worker#blockingClient` (unused here — the raw client comes from
`getBackend()` now) and makes `Queue.resume()` async (the one call site already awaited it).

**Closing a Dependabot PR manually means it will not re-raise that version.** #248/#249 were closed
in favour of #253, which carried the same versions and merged — but the same move on a PR that is
then abandoned silently drops the bump until a newer release appears.

### Still open from the grant sweep

The provisioner narrowing on `audit_events` (SELECT+INSERT, no UPDATE/DELETE) **records intent and
does not enforce it** — `prepareRoles()` (`src/cloud-migrate.ts:123`) re-grants `app_provisioner`
full DML on ALL TABLES every deploy. Enforcing append-only needs a re-assertion in
`cloud-migrate-privileges.ts`, the mechanism the GL tables already use.

**Find grant holes by asking Postgres, never by reading comments** — `has_table_privilege`, not
prose. Four of the six tables #250 fixed carried a comment asserting protection that did not exist,
and two cited a SIBLING as the reason they were safe while that sibling was itself a hole.

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

**`verify.integration.spec.ts` is FLAKY — one CI failure, cause NOT pinned.** Failed once on #253
(`expected 400 to be 201` at :216, the "rejects an expired code" test), passed on re-run. Ruled out:
the Redis bump (CI starts no Redis, so neither package is active there, and the same suite passed on
#252 with ioredis 5) and the spec itself (6/6 in isolation locally, green in a local full-suite run).

The CI log narrows it: the failing `POST /v1/verify` returned a **234-byte** 400 in **41 ms**. The
file's intentional throttle 400 is 211 bytes in 5 ms — `verify_resend_throttled`, whose envelope
computes to exactly 211 — so this is a different error, and 41 ms means it reached the send pipeline
rather than stopping at the throttle pre-check. `sms_sending_paused` (159) and `recipient_opted_out`
(194) don't match the length either.

**It could not be diagnosed further because the spec asserts `statusCode` only** — a failure yields
`400 ≠ 201` with no `error.code`, and the API does not log 4xx bodies. Make that assertion carry the
body BEFORE hunting again; otherwise the next occurrence is equally opaque.

Also open: #251, #214, #203 (typescript 7), #200.

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

**"The Redis containers are running" is not "Redis is reachable."** Both were up with NO published
host ports (`docker ps` showed a bare `6379/tcp`, `docker port` returned nothing), so every host
process silently took the no-Redis path. `docker compose up -d redis-queue redis-cache` recreates
them with the compose port mappings (6379, 6380). Check `docker port <container>`, not `docker ps`.

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
- **CI DOES run the integration suite.** An earlier revision of this file claimed
  "`integration:gate` is not wired into CI", and that claim was repeated into #253's commit message
  before being checked. `ci.yml` runs `pnpm verify:full`, which includes `test:integration`. What is
  actually true is narrower and still important: CI starts **Postgres but NOT Redis**, so
  Redis-dependent specs take their disabled/inline path there and a queue or limiter regression can
  still reach `dev` green. Verify a claim about the pipeline against `.github/workflows/`, not
  against this file.
- **A subset of specs is not the suite.** The Redis bump was validated locally against the 15 specs
  found by grepping `REDIS_QUEUE_URL` — a defensible subset that still missed `verify.integration`,
  which is what CI failed on. Grep-chosen scope answers "what mentions this", not "what this breaks".
- **A literal control character in source makes git treat the file as BINARY.** A NUL used as a cache
  key separator produced `Bin 0 -> 2498 bytes` in the diff: invisible in review, unmergeable on
  conflict, and the comment explaining it was unreadable. Write `\u0000`, never the raw byte. Caught
  in review, not by tests — every gate passed.
- **A stale checkout against a migrated DB fails in a way that looks like a code defect.** Running the
  pre-0133 kill-switch service against a DB that already had 0133 applied broke all three kill-switch
  specs (`ON CONFLICT (key)` no longer matches a constraint once the composite unique replaces it).
  Check which commit is checked out before believing a local integration failure.
