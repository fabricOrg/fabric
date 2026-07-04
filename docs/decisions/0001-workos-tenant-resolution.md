# ADR 0001: Resolve WorkOS organizations inside the API

Status: accepted for the local customer-auth slice.

## Context

WorkOS organization IDs are strings such as `org_*`; Fabric tenant IDs are Postgres UUIDs used by
RLS. Passing a WorkOS ID directly into tenant context would fail and could weaken tenant binding.
The dashboard also uses a tenant-bound API key and must never receive database credentials.

## Decision

- `accounts.workos_organization_id` is the unique external-to-local mapping, defined in Drizzle.
- The dashboard validates WorkOS sealed sessions server-side, then calls
  `POST /internal/identity/session`.
- That endpoint requires both the existing tenant API key and a separate `BFF_INTERNAL_TOKEN`.
- The API binds the WorkOS organization to the API-key tenant before JIT-upserting the local user
  and membership.
- WorkOS permissions are intersected with Fabric's local role policy.
- Cross-tenant JIT writes use `DATABASE_URL_PROVISIONER`. Local development may reuse bootstrap
  credentials; deployed environments require a dedicated least-privilege role.

## Consequences

The browser never receives WorkOS tokens, provider secrets, BFF credentials, or database
credentials. The initial local integration supports one pre-provisioned WorkOS organization because
the dashboard API key remains tenant-bound. Self-serve organization creation requires a separate
onboarding design for issuing tenant-scoped BFF credentials.
