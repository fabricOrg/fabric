# Fabric — session handoff

_Snapshot: 2026-07-12. Point-in-time; verify against code/git before asserting as fact. Companion to
[CLAUDE.md](./CLAUDE.md) (the how-we-build guide) and `docs/`._

## Current direction (2026-07-12): PI-6 — self-service developer platform pivot

Product direction pivoted to a **self-service developer platform** (Stripe/Twilio/Resend-class).
Self-serve sign-up becomes the **primary** onboarding; ops-provisioning is demoted to an
**enterprise exception**; **dev-portal merges into the customer dashboard**; admin-console
tenant-invite-as-primary is removed. Plan: `docs/PI-6/PLAN.md`. Baseline: ~60-70% already exists
(PI-4 verify-first + ADR-0002 self-serve sandbox + ADR-0003 BFF tokens).

**Locked decisions (2026-07-12):** build a real **Workspace → Application → Environment** hierarchy
(**ADR-0004**, supersedes ADR-0002's flat sandbox-entitlement); landing = a **separate marketing
app**; SDKs **Node + Python** first; **Email + AI assistant deferred** to later PIs.

**Branch `feature/e14-workspace-hierarchy`** (off the E13 tip — depends on E13 landing in `dev`
first; then rebases). **Local commits only, NO push until the program is done** (user directive).
Milestones so far:
- ADR-0004 + PI-6 plan committed (`2301adc`).
- Foundation schema: `applications` + `environments` tables (migration `0045`) + RLS/grants
  (`0046`, provisioner + tenant_isolation). RLS boundary stays the workspace/tenant. Cross-tenant
  read/write denial + fail-closed proven — full db integration suite green, 34 tests (`337ae79`).
- Application/environment zod contracts in `@app/contracts` (`c537739`).
- Backfill flat→hierarchy: `cloud-backfill-app-env.ts` (in-image, runs as `app_provisioner` — the
  only cross-tenant role, since FORCE RLS binds even the owner and nothing has BYPASSRLS) + its
  in-VPC ECS task-def. Also re-points existing keys/webhooks. Verified on real Postgres, idempotent
  (`16b081d`).
- `api_keys` + `webhook_endpoints` gain `application_id`/`environment_id` (migration `0047`,
  nullable during two-step backfill) (`c523157`). API keys mint into the default app's env matching
  the key type; live keys gate on the live env being `active` (not on `accounts.plan`); `resolve()`
  + `req.tenant` carry app/env; 8/8 spec green (`a58d2f4`). Webhook endpoints scope to the default
  app's sandbox env (`8f6b512`).
- Both provisioning paths birth the hierarchy: self-serve → live env LOCKED (go-live unlocks); ops
  (enterprise exception) → live env ACTIVE. Converged with the backfill; self-serve spec asserts it,
  5/5 green (`7451ed8`).

- SMS routing keys on `environment.type` (sandbox env → virtual, never a carrier), not
  `accounts.plan`; `send()` uses the presenting key's env, falls back to plan-based for the BFF
  token path; sandbox-routing spec exercises the env pin, 4/4 (`912cd03`).
- Go-live unlocks the live environment (`locked→active`) — the functional gate live-key minting +
  live routing depend on; proposals spec asserts it, 8/8 (`f30a65a`).

**ADR-0004 FOUNDATION COMPLETE — the Workspace→Application→Environment model is in end-to-end:
schema, RLS, contracts, backfill, per-env keys/webhooks, converged provisioning, env-based routing,
go-live env-unlock. Every step tested on real Postgres. All committed, NOTHING pushed.**

Residual hardening (tracked, NOT core, no regression) — task #9:
- `outbox_events` gains `environment_id` + env-filtered webhook delivery (matters once multiple envs
  have live endpoints; delivery is tenant-scoped all→all today, unchanged from before).
- E13 `delivery_mode` moves from `accounts.settings` onto the environment once the dashboard has an
  env selector.

**Phase 2 (applications API):** `GET/POST /v1/applications`, `ApplicationsService.list/create`. New
app is born sandbox-active / live-locked; duplicate slug → 400; tenant-scoped (RLS). 4/4 integration
green (`c5814c4`). Then made customer-consumable (`af4419d`): a new `OperatorOrTenantGuard` lets the
one controller serve BOTH the staff/ops operator path (operator-supplied tenantId) AND the customer
dashboard's tenant-token path (ADR-0003 minted token → `req.tenant`; tenantId derived from the token,
NEVER the client). A present operator token must be valid (no silent fall-through); absent → the
ApiKeyGuard path runs. This sets the reuse pattern for W-B (keys/webhooks real-wiring). Controller +
guard unit specs (11) + full api integration suite (117) green; also fixed stale `api-key.guard.spec`
assertions predating the ADR-0004 `req.tenant` app/env fields.

