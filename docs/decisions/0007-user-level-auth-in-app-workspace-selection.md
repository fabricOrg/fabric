# ADR-0007 — User-level authentication with in-app workspace selection (Stripe model)

- Status: **proposed** (requires product + security sign-off; supersedes the org-scoped session
  mechanics of ADR-0001 and the org-per-workspace provisioning of ADR-0002/0004 — their
  authorization doctrine stands)
- Date: 2026-07-17

## Problem

Fabric currently creates **one WorkOS Organization per workspace** and requires every dashboard
session to be **org-scoped** (`fe-auth` rejects a session without `organizationId`; an org-less
login is "adopted" into an org via `resolveOrganization`, and invites are WorkOS *organization*
invitations). Consequences, now visible in the product:

1. **The IdP renders tenancy.** A user in two workspaces gets WorkOS's hosted
   "Select an organisation to continue" screen — an unbranded, IdP-owned fork in OUR onboarding.
2. **Self-serve sign-up mints an IdP org per stranger.** Org sprawl in the WorkOS project, an
   external write on the critical signup path, and a hard coupling: workspace creation fails if
   the IdP is down (violates "control plane never in the hot path").
3. **Workspace switching requires an IdP round-trip** (session refresh into another org) instead
   of an in-app switcher.
4. **Drift risk is structural.** Two systems both claim to know "who belongs to what org"; we've
   already seen a workspace whose namesake user has no local membership.

Doctrine we keep, unchanged: **authorization is the local membership role, never WorkOS claims.**
The IdP claims were already ignored — this ADR stops *asking* for them.

## Decision (the Stripe model)

**Authenticate the person. Authorize the membership. Select the workspace in-app.**

1. **WorkOS authenticates users only.** AuthKit hosted login (email+password, Google, passkeys,
   MFA) with **no organization context** — no org selection screen can ever appear. The sealed
   session cookie proves *who*, nothing else.
2. **Tenancy lives only in Fabric.** `memberships` is the single source of truth. Session
   resolution takes the WorkOS subject (+ verified email) and returns the user's memberships;
   the WorkOS `organizationId`/`role` inputs are removed from the contract.
3. **Active workspace is an application concern.** The dashboard shell gets a workspace switcher
   (Stripe's account picker). The selected `tenant_id` rides a signed, httpOnly, same-site
   cookie **separate from** the WorkOS session cookie; the BFF validates on every request that
   the session's user has an active membership in that tenant before minting a tenant token
   (fail closed). Defaults: exactly one membership → auto-select; several → last-used, else an
   in-app picker page (ours, branded).
4. **Self-serve sign-up is a local transaction.** Verified stranger → `accounts` row + owner
   `membership` in ONE Postgres transaction. **No WorkOS org is created.** The IdP is no longer
   in the workspace-creation path at all.
5. **Invites drop org invitations.** Invite = local `invited` user + membership (exactly today's
   rows) + a WorkOS **org-less** invitation email (the staff realm already uses this shape).
   First login binds the subject and activates the invite — the existing invited-email adoption
   logic in `identity.service` survives unchanged.
6. **WorkOS Organizations are reserved for enterprise SSO.** When a customer buys SAML/OIDC SSO,
   we create ONE WorkOS org for their domain and map `connection → tenant` at resolve time. SSO
   is the only feature that ever needs the IdP to know about an organization — and even then the
   Fabric session stays user-level; the org only routes the login.

## What changes where

| Seam | Today | Target |
| --- | --- | --- |
| `fe-auth` `authenticateAndResolve` | requires `organizationId` + WorkOS `role` | requires authenticated user only |
| `fe-auth` `adoptOrganization` + `resolveOrganization` | refreshes session into an org | **deleted** |
| `POST /internal/identity/session` | takes `organization_id`, `role`, `permissions` | takes subject + email; returns `memberships[]` (tenant, role, developer_access, permissions) |
| `POST /internal/identity/organization-for-user` | picks/creates an org for an org-less session | **deleted** |
| Tenant token minting (ADR-0003) | tenant from org-scoped session | tenant from the workspace cookie, revalidated against membership per request |
| Tenant provisioning | creates a WorkOS org, stores `workos_organization_id` | local-only; column becomes nullable legacy (kept for SSO mapping later) |
| `members.invite` | WorkOS org invitation with `roleSlug` | org-less WorkOS invitation (email only) |
| Dashboard shell | no tenant picker | workspace switcher + `/workspaces` picker page |
| Staff realm (admin console) | allowlist, org-less | **unchanged** |

## Migration (no data loss, no forced re-login storm)

1. Ship resolve-v2 alongside v1; `fe-auth` prefers v2, falls back to v1 for existing org-scoped
   cookies until natural expiry (sessions are short-lived — days, not months).
2. Stop creating WorkOS orgs at signup/provisioning immediately.
3. Existing WorkOS orgs: detach users from orgs in the WorkOS dashboard (Test env: two orgs) so
   the hosted picker disappears even before old cookies expire. Local `accounts` rows keep their
   `workos_organization_id` as inert history.
4. Delete `organization-for-user` + `adoptOrganization` once v1 fallback retires.

## Security notes

- The workspace cookie is a *selector*, not an authority: every BFF request re-checks membership
  before minting the tenant token — a stolen/forged selector without a valid session gets
  nothing, and a valid session selecting a foreign tenant is refused (fail closed).
- Sign-up trusts only `emailVerified` WorkOS users (unchanged from ADR-0002).
- Removing IdP orgs removes an entire class of drift (IdP org membership ≠ local membership).
- Staff realm invariants untouched: invite-only, allowlist, no JIT.

## Consequences

- One fewer external write on signup; workspace creation works during a WorkOS outage.
- Multi-workspace users switch instantly, in-app, branded.
- Session cookie no longer encodes tenant → one cookie shape for all workspaces.
- Cost: we own a small amount of new UI (switcher + picker) and the workspace-selector cookie
  code; we lose nothing we used (WorkOS roles were already ignored).
