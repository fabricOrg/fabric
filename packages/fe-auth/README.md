# @app/fe-auth — shared frontend auth/BFF session mechanism

**Status:** SEAM SCAFFOLD (ratified 2026-07-01, *seam-now / full-defer*). Interface is **frozen**;
flow implementations are **deferred to PI-2** (stubs throw `NotImplemented`). **No login logic ships
here yet.** Full design: `team/frontend/PROPOSAL-fe-auth-bff-seam.md`.

## What this is

One audited session mechanism shared by all three Next.js surfaces (admin-console, dev-portal,
dashboard) across **two auth realms** (customer WorkOS org / staff realm). Wraps `@workos-inc/node`.
Apps **never** call WorkOS directly.

## ⚠️ SERVER-ONLY

This package handles sealed-session secrets and imports `@workos-inc/node`. It must **never** be
imported into a browser/client bundle. The browser receives session **claims** (`AppSession`) via
server-rendered props or BFF endpoints — never tokens, never this module. The FE-shared package is
`@app/contracts` (zod-only, browser-safe); this one is not. A CI guard keeps `@app/contracts`
browser-safe; do not defeat the boundary by re-exporting `fe-auth` from it.

## The session-middleware loop (documented; built at PI-2)

Every protected request:
1. `readSession(cfg, cookie)` → if a valid `AppSession`, continue.
2. else `refreshSession(cfg, cookie)` → if it returns a session, re-set the cookie and continue.
3. else redirect to `buildAuthorizationUrl(cfg, { state })`.
4. On a valid session, run the `AccountLivenessCheck` (§6) — fail-closed if the account/membership
   is no longer live.

**No protected route ever 500s on an expired/invalid/missing session — it redirects to login.**
`readSession`/`refreshSession` return `null`, never throw.

## Security contract (guardrails baked into the seam)

| # | Guardrail |
|---|---|
| **G1** | **CSRF** — state-changing BFF POSTs require a double-submit CSRF token **or** a strict `Origin`/`Referer` allowlist check. `sameSite:lax` alone is **not** sufficient for POST. |
| **G2** | **OAuth `state`** — REQUIRED on `buildAuthorizationUrl`, verified in `handleCallback` (login-CSRF / code-injection defense). |
| **G3** | **No JWT in JS** — tokens live only in the httpOnly sealed cookie; the browser gets `AppSession` claims, never tokens. |
| **G4** | **`cookiePassword` in secrets manager**, **per realm**, never shared staff↔customer. Rotation = planned session-drain (runbook). |
| **G5** | **Refresh failure = redirect, never 500** — refresh-token expiry/reuse clears the cookie + redirects to login with a user-safe message. |
| **G6** | **Webhook-tester SSRF** (dev-portal, PI-2) — fires only to the tenant's *registered* endpoints (allowlist), rate-limited, server-side via BFF. |
| **G7** | **Test keys never cached** — `sk_test_` shown in docs are fetched per-session via BFF; the page is never SSG/CDN-cached. |

## §4 Org pinning

Multi-org is real day one (an invited user joins a second org) even though org-switch UX is deferred.
The session **pins one `orgId`** (the active tenant): self-serve signup → the new org; multi-org
user → a deterministic default at login. Switch (PI-2) = re-auth via
`buildAuthorizationUrl({ organizationId })` → new sealed cookie. `orgId → tenant_id` downstream;
Postgres RLS is the backstop.

## §6 Account lifecycle → session lifecycle (backend F4 + F8)

The local account/membership **status is the source of truth** the BFF checks on refresh:
- A `closed`/`suspended` account or a revoked membership must **fail closed** at session validation
  (blocked-login), not ride a stale sealed cookie past the close.
- WorkOS webhooks (`user.created`, `organization_membership.deleted`, …) can invalidate an active
  BFF session via the `AccountLivenessCheck`.
- Consumer side of backend **F8**: once provisioning is unblocked (non-tenant-RLS path) and
  upsert-by-`external_subject_id` is idempotent + order-tolerant, the BFF trusts local status.

## §7 The 5 safety-critical flows (one feature, two seams; PI-2)

step-up · maker-checker · impersonation banner · kill-switch · drill-down.
- **This package owns the session-state mechanism:** step-up writes `AppSession.stepUpAt`;
  impersonation writes a time-boxed `AppSession.impersonation` claim (both already in the frozen
  types — no reshape later).
- **`@app/ui` owns the affordance:** challenge UI, propose/approve queue, never-silent banner +
  countdown, audit `before→after` diff.

## White-label (integration point with `@app/ui`)

The BFF resolves the tenant's brand at session validation and emits a `data-brand` anchor
**server-side** (SSR attribute on `<html>`) so `@app/ui`'s runtime `[data-brand]` theme override
lands with **zero JS and no flash**. Wired when `@app/ui`'s `theme.css` lands (PI-2).

## Errors

The F8.3 error-envelope parser lives in **`@app/contracts`** (zod-only, browser-safe, co-located
with the error shape). This package/app consumes it to surface `request_id` in error toasts.
