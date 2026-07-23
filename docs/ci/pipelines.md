# CI pipelines — publish + testing deploy

Two GitHub Actions workflows added 2026-07-23. Both fail closed until their secrets/vars are
provisioned (Claude cannot set GitHub secrets or npm trusted publishing — these are owner actions).

## `publish.yml` — npm publish (SDK + CLI)

Publishes `@fabric-messaging/sdk` and `@fabric-messaging/cli` to the public npm registry with
**provenance via OIDC trusted publishing** (no stored npm token).

**Triggers (deliberate, never a plain push):**
- a GitHub **Release** whose tag is `sdk-v*` → publishes the SDK, or `cli-v*` → publishes the CLI;
- **workflow_dispatch** with a `package` choice (`sdk` | `cli`).

**One-time setup (npmjs.com, per package):** Package → Settings → Trusted publishers → add this
repository (`fabricOrg/fabric`) + workflow `publish.yml`. Provenance also needs the repo's Actions to
be allowed `id-token: write` (already set in the workflow). No `NPM_TOKEN` secret is used.

**Flow:** checkout → pnpm/node 22 → `pnpm install --frozen-lockfile` → `pnpm release:check` in the
package (build + typecheck + tests + pack smoke) → `npm publish --provenance --access public`.

## `deploy-testing.yml` — Vercel (frontends) + Render (API), TESTING ONLY

Testing runs on the free stack (Vercel + Render + Neon). **AWS (`deploy.yml` / `deploy-ecs.yml`) is
the FUTURE staging/production path and is left untouched** — this workflow adds only the testing
stack and has its own gate so the two never double-fire. There is **no staging/production job here**
by design; production stays on AWS behind its existing gates + a human go.

**Trigger:** push to `testing` (or manual dispatch), gated on `vars.VERCEL_RENDER_TESTING_ENABLED == 'true'`.

**Required config (GitHub repo or a `testing` Environment):**

| Kind | Name | Purpose |
| --- | --- | --- |
| var | `VERCEL_RENDER_TESTING_ENABLED` | `"true"` to enable this workflow (distinct from the AWS `TESTING_DEPLOYMENTS_ENABLED`) |
| secret | `VERCEL_TOKEN` | Vercel deploy token |
| secret | `VERCEL_ORG_ID` | Vercel org/team id |
| secret | `VERCEL_PROJECT_ID_DASHBOARD` | dashboard Vercel project id |
| secret | `VERCEL_PROJECT_ID_ADMIN` | admin-console Vercel project id |
| secret | `VERCEL_PROJECT_ID_WWW` | www Vercel project id (create the project first) |
| secret | `RENDER_API_KEY` | Render API key (already in Infisical) |
| secret | `RENDER_API_SERVICE_ID` | the api Render service id (e.g. `srv-…`) |

Each frontend job self-skips if its project id/token is absent, so you can enable apps incrementally
(e.g. dashboard + admin now, `www` once its Vercel project exists). The Render job polls the deploy to
`live` and fails the job on a failed/canceled deploy.

## Notes

- The AWS workflows (`deploy.yml`, `deploy-ecs.yml`, `aws-oidc-smoke.yml`) are intentionally retained
  for the future AWS staging/production path. Keep their `*_DEPLOYMENTS_ENABLED` vars **off** while
  AWS is suspended so their testing job doesn't fire against absent infra.
- First runs should be validated manually (dispatch) before relying on push-triggered deploys.
- Neither workflow deploys to production; production remains an explicit, human-gated action (§7).