**Phase 2/3 (dashboard Applications surface) — DONE (`e0f87e5`):** the FIRST customer-facing consumer
of the applications API. New `/applications` dashboard section (server component) lists the workspace's
apps with each one's environment status (sandbox active / live locked-until-go-live) + an owner/admin
create dialog (TanStack Form against `createApplicationRequestSchema`, slug auto-derived). Server-only
`applications-client` calls `/v1/applications` via `dashboardApi` (session-minted tenant token) and
parses the response against the contract; BFF POST route gates trusted-origin + session (refresh
fallback) + owner/admin. Added `applications:read` (universal — the switcher is a core surface) +
`applications:write` (owner/admin) to the role→permissions map so the BFF gate resolves; dev-login
stub matched. Verified: dashboard typecheck + production build green (`/applications` +
`/api/applications` compile), identity specs green (21). NOTHING pushed.

**Auth pivot — DONE (`4bf5a4c`), locked rule OVERRIDDEN per user directive.** SSO-only → **WorkOS
AuthKit hosted self-serve** (email+password + Google + passkeys, SSO optional; WorkOS hosts every
credential form, we own none). Customer realm self-serve; staff realm invite-only. CLAUDE.md §1+§4
rewritten. **Dev-login bypass DELETED** (shared `fe-auth/development.ts` + all 3 apps + dashboard
`/auth/development` route + bypass e2e + `DEV_AUTH_ENABLED`/`DEV_SESSION_PASSWORD`/`DEV_TENANT_ID`
env) — local sign-in now goes through the WorkOS Test env like every env. **`/login` no longer an
intermediate "click again" page** — 302s straight to the AuthKit hosted page (renders only for a
denial/sign-out banner); verified live (forwards to `…authkit.app`). Copy de-SSO'd → "Sign in" /
"Create an account". dev-portal edits were mandatory-only (it imported the deleted shared module) —
it's being deleted in W-B, don't invest.
- **Stripe-style LOOK is WorkOS-dashboard config (EXTERNAL — human):** enable Email+Password /
  Google / Passkeys, apply Fabric branding + one-screen layout, optional custom auth domain; confirm
  each `<APP>_BASE_URL/auth/callback` + `/login` redirect URIs.
- **"Access denied" after sign-in = self-serve signup gate OFF.** Now the **`platform.signup`
  kill-switch** (not an env flag) — fails closed, seeded OFF, toggled live from the admin console
  (`4bf5a4c`… converted in a later commit). A new WorkOS account isn't auto-provisioned a workspace
  until it's flipped on. Flipping it = **W-A**, testing-only; staging/prod human-gated redline (and
  gated on Phase-5 abuse controls existing first).

**W-B slice 1 — API keys real, under an application (`28e616f`).** First dev-portal→dashboard merge
slice. Keys were mock in the dev-portal; now real on the tenant-token API. Per ADR-0004 they live on
the **application-detail page** `/applications/[slug]`, split into **environment sections** (Sandbox
always; **Live hidden until go-live** unlocks it — a sandbox workspace never sees a live table).
`ApiKeysController` reuses `OperatorOrTenantGuard`; `ApiKeyService.create/list` gained an optional
`applicationId` (mint into the NAMED app's env, not just `default`; list filters by app). owner/admin
gained `api_keys:read/write`. Application cards link to the detail + show/count only ACTIVE envs.
Flat `/api-keys` page + nav item removed. **Fixed** a real bug: the tenant-token client set
`content-type: application/json` on every request, so a bodyless DELETE tripped Fastify's empty-JSON
parser → 400 and revoke silently failed; now set only when there's a body. **Browser-verified**
end-to-end (create → once-only secret; revoke → 200 → Revoked). **Key expiry/TTL added (`86bebae`,
migration 0048):** `api_keys.expires_at`; `resolve()` rejects expired keys (auth lookup gains
`expires_at IS NULL OR > now()`); create dialog Expires select (Never/30/60/90d) + table Expires
column. Integration-proven (future-expiry resolves; expired → null). Follow-ups: webhooks + request
logs (next W-B slices, still mock in dev-portal).

⚠️ **Running API dev server was serving STALE code this session** (didn't hot-reload the api-keys
controller/service edits — a live create wrote NULL expiry despite correct, integration-proven code;
a direct BFF probe confirmed the request reached the API but the stale handler dropped it).
**Restart the API** (`dev:stack:infisical`) to pick up this session's api-keys backend (app-scoping +
expiry). Dashboard-side changes hot-reloaded fine (revoke fix verified live).

