# Org Provisioning — Ops-Provisioned Tenant Onboarding

> **Date:** 2026-07-05 · **Owner:** Product (fifi) · **Epic:** E19 (onboarding) · **Status:** spec → build
> Fabric login is **WorkOS SSO only** (no public signup). New **users** auto-join an existing org on first SSO/invite sign-in (`identity.service.resolve()` already upserts `users` + `memberships`). This spec covers the missing piece: **creating a new org (tenant)** — an **ops-provisioned** flow, which fits Fabric's compliance reality (KYC, sender-ID/NCC registration, DPO, payments all require vetting before a customer can send).

## Why ops-provisioned (not self-serve)
A regulated CPaaS customer cannot self-serve and immediately send SMS — they must be vetted (business docs, sender-ID registration, payment setup). So org creation is an **ops action** in the admin console, gated by staff RBAC + (optionally) maker-checker. Self-serve signup stays out; a "Request access" lead-capture can feed the sales pipeline later.

## The flow — admin-console "Create tenant"
A staff operator opens **Admin → Tenants → Create tenant**, enters:
- Business name, slug, region (gh-accra / ng-lagos …), plan (free/growth/scale)
- First-admin email (+ optional name)

On submit, the backend performs **one provisioning transaction**:
1. **Create the WorkOS Organization** — `workos.organizations.createOrganization({ name, ... })` → returns `org_…`. (Idempotency: key on slug; if an org for this slug exists, reuse/fail cleanly.)
2. **Insert the `account` row** — `id` (tenant uuid), `name`, `slug`, `plan`, `region`, `status: 'active'`, **`workos_organization_id = org_…`**. (Table + column already exist — no migration.)
3. **Invite the first admin** — `workos.userManagement.sendInvitation({ email, organizationId: org_…, roleSlug: 'admin' })`. They receive the WorkOS invite → sign in → `identity.service` provisions their `users` + `memberships` row (role admin) automatically.
4. Return `{ tenantId, workosOrganizationId, invitedEmail }`.

Result: the tenant exists, mapped to a WorkOS org, with an invited admin — exactly the `accounts WHERE id=… AND workos_organization_id=… AND status='active'` shape the SSO callback resolves against.

## Ordering & rollback
WorkOS org create → DB insert → invite. If the DB insert fails after the WorkOS org is created, either (a) delete the just-created WorkOS org, or (b) leave it and make the operation resumable by slug (preferred — WorkOS org create is idempotent-ish by name/slug). The invite is last so a failed invite doesn't orphan a half-made tenant (invite is retryable from the tenant detail screen).

## Security / redlines
- **Staff-scoped**: the endpoint requires a staff/admin session (staff IdP realm), not a customer session. Distinct from the customer BFF.
- **Maker-checker (optional, recommended)**: creating a tenant is consequential → route through the existing admin maker-checker (propose → second operator approves → execute). MVP can be direct-create for `owner` role; add maker-checker before production.
- **Audit**: every provisioning writes an immutable audit entry (actor, tenant, workos org, invited email, at) — the admin Audit screen already models this.
- **Environment**: WorkOS org creation is an **external write**. Build + test against **staging WorkOS + local DB**. Production provisioning is gated behind the deploy pipeline + a human — never auto-run.

## Build plan
1. **Contracts** — `provisionTenantRequest` / `provisionTenantResponse` (zod). (App-local in admin-console for the mock; promote to `@app/contracts` when the API lands.)
2. **Admin UI (mock-first, this PI)** — a "Create tenant" dialog on the Tenants screen → BFF stub that echoes a created tenant (`TODO(BFF)`), optimistic add, success toast, audit entry.
3. **Backend endpoint (next slice)** — `POST /internal/admin/tenants` in `services/api` (staff-guarded): WorkOS org create → account insert (drizzle, in a tx) → invite. Reuses the WorkOS SDK already wired in `@app/fe-auth`/api. Emits an audit row.
4. **Wire UI → real endpoint**, replacing the stub; keep maker-checker as the follow-up.

## Open questions
- Staff IdP realm shape (separate WorkOS org/dir for Fabric employees) — still open from PI-3.
- Role slugs in WorkOS (owner/admin/member) must match `identity.service` `ROLE_PERMISSIONS`.
- Plan/region → any downstream provisioning (wallet init, default sender-ID request)?
