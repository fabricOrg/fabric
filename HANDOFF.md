# Fabric — session handoff

_Snapshot: 2026-07-08. Point-in-time; verify against code/git before asserting as fact. Companion to
[CLAUDE.md](./CLAUDE.md) (the how-we-build guide) and `docs/`._

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

## Shipped this session (PRs #71–#90, squash-merged to dev)

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
