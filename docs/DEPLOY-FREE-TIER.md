# Free-tier stakeholder hosting (AWS suspension interim)

> AWS account suspended 2026-07-18 (credits exhausted). This stack replaces the ECS testing env
> for stakeholder testing until reactivation. The AWS pipeline (`deploy.yml` → ECS, promote-image
> model) stays the production design — nothing here changes it.
>
> Shape: **Neon** (Postgres, free) · **Render** (API, free — sleeps when idle, 30–60s wake) ·
> **Vercel Hobby** (dashboard + admin-console) · **no Redis** (inline dispatch fallback is the
> design) · **WorkOS Test env** (already free). Redlines hold: `SMS_PROVIDER=fake`, `sk_test_`
> keys only, no live payments.

## 1. Neon (Postgres)

1. Create a Neon project (region: Frankfurt). The default role owns the database.
2. As that role, create the four Fabric roles (same shape as local/RDS — Neon also forbids
   BYPASSRLS, which is fine: the provisioner works through its permissive RLS policy):
   ```sql
   CREATE ROLE app_migrator LOGIN PASSWORD '…';
   CREATE ROLE app_runtime  LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE;
   CREATE ROLE app_provisioner LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE;
   ```
3. From a local shell, run migrations + assertions against Neon (owner/migrator URL):
   ```bash
   DATABASE_URL_OWNER=<neon-owner-url> pnpm --filter @app/db migrate
   DATABASE_URL_SUPER=<neon-owner-url> DATABASE_URL_APP=<neon-app_runtime-url> pnpm db:assert
   ```
   `db:assert` green on Neon = FORCE RLS + grants hold there exactly as designed.
4. Seed (tenant + templates + staff): `dev:seed` pointed at the Neon URLs.

## 2. Render (API)

`render.yaml` at the repo root is the blueprint. In Render: New → Blueprint → pick the repo.
Set the `sync: false` secrets from Infisical (values never live in git):
`DATABASE_URL_APP`, `DATABASE_URL_PROVISIONER` (Neon role URLs), `BFF_INTERNAL_TOKEN`,
`TENANT_TOKEN_SECRET`, `OPERATOR_TOKEN`, `PII_MASTER_KEY`, plus the WorkOS API key/client id the
identity module reads. Health check: `/health`.

## 3. Vercel (dashboard + admin-console)

Two projects off the same repo (Vercel detects the pnpm workspace):

| Setting | dashboard | admin-console |
| --- | --- | --- |
| Root directory | `apps/dashboard` | `apps/admin-console` |
| Framework | Next.js | Next.js |
| Env `API_BASE_URL` | Render URL | Render URL |
| Env `<APP>_BASE_URL` | its own Vercel URL | its own Vercel URL |
| Shared env | `BFF_INTERNAL_TOKEN`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, cookie password | same |

`<APP>_BASE_URL` matters: auth redirects resolve against it, never `request.url` (the API-Gateway
lesson applies to any proxy, Vercel included).

## 4. WorkOS (Test env)

Register per app in the WorkOS dashboard Redirects: `<vercel-url>/auth/callback` (redirect URI)
and `<vercel-url>/login` (sign-out). Same shared WorkOS app as before.

## 5. Smoke

1. `https://<render>/health` → 200 (first hit may take a minute — the service is waking).
2. Dashboard `/login` → WorkOS hosted page → sign in → workspace loads.
3. Send a managed message from `/templates` or the SDK against the Render URL with an `sk_test_`
   key; watch it in `/message-deliveries`.

## Costs and limits to remember

- Render free sleeps after ~15 min idle; a waking request can exceed the dashboard BFF's fetch
  timeout — refresh once. Do not demo cold.
- Neon free: 0.5GB storage, autosuspends compute (fast resume).
- Vercel Hobby is non-commercial — stakeholder testing only.
