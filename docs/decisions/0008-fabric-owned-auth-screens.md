# ADR-0008 — Fabric-owned auth screens (WorkOS behind the scenes)

- Status: **accepted** (owner sign-off 2026-07-18; builds on ADR-0007's user-level sessions —
  authentication stays WorkOS, only the UI moves in-house)
- Date: 2026-07-18

## Problem

ADR-0007 made sessions user-level, but the credential forms still live on WorkOS's hosted AuthKit
page: sign-in redirects out to `signin.workos.com`, the user types their password on WorkOS's
domain, and comes back. Even themed, it is a visible hand-off to a third party mid-onboarding —
the opposite of the "feels like Fabric" bar the product wants (Stripe/Relay both own their sign-in
pixels end to end).

CLAUDE.md locks "WorkOS hosts every credential form (register/reset/MFA) — we still own none." This
ADR **deliberately amends that line**: we take the pixels, WorkOS keeps everything that makes
auth hard.

## Decision

**Own the screens. Keep WorkOS as the identity engine.** Fabric renders `/signin` and `/signup`
(and the reset / verify / magic-code steps); the BFF calls WorkOS **User Management APIs** instead
of redirecting to AuthKit. Every path still ends in the SAME sealed WorkOS session cookie ADR-0007
already consumes — `handleUserCallback`/`readUserSession`/resolve-v2 are untouched downstream.

Credential paths, all server-side in the BFF (browser → Next route handler → `@app/fe-auth` →
WorkOS):

| Flow | WorkOS call | Notes |
| --- | --- | --- |
| Email + password sign-in | `authenticateWithPassword({ session })` | returns the sealed cookie |
| Sign-up | `createUser` → `authenticateWithPassword` | unverified ⇒ `email_verification_required` |
| Verify email (code) | `authenticateWithEmailVerification({ code, pendingAuthenticationToken, session })` | seals the session on success |
| Magic code (passwordless) | `createMagicAuth` → `authenticateWithMagicAuth({ session })` | one "email me a code" option |
| Forgot / reset password | `createPasswordReset` → `resetPassword({ token, newPassword })` | reset links to our `/reset-password` |
| Google | `getAuthorizationUrl({ provider: "GoogleOAuth" })` | redirects straight to Google — **no AuthKit screen** — returns via the existing `/auth/callback` |

WorkOS still owns: the credential STORE (we never persist a password), password hashing + breach
detection, the verification/reset/magic **emails** (their infra, Fabric-themed via app branding),
token issuance + rotation, and the sealed-session crypto.

## What we own now (the cost, stated plainly)

1. **~6 screens + BFF routes** (sign-in, sign-up, verify-email, forgot-password, reset-password,
   plus the magic-code step). Moderate build; all in the dashboard app.
2. **Credentials transit our server in flight.** A password reaches our BFF route, is forwarded to
   WorkOS over TLS, and is **never stored or logged** (the redlines already forbid secrets in
   logs; passwords get the same treatment — not in audit, not in error bodies). This is the line
   this ADR moves: forms are ours, storage stays WorkOS's.
3. **Login-surface abuse protection is layered.** Hosted AuthKit shipped WorkOS Radar (bot /
   credential-stuffing defense) for free; the raw APIs don't. Our first line is per-IP + per-email
   rate limiting on the credential routes (fail closed — a login endpoint that can't rate-limit
   refuses, unlike the data-plane's fail-open posture). This layer is per-instance (in-memory), so
   on serverless it absorbs same-instance bursts but is not a global limiter; the real backstop is
   **WorkOS's own server-side rate limiting** on `authenticate*` (429 → surfaced as a transient
   error). A global limiter (shared Redis) is deferred until the dashboard scales past one task.
   The routes also reject cross-site POSTs (`Sec-Fetch-Site: cross-site`) to close login-CSRF.
4. **Unsupported challenges fall back, they don't break.** `mfa_enrollment` / `mfa_challenge` /
   `sso_required` / `radar_*` from `authenticateWithPassword` are NOT reimplemented here — the BFF
   redirects that identity to the hosted AuthKit page (`/auth/login`) to finish. Custom UI is the
   happy path; the hosted page stays the escape hatch for the hard cases until we build them.

## Non-goals (deferred, on purpose)

- **Passkeys** — custom-UI passkey support is weak; passkey users use the hosted page. Revisit when
  WorkOS's headless passkey APIs mature.
- **Full custom MFA UI** — enroll/challenge screens are a follow-up; today they fall back to hosted.
- **Custom email templates** — WorkOS sends the emails (themed by branding); we don't run our own
  mailer for auth.

## Security notes

- Passwords: never persisted, never logged, never in an error body or audit metadata. The route
  reads them from the request, hands them to WorkOS, and drops them.
- The sealed session cookie is produced by WorkOS exactly as in the hosted flow — no new session
  crypto is introduced; the blast radius of a screen bug is a failed login, not a forged session.
- Rate limiting fails **closed** (no store → reject) because it is an abuse control; this is the
  documented exception to the data-plane's fail-open posture.
- Sign-up still trusts only a WorkOS-verified email before a workspace can be created (ADR-0007
  gate unchanged — an unverified user reaches `/onboarding` with no ability to provision).

## Consequences

- Onboarding never leaves the Fabric domain for email/password/Google — the product reads as ours.
- One more surface we maintain (screens + abuse control), offset by dropping the "we own no
  credential UI" constraint that forced the hosted redirect.
- The hosted AuthKit page stays wired and themed as the fallback for MFA/SSO/passkey/Radar — we get
  custom UI without having to build every hard edge first.
- CLAUDE.md §1 line is amended (see this ADR); the hosted page is now the *fallback*, not the *only*
  credential surface.
