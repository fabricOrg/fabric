# WorkOS and Infisical Setup

Status: local-development setup guide. Staging and production are intentionally out of scope until
their AWS accounts are ready.

## Scope

Fabric uses WorkOS AuthKit for authentication (email+password / Google / passkeys, SSO optional) and
Infisical for development secret delivery. There is **no local dev-login bypass** — every
environment, including local, signs in through the WorkOS Test env. Enable the sign-in methods in the
WorkOS dashboard and register `http://localhost:3100/auth/callback` + `/login` as redirect URIs.

## WorkOS Customer Realm

Create or select the Fabric WorkOS project/environment for local development.

Configure one customer application:

| Setting | Value |
| --- | --- |
| Application name | Fabric Customer Dashboard |
| Redirect URI | `http://localhost:3100/auth/callback` |
| Logout redirect URI | `http://localhost:3100/login` |
| Local dashboard URL | `http://localhost:3100` |

WorkOS allows `http://localhost` redirect URIs in sandbox environments. Production WorkOS
environments must not use HTTP or localhost redirect URIs.

Configure these customer roles:

| Role | Permissions |
| --- | --- |
| `owner` | `sms:send`, `sms:read`, `wallet:read`, `api_keys:write`, `api_keys:read`, `request_logs:read` |
| `admin` | `sms:send`, `sms:read`, `wallet:read`, `api_keys:read`, `request_logs:read` |
| `member` | `sms:send`, `sms:read`, `wallet:read` |

Create one test organization for local development. The local database tenant mapping must remain
explicit: WorkOS authentication proves the user; Fabric Postgres remains the source of truth for
tenant membership, wallet state, API keys, and ledger state.

Configure a webhook endpoint at `<public-api-base>/webhooks/workos` for only these events:

- `user.created`, `user.updated`, `user.deleted`
- `organization.updated`, `organization.deleted`
- `organization_membership.created`, `organization_membership.updated`,
  `organization_membership.deleted`

The endpoint verifies `WorkOS-Signature` against the raw request body before processing. WorkOS
cannot deliver to localhost; use an HTTPS development tunnel for manual delivery tests and replace
the tunnel endpoint when it changes.

## Infisical Project

In the Fabric Infisical project, use a `dev` or `development` environment and the root secret path
`/` unless the team later standardizes per-app folders.

Add these shared secrets:

```env
DATABASE_URL_OWNER=<local-migration-role-url>
DATABASE_URL_APP=<local-tenant-application-role-url>
DATABASE_URL_SUPER=<local-test-bootstrap-role-url>
DATABASE_URL_PROVISIONER=<local-identity-provisioning-role-url>
REDIS_QUEUE_URL=redis://localhost:6379/0
REDIS_CACHE_URL=redis://localhost:6379/1

OPERATOR_TOKEN=<local-operator-token>
WEBHOOK_INGRESS_TOKEN=<local-fake-provider-webhook-token>
BFF_INTERNAL_TOKEN=<local-dashboard-to-api-token>
TENANT_TOKEN_SECRET=<api-only HMAC secret for BFF tenant tokens (ADR-0003)>

DASHBOARD_API_KEY=<local-dashboard-api-key>
API_BASE_URL=http://localhost:3000
DASHBOARD_BASE_URL=http://localhost:3100

WORKOS_API_KEY=<from-workos>
WORKOS_CLIENT_ID=<from-workos-customer-application>
WORKOS_COOKIE_PASSWORD=<32-plus-character-random-secret>
WORKOS_REDIRECT_URI=http://localhost:3100/auth/callback
WORKOS_LOGOUT_REDIRECT_URI=http://localhost:3100/login
WORKOS_ORGANIZATION_ID=<mapped-local-workos-organization>
WORKOS_WEBHOOK_SECRET=<from-workos-webhook-endpoint>
```

The development environment was checked on 2026-07-04 and contains all values in this inventory.
The current `WORKOS_WEBHOOK_SECRET` is a local placeholder: replace it with the WorkOS endpoint's
signing secret before enabling real webhook handling.

The WorkOS staging environment has hosted UI, email/password, sign-up, optional MFA, the customer
RBAC roles, and application-specific callback/sign-out redirects configured. This does **not** yet
satisfy role-specific MFA: hosted AuthKit documents global or organization-wide MFA policies, not a
policy scoped to only `owner` and `admin`. Fabric must either require MFA for every organization
member or build a custom factor enrollment/challenge gate for privileged roles.

Use personal overrides for developer-specific local values. Do not paste secret values into issues,
pull requests, chat, screenshots, committed env files, or frontend code.

## Local Delivery

Install the Infisical CLI on Windows:

```powershell
winget install --id infisical.infisical
```

Then authenticate the CLI:

```powershell
infisical login
infisical login status
```

The committed `.infisical.json` links this repository to the Fabric Services project and defaults to
the `dev` environment. It contains a project identifier, not secret material.

The repo supports both copied `.env` files and Infisical injection. Prefer Infisical:

```powershell
pnpm dev:seed:infisical
pnpm dev:api:infisical
pnpm dev:dashboard:infisical
pnpm verify:full:infisical
```

Equivalent package scripts are available as `pnpm dev:api:infisical` and
`pnpm dev:dashboard:infisical`.

Keep external SMS and payment provider feature flags disabled by default. WorkOS is the only real
external provider expected during the customer-auth slice.

## Staff Realm

Do not reuse the customer WorkOS application for staff/admin access. The staff console needs a
separate WorkOS realm, separate cookie name, stricter MFA policy, and separate secret names. That
work remains deferred until the customer journey is complete.

## References

- WorkOS AuthKit: https://workos.com/docs/authkit
- WorkOS redirect URIs: https://workos.com/docs/sso/redirect-uris
- Infisical projects: https://infisical.com/docs/documentation/platform/secrets-mgmt/project
- Infisical secret delivery: https://infisical.com/docs/documentation/platform/secrets-mgmt/concepts/secrets-delivery
