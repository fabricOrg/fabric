# ADR 0004: Workspace → Application → Environment model (supersedes flat sandbox-entitlement)

Status: accepted 2026-07-12 (product owner; fifi to ratify sequencing before merge to `dev`).
Supersedes: the **"sandbox is an entitlement state on the tenant, not a separate environment"**
decision in ADR-0002 (§ Decision, bullet 4). Everything else in ADR-0002 — self-serve sign-up,
WorkOS AuthKit unchanged, go-live as the compliance gate, invite retained as enterprise exception —
**stands**. This ADR changes the resource-scoping model only.

## Context

ADR-0002 deliberately went flat: the tenant (`accounts` row) is the only container; "sandbox vs
live" is a `plan` flag on it; API keys carry an `env` enum (`test`/`live`); routing pins to the fake/
virtual provider when `plan === 'sandbox'`. That was the fastest way to ship the self-serve golden
path and it worked.

The product direction is now a **self-service developer platform** comparable to Stripe/Twilio/
Resend. Those platforms give developers a first-class object hierarchy: an org/workspace contains
**applications** (projects), and each application has **environments** (test/sandbox and
production) that independently own credentials, webhooks, logs, sender IDs, and usage. Developers
expect to run several apps in one workspace, each with isolated test and live keys, without
spinning up a new account. The flat model can't express "two apps, each with its own sandbox and
live keys" — it has exactly one `env` axis per tenant.

## Decision

Introduce an explicit three-level hierarchy. Product names in the UI; internal table names in code.

- **Workspace** = the existing `accounts` row (the tenant). Unchanged as the **RLS isolation
  boundary** and the WorkOS-organization anchor (1 workspace ↔ 1 WorkOS org, as today). "Workspace"
  is the product-facing name for a tenant; we do **not** rename the `accounts` table (churn/risk).
- **Application** = new `applications` table. FK `tenant_id → accounts.id` (carries `tenant_id`, so
  the existing `tenant_isolation` RLS policy applies unchanged). A workspace has one or more
  applications; a **default application** is auto-created at provision time.
- **Environment** = new `environments` table. FK `application_id → applications.id` plus
  `tenant_id` (for RLS). `type ∈ {sandbox, live}`, `status ∈ {active, locked}`. Every application
  gets a **sandbox** environment at creation; the **live** environment exists but is `locked` until
  go-live unlocks it (compliance gate, ADR-0002). Sandbox is now **a real environment**, not a plan
  flag — this is the precise sentence ADR-0002 is reversed on.
- **Scoped resources move under environment.** `api_keys`, `webhook_endpoints`, sender IDs, request
  logs, and usage gain `application_id` + `environment_id`. The `sk_test_`/`sk_live_` prefix
  continues to encode the environment type (a key's `env` maps to its environment's `type`); live
  keys can only be minted for an **active** live environment.
- **Routing pins on `environment.type`, not `accounts.plan`.** A `sandbox` environment can never
  reach a real carrier — enforced in provider routing exactly as before, keyed on the environment
  instead of the plan. `accounts.plan` remains, but only as a **billing tier**, no longer the
  sandbox/live switch.
- **RLS boundary stays the workspace.** `applications` and `environments` are tenant-scoped tables
  under the same `tenant_isolation` FORCE-RLS policy. App/environment selection is an app-layer
  `WHERE` within the tenant; the possession-scoped API-key auth lookup now resolves a presented key
  to `(tenant, application, environment)`. No new cross-tenant surface, no BYPASSRLS.

## Migration & backfill (order-tolerant, idempotent)

1. Create `applications` + `environments` (+ enums) via `drizzle-kit generate`; RLS policies +
   grants as hand-written raw SQL (`IF NOT EXISTS`), journaled + snapshotted (per CLAUDE.md §4).
2. Backfill: every existing `accounts` row → one **default application**; that application →
   a **sandbox** environment (always) and a **live** environment whose `status` is `active` iff the
   account is already live today (`plan !== 'sandbox'`), else `locked`.
3. Backfill scoped resources under the default application: `api_keys.env='test'` → sandbox env,
   `env='live'` → live env; `webhook_endpoints` → the environment matching their current usage.
4. Add `application_id`/`environment_id` as nullable, backfill, then `NOT NULL` in a follow-up
   migration once all writers set them (two-step, so a mid-deploy old writer can't insert a null).
5. Self-serve provisioning (`identity/self-serve-provisioning.service.ts`) and ops provisioning
   (`admin/tenant-provisioning.service.ts`) both create workspace → default application → sandbox
   environment atomically; the two paths converge on one provisioning core.

## Consequences

- **Net-new tables + a schema/contract sweep.** New `applications`/`environments` contracts in
  `@app/contracts`; `api-keys`, `webhooks`, `senders`, logs DTOs gain app/env identifiers. This is
  the spine the Build/Team/Production phases scope to — biggest single piece of the pivot.
- **E13 rework.** Virtual-phone test mode and the `delivery_mode` on `accounts.settings` assume
  sandbox-as-plan; they re-key onto `environment.type`. E13 is unmerged to `dev`, so this ADR's
  branch sits on top of the E13 tip and reworks it rather than colliding post-merge.
- **Go-live changes shape.** The `go_live` maker-checker proposal now **unlocks the live
  environment** on an application (status `locked → active`, mints `sk_live_*`, real routing)
  instead of flipping `accounts.plan`. The review flow and second-operator gate are unchanged.
- **Workspace switching becomes meaningful** (Phase 3): a user with memberships in multiple
  workspaces, each with multiple applications, needs an application/environment switcher in the
  merged dashboard. `memberships` already supports many workspaces per user.
- **RLS churn is bounded** — the isolation boundary does not move; only new tenant-scoped tables
  join the existing policy. Verified by `*.integration.spec.ts` asserting cross-tenant denial on the
  new tables and per-environment key isolation.
- Risk accepted: more objects to reason about on the first-run experience. Mitigated by progressive
  disclosure — a new workspace shows exactly one application + its sandbox; the hierarchy only
  surfaces when the developer creates a second app.
