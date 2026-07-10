# ADR 0003: Short-lived BFF tenant tokens replace the tenant-bound dashboard API key

Status: accepted 2026-07-10 (product owner mandate; prerequisite F1 of ADR-0002).

## Context

ADR-0001 left the dashboard BFF authenticating to the API with a single tenant-bound API key
(`DASHBOARD_API_KEY`), which binds the whole dashboard deployment to one pre-provisioned
tenant. ADR-0002's self-serve onboarding creates tenants at runtime, so the BFF must be able to
act for any tenant its authenticated session resolves to. A long-lived per-tenant key minted at
provision time was considered and rejected: the BFF is stateless (env-only, no DB access by
design), so it cannot store N tenant secrets, and fetching a stored long-lived secret over an
internal endpoint has the same trust root as minting a short-lived one — with a rotation burden
on top.

## Decision

- **Session resolution** (`POST /internal/identity/session`) is guarded by `BFF_INTERNAL_TOKEN`
  alone. The tenant is resolved server-side from the request's WorkOS `organization_id` via the
  unique `accounts.workos_organization_id` mapping — the org id comes from the sealed WorkOS
  session the BFF verified, so the tenant binding ADR-0001 wanted is preserved without a
  pre-shared tenant key.
- **Data plane**: a new `POST /internal/identity/tenant-token` (BFF-token-guarded) mints a
  short-lived (5 min) HMAC-SHA256-signed tenant token (`bfft_<payload>.<sig>`, signed with
  `TENANT_TOKEN_SECRET`) for an **active** tenant. The BFF caches it in process memory per
  tenant and sends it as the `Authorization: Bearer` credential on `/v1/*` calls.
- `ApiKeyGuard` accepts both credentials: `sk_*` keys resolve via the hash lookup as before;
  `bfft_*` tokens verify signature + expiry and attach the tenant with wildcard scopes. **User-
  level authorization stays at the BFF** (`requirePermission` against the resolved membership
  role); the token asserts tenant containment, not user rights.
- `DASHBOARD_API_KEY` is removed from the dashboard and dev-portal environments. Customer
  `sk_*` keys remain unchanged for real API integrations.

## Consequences

- A tenant provisioned at runtime (staff console or ADR-0002 self-serve) serves authenticated
  BFF traffic immediately — nothing to mint or configure at provision time.
- Blast radius unchanged: `BFF_INTERNAL_TOKEN` could already resolve sessions for any tenant;
  it and `DASHBOARD_API_KEY` lived in the same secret store. Tokens expire in minutes and no
  new long-lived secret exists per tenant. Fail-closed: an unset `TENANT_TOKEN_SECRET` refuses
  to mint or verify.
- Rate limiting buckets `bfft_` traffic per tenant (hash-prefix bucket id), same as keys.
- New secret `TENANT_TOKEN_SECRET` must be added to Secrets Manager + the api task-def (ships
  via a deploy, per the task-def redline) and to local Infisical.
- Suspended/closed tenants can't mint tokens; existing tokens die within one TTL — tenant
  suspension now takes effect on the BFF plane within 5 minutes without extra plumbing.