**Next — Phases 1–5** per `docs/PI-6/PLAN.md` (frontend-heavy): global environment SWITCHER (chrome
control that pins the selected app/env into subsequent calls — keys, sends; tied to task #9 moving
`delivery_mode` onto the environment); **W-B dev-portal→dashboard merge** — real-wire the still-MOCK
developer surfaces (`apps/dev-portal` keys/reference/webhooks/logs use `@/lib/mock-api`) as
`developer_access`-gated dashboard sections scoped per app-env; marketing app (separate); flip
the `platform.signup` kill-switch in testing (needs human go — redline); Node/Python SDKs; usage;
admin-console realignment. Email + AI are later PIs. Frontend verifies via build/browser, not the
integration-test discipline — different cadence. NB: a live browser drive of `/applications` needs the
full stack up (db + infisical api + dashboard + dev-seed); the tenant-token path itself is API-layer
integration-proven.

**Branch commits (E14):** `2301adc` ADR/plan · `337ae79` schema+RLS · `c537739` contracts ·
`16b081d` backfill · `c523157` key/webhook columns · `a58d2f4` key mint/resolve · `8f6b512` webhook
scope · `7451ed8` provisioning · `912cd03` env routing · `f30a65a` go-live env-unlock · `c5814c4`
applications API · `af4419d` applications API tenant-token path · `e0f87e5` dashboard Applications
surface + permissions · `4bf5a4c` remove dev-login bypass + login forwards to AuthKit (auth pivot) ·
`d68113e` self-serve gate → platform.signup kill-switch · `0400737` ApplicationCard restyle ·
`28e616f` API keys under an application per env (W-B slice 1) (+ HANDOFF/doc commits). Merge order
when done: E13→`dev` first, then this rebases (fifi merges).

_Milestone rule (user directive 2026-07-12): update this HANDOFF.md at every milestone._

## Where things stand

**All 4 apps are DEPLOYED and live in the AWS testing env** (account 677035504110 / eu-west-1),
OIDC→ECR→ECS Fargate behind API Gateway:

| App | URL |
|---|---|
| API | `https://jl4j64pxl3.execute-api.eu-west-1.amazonaws.com` |
| Dashboard (customer :3100) | `https://eq0ydft9pa.execute-api.eu-west-1.amazonaws.com` |
| Admin-console (staff :3300) | `https://leg9wvf1bb.execute-api.eu-west-1.amazonaws.com` |
| Dev-portal (developer :3200) | `https://ko1yjzer8b.execute-api.eu-west-1.amazonaws.com` |

`dev` HEAD ≈ `558e723`. `testing` promoted to it (migrations 0022–0026 applied). Deploy uses the
**`app-dev`** AWS CLI profile (the default profile has NO creds; on git-bash set `MSYS_NO_PATHCONV=1`
for `aws`/`gh` calls with `/`-paths). Seeded testing staff admin: `dacsolo10@gmail.com` (via a
`cloud-seed` ECS run-task).

## Architecture-review remediation (2026-07-09, PRs #96–#111, squash-merged to dev)

Worked an architecture + admin-console review to merged PRs, one finding per PR
(`team/product-owner/ARCHITECTURE-FIXES-PROMPT.md` is the tracking doc):

