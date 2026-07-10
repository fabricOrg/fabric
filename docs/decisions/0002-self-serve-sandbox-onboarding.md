# ADR 0002: Self-serve sign-up with sandbox-gated tenants (supersedes invite-only for customers)

Status: accepted 2026-07-10 (product owner; fifi to ratify sequencing at PI-4 grooming).
Supersedes: the customer half of `IDENTITY-SSO.md` §12.5 (invite-only as-built). Staff
onboarding (allowlist + org-less invitation, admin-console) is untouched by this ADR.

## Context

Fabric shipped invite-only customer onboarding: staff provision a tenant in the admin console
before anyone can log in. Every direct competitor (Africa's Talking, Termii, Arkesel, Hubtel,
Twilio) offers self-serve sign-up landing in a sandbox within minutes; Twilio attributes
material activation gains to a no-wait sandbox (`COMPETITIVE-ANALYSIS.md` A-5/A-6). The
original identity design (`IDENTITY-SSO.md` §11, 2026-05-31) already chose self-serve; the
invite-only posture was a later hardening drift. Meanwhile the repositioning to a
verification-led product (`POSITIONING.md` v2) targets developer-led buyers whose first
touchpoint must be "try it now."

The genuine reason for the invite gate is compliance: live SMS requires registered sender IDs
(NCC hard gate) and vetted customers. That gates **live traffic**, not **sign-up**.

## Decision

- **Keep WorkOS AuthKit unchanged as the auth engine.** No credential ownership, cross-app
  session, hosted login. This ADR changes provisioning policy only.
- **Re-enable self-serve sign-up** on hosted AuthKit (`screen_hint: 'sign-up'`, email
  verification required), customer realm only.
- **First callback auto-provisions a sandbox tenant**: WorkOS organization + `accounts` row +
  active `owner` membership, via the idempotent upsert-by-`sub` design already written in
  `IDENTITY-SSO.md` §12.5 (JIT-vs-webhook order-tolerant, provisioning connection — never the
  tenant RLS path). Webhooks remain update-only reconcilers.
- **Sandbox is an entitlement state on the tenant, not a separate environment**:
  `sk_test_*` API keys only, provider routing pinned to FakeProvider, free test credits,
  sends restricted to numbers the user has verified they own, rate-limited. A sandbox tenant
  can never reach a real carrier — enforced in routing, not UI.
- **Go-live is the compliance gate**: in-dashboard request (business info, KYC, sender-ID
  application) → admin-console review with the existing maker-checker flow → live entitlements
  (`sk_live_*`, real provider routing, wallet top-up required).
- **Invite flow is retained** alongside sign-up: ops can still pre-provision (enterprise/
  high-touch), and the dashboard Team invite flow is unchanged.
- Abuse posture at launch: verified email required, per-IP/per-email sign-up rate limits,
  sandbox spend capped. Disposable-email blocking deferred.

## Consequences

- The invite gate in `resolve()` (deny when no pre-existing membership) gets one new,
  explicit path: **no membership AND self-serve sign-up enabled → provision sandbox tenant**,
  instead of deny. The deny remains for the staff realm and for any tenant-scoped surface.
- ADR-0001's open item becomes blocking work: the dashboard BFF authenticates to the API with
  a **tenant-bound API key**, so a freshly self-provisioned org needs tenant-scoped BFF
  credentials minted at provision time. This onboarding-credential design is a prerequisite
  story, not an afterthought.
- Admin console gains a go-live review queue (maker-checker) and a sandbox/live tenant state
  visible on the tenant detail page.
- `IDENTITY-SSO.md` §12.5 is annotated to point here; `screen_hint: 'sign-up'` returns.
- Risk accepted: self-serve creates junk orgs. Mitigation: sandbox tenants are cheap rows with
  zero carrier exposure; add TTL-based cleanup of never-activated sandboxes later if volume
  warrants.
