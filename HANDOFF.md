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
  (`0046`, provisioner + tenant_isolation). RLS boundary stays the workspace/tenant.

**Next (foundation, tasks #4–#8):** app/env contracts; backfill flat→hierarchy; re-key
api_keys/webhooks to application+environment; converge self-serve+ops provisioning; re-key routing +
go-live + E13 virtual-phone onto `environment.type`. Then Phases 1–5 per `docs/PI-6/PLAN.md`.

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