- **Money correctness:** scheduled reservation-sweeper + ledger-invariant job (#96); client
  `Idempotency-Key` on `POST /v1/sms/send`, no double-charge on retry (#97).
- **Data-plane hardening:** kill-switch TTL cache w/ last-known-good fallback (#98); pino
  structured logging + request-id (#99); token-bucket rate limiting per key + per tenant (#102).
- **Async spine (build-now):** BullMQ send pipeline — provider call + tx2 in an in-process worker,
  tx1 stays in-request, inline fallback (#100); **ElastiCache Redis applied to testing** +
  `REDIS_QUEUE_URL` on the api task-def (#101); transactional outbox + HMAC-signed tenant webhooks
  (#105); provider kill-switch wired to the send path + dead switches pruned (#107).
- **Admin console:** dropped `mock-admin` dead code + repointed at contracts + codified CLAUDE.md
  §3 standards (#106); trusted-origin CSRF gate on every BFF mutation route (#103); single-flight
  token refresh + typed failure semantics + dev-portal helper (#104); vitest bootstrap + first
  tests (#108); tenant detail route keys on slug (#109); **standardized keyset pagination across
  all control-plane tables** (#110); tenant lifecycle actions suspend/reinstate/soft-close (#111).
- **Docs:** ARCHITECTURE §4/§5/§10 + IDENTITY §12.5 (invite-only) / §3.3 (SLO) reconciled to
  as-built (this PR).

**Still open:** A1 full act-as impersonation (plan approved, not built — largest item);
back-channel SLO; MFA enforcement (env-gated); OTel tracing/metrics; admin-console
component/e2e tests. Redis infra is the one applied `terraform apply` (human-confirmed).

## Shipped in the prior session (PRs #71–#90, squash-merged to dev)

Auto top-up · Arkesel SMS adapter + DLR (sandbox) · full UI standardization (PageHeader, shadcn
date/time pickers, DataTable, Form kit, StatCard, chart skeletons, first-class states) · big-bang
TanStack (Query/Table/Form) migration across all 3 apps · real overview (no mocks) · Transactions/
Lighthouse flow slices 1–2 (persist + real Paystack collection via webhook) · SSO journey fix
(denied/signed-out flash-cookie banners, authed→home bounce) · admin+dev deploy plumbing (#87) ·
invite provisioning (#88: staff WorkOS onboarding + `developer` role) · member management (#89:
role-change / soft-remove / resend) · admin-console tenant-member management + dropped provisioning
mock (#90).

## In flight (branch `fix/ops-callback-base-url`, not yet merged)

Fixes the deployed admin/dev callback redirecting to `http://0.0.0.0:3000` after WorkOS auth (built
redirects from `request.url`, which behind API Gateway is the container's internal host). Now uses a
`redirectUrl()` helper resolving `<APP>_BASE_URL`. Also carries this `HANDOFF.md` + `CLAUDE.md`.
**Next:** PR → CI → squash-merge to dev → promote `dev`→`testing` (`git checkout testing; git merge
--no-ff origin/dev; git push`) → redeploy. Until then, deployed admin/dev login dead-ends on
`0.0.0.0:3000`.

## To log in to deployed admin/dev

Invite via the real flow (dashboard Team / admin-console Staff). Unprovisioned identities get the
now-explained `access_denied`. `dacsolo10@gmail.com` is already a testing staff admin → lands on the
Staff Console once the callback-base-url fix deploys.

## Next candidates

- Flows slice 3 (human-gated): real Verify provider + OTP delivery + live SMS notify.
- Staging/production deploy jobs for admin/dev (mirror dashboard) + staging/prod Terraform → flip
  gates (human go).
- Real auth provider off the WorkOS Test IdP (enable Google / email+password at the env level, or
  per-tenant SSO connections) — env-level toggle, no code.
- SMS live: Arkesel done + gated; needs sender-ID approval + funded wallet (human).

## Redlines — never cross without an explicit human go

`terraform apply`, deploy-gate flips, and live external writes need explicit confirmation. **Live
SMS** (Arkesel real) and **live payments** (Paystack live keys) stay OFF — sandbox `sk_test_` /
`SMS_PROVIDER=fake` only. No credentials into third parties. Print secret prefixes, never values.

_Deeper, always-current state also lives in the assistant's memory (`MEMORY.md` index →
`deploy-state`, `auth-provisioning-state`, etc.)._
