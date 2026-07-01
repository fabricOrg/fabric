# PROPOSAL — Frontend auth/BFF seam + `apps/*` topology

**Author:** experience-engineers/vivian · **Date:** 2026-07-01
**Lane:** frontend seam (ratified P1, *seam-now / full-defer*) · **Contract binding:** none (no runtime built)
**Status:** PROPOSAL ONLY — nothing built, no app scaffolded, no dependency added. This is the
design + the tiny scaffold shape for PM/owner review. Honors: **no app build in PI-1**,
**PI-1 = API-only skeleton** (keys via API/CLI, **dev-portal → PI-2**).

Companion to edison's `packages/ui` token-contract proposal. Together = the two ratified
frontend seams. Cross-refs: `IDENTITY-SSO.md` §4/§12, `F2.1-customer-sso.md`, session decision
note "CONVERGED FRONTEND STORY", backend **F8** (users-RLS provisioning block) + **F4** (soft-close).

---

## 0. Why a seam now if we build no app in PI-1

SSO and session security **cannot be retrofitted** once an app owns its own login. Three Next.js
surfaces are coming (admin-console, dev-portal, dashboard) across **two auth realms** (customer
WorkOS org vs staff realm). If each surface hand-rolls its own session handling, we get: divergent
cookie/CSRF posture, three subtly-different refresh loops, and a security review per app. The seam
is **one shared, audited session mechanism** every surface consumes.

**What "seam-now" means concretely:** we reserve the package + freeze its public interface
(types + function signatures + documented security contract). We do **not** wire it into any app,
add WorkOS as a runtime dependency, or ship login code. Cheap now (interfaces + docs), expensive
later (retrofit across 3 apps).

---

## 1. Monorepo topology (the one decision handed to the PM — joint w/ edison)

```
app-platform/
├─ packages/                     # shared libraries (existing)
│  ├─ contracts/                 # zod DTOs + error codes (existing) — FE-consumable, see §5
│  ├─ db/  domain/               # (existing, backend)
│  ├─ ui/                        # NEW seam — edison: token contract + Tailwind preset
│  └─ fe-auth/                   # NEW seam — THIS proposal: shared FE-auth/BFF module
├─ services/                     # deployable backend apps (api, workers) — per workspace yaml
└─ apps/                         # NEW — deployable Next.js surfaces (add to pnpm-workspace.yaml)
   ├─ admin-console/             # CONTROL PLANE — STAFF realm, admin.* , isolated (PI-2+)
   ├─ dev-portal/                # customer realm, developers.*                (PI-2)
   └─ dashboard/                 # customer realm, sms.*                       (PI-2, deferred)
```

**Decisions requested:**
1. Add `apps/*` to `pnpm-workspace.yaml` (`packages: [packages/*, services/*, apps/*]`).
2. **Two realms → separate Next apps, non-negotiable.** `admin-console` authenticates against the
   **staff realm** (own IdP org, own sealed cookie, own ingress `admin.*`); `dev-portal`/`dashboard`
   authenticate against the **customer WorkOS org**. They **cannot** share a Next app or a cookie —
   different session-validation code paths + blast-radius isolation (IDENTITY-SSO §13, F2.2).
3. **BFF placement:** each Next app IS its own BFF (route handlers hold tokens server-side). The
   BFF-to-domain calls go to `services/*` (public-api / dashboard-api) — the Next app never talks to
   Postgres or WorkOS-protected APIs from the browser. `packages/fe-auth` is the *shared library*
   all three BFFs import; it is not itself a deployable.

> Nothing in `apps/*` is built in PI-1. The directory + workspace entry is the only PI-1 artifact,
> so PI-2 starts on rails instead of a topology debate.

---

## 2. `packages/fe-auth` — the shared FE-auth/BFF module

Runtime-agnostic **session mechanism**, framework-thin (works with Next App Router route handlers /
middleware). It wraps `@workos-inc/node`; apps never call WorkOS directly. **Interface frozen now,
implementation deferred to PI-2.**

### 2.1 Public interface (proposed — signatures only)

```ts
// packages/fe-auth/src/index.ts   (type: module, ESM, strict)

/** A realm = one WorkOS environment/org + its own sealed-cookie config. Staff vs customer. */
export interface RealmConfig {
  readonly realm: "customer" | "staff";
  readonly clientId: string;            // WORKOS_CLIENT_ID (per realm)
  readonly cookieName: string;          // e.g. "wos-session" (customer) / "wos-staff" (staff)
  readonly cookiePassword: string;      // WORKOS_COOKIE_PASSWORD (per realm, 32+ chars, secrets mgr)
  readonly redirectUri: string;         // per-environment, registered in WorkOS
  readonly cookieOptions: SessionCookieOptions;
}

export interface SessionCookieOptions {
  readonly httpOnly: true;              // always — no JWT in JS (IDENTITY-SSO §4)
  readonly secure: true;                // always
  readonly sameSite: "lax";            // lax OK for redirect SSO; see CSRF §3
  readonly path: "/";
  readonly maxAge?: number;
}

/** Validated session claims the app is allowed to trust. Tokens stay server-side. */
export interface AppSession {
  readonly userId: string;              // WorkOS sub → users.external_subject_id
  readonly orgId: string;               // active org → tenant_id (pinned, see §4)
  readonly role: string;                // owner|admin|member (customer) / staff RBAC (staff)
  readonly permissions: readonly string[];
  readonly sessionId: string;           // WorkOS sid — for back-channel logout correlation
  readonly stepUpAt?: number;           // elevated-auth timestamp (safety-critical flows, PI-2)
  readonly impersonation?: ImpersonationClaim;  // time-boxed, never-silent (staff, PI-2)
}

export interface ImpersonationClaim {
  readonly targetTenantId: string;
  readonly expiresAt: number;           // time-box; UI banner + countdown (edison affordance)
  readonly reason: string;              // reason-logged, audited
}

// --- the flow (each returns Set-Cookie / redirect intent the app applies) ---
export function buildAuthorizationUrl(cfg: RealmConfig, opts: {
  screenHint?: "sign-up" | "sign-in";
  state: string;                        // REQUIRED — CSRF for the OAuth roundtrip (§3)
  organizationId?: string;              // for org-scoped / org-switch login (§4)
}): string;

export function handleCallback(cfg: RealmConfig, params: {
  code: string;
  state: string;                        // MUST match the state issued in buildAuthorizationUrl
  expectedState: string;
}): Promise<{ session: AppSession; sealedCookie: string }>;

/** No network call — unseal + decode. Fail-closed: returns null, never throws to a 500. */
export function readSession(cfg: RealmConfig, sealedCookie: string | undefined):
  Promise<AppSession | null>;

/** Refresh when access token is near-expiry; re-seal. Returns null → caller redirects to login. */
export function refreshSession(cfg: RealmConfig, sealedCookie: string):
  Promise<{ session: AppSession; sealedCookie: string } | null>;

export function buildLogout(cfg: RealmConfig, sealedCookie: string):
  Promise<{ workosLogoutUrl: string; clearCookie: string }>;   // single-logout across apps

/** Account/membership lifecycle gate — see §6 (backend F4/F8 tie-in). */
export type AccountLivenessCheck = (session: AppSession) => Promise<boolean>;
```

### 2.2 Session middleware pattern (documented, not built)

Every protected request runs: `readSession` → if null, `refreshSession` → if still null, redirect to
`buildAuthorizationUrl`. On success, run `AccountLivenessCheck` (§6). Refresh is transparent and
re-sets the cookie on the response. **No route ever 500s on an expired/invalid session** — it
redirects to login. This single loop is shared by all three apps.

---

## 3. Security guardrails baked into the seam (my review findings, now design)

| # | Guardrail | Where enforced |
|---|---|---|
| G1 | **CSRF** — state-changing BFF POSTs require a double-submit CSRF token **or** strict `Origin`/`Referer` allowlist check. `sameSite:lax` alone is **not** sufficient for POST. | `fe-auth` CSRF helper; every mutating route |
| G2 | **OAuth `state`** — REQUIRED param, verified on callback (login-CSRF / code-injection defense). The raw `@workos-inc/node` snippets in IDENTITY-SSO §12.3 omit it — **do not copy them literally.** | `buildAuthorizationUrl` / `handleCallback` |
| G3 | **No JWT in JS** — tokens live only in the sealed httpOnly cookie; browser gets session claims via server-rendered props / BFF endpoints only. | cookie is `httpOnly:true` always |
| G4 | **`cookiePassword` in secrets manager** (Infisical dev / AWS SM cloud), **per realm**, never shared staff↔customer (blast radius). Rotation = planned session-drain, documented runbook. | `RealmConfig`; deployment |
| G5 | **Refresh failure = redirect, never 500.** Refresh-token expiry/reuse → clear cookie + login redirect with a user-safe message. | `refreshSession` returns null |
| G6 | **Webhook-tester SSRF** (dev-portal, PI-2) — fires only to the tenant's **registered** endpoints (allowlist), rate-limited, server-side via BFF. | dev-portal BFF route (PI-2) |
| G7 | **Test keys never cached** — `sk_test_` rendered in docs are fetched per-session via BFF; the page is never SSG/CDN-cached. | dev-portal (PI-2) |

---

## 4. Org pinning (multi-org is real day one, switch UX deferred)

F2.1 defers org-switch UX, but an **invited user joining a second org makes multi-org real
immediately**. The session **pins one `orgId`** (the active tenant). Rules:
- Self-serve signup (no invite) → one new org → pin it as owner (matches JIT policy §12.5).
- Multi-org user → pin a **deterministic default** (most-recent, or first membership) at login.
- "Switch org" (PI-2) = re-auth into the target org via `buildAuthorizationUrl({organizationId})`
  → new sealed cookie with new `orgId`. Browser SSO session unchanged.
- `orgId` → `tenant_id` on every downstream call; Postgres RLS is the backstop (unchanged).

---

## 5. `packages/contracts` FE-consumability (verify + guard)

Good news: `@app/contracts` is already `"type": "module"` with a single `exports` map and only
`zod` as a dep — **already FE-consumable**. Asks:
1. **Guard it stays browser-safe** — no `node:*` imports, no node-only deps leak in. (Cheap lint/CI
   check; the FE bundles this package.)
2. Add a small **FE error-handler** (can live in `fe-auth` or `contracts`) that parses the **F8.3
   envelope** `{ error: { type, code, message, param?, doc_url? } }` + `request_id` → a typed result
   the UI maps to affordances, and **surfaces `request_id` in error toasts** ("contact support with
   req_…"). One parser, all surfaces.

---

## 6. Account lifecycle → session lifecycle (backend F4 + F8 tie-in)

Newton's **F4** (accounts soft-close, `status='closed'`, never hard-delete) and **F8** (identity
provisioning runs outside tenant RLS) mean the account/membership status is the **source of truth
the BFF checks on session refresh**:
- A `closed`/`suspended` account or a **revoked membership** must **fail closed at session
  validation** → blocked-login screen, **not** a silently-valid sealed cookie that outlives the close.
- WorkOS webhooks (`user.created`, `organization_membership.deleted`, …) must be able to
  **invalidate an active BFF session** (the `AccountLivenessCheck` reads current status).
- This is the consumer side of F8: once provisioning is unblocked (owner/bootstrap path) and
  upsert-by-`external_subject_id` is idempotent + order-tolerant, the BFF trusts local status.

No schema ask from me — just declaring the seam so backend's status is treated as authoritative.

---

## 7. The 5 safety-critical flows — one feature, two seams (PI-2, declared now)

step-up auth · maker-checker · impersonation banner · kill-switch · drill-down. Split (per
converged decision note):
- **vivian owns the BFF session-state mechanism:** step-up = a fresh WorkOS re-auth writing
  `stepUpAt` into the sealed cookie; impersonation = a time-boxed `ImpersonationClaim` in the
  session (see §2.1 types — already shaped for it).
- **edison owns the affordance:** step-up challenge UI, maker-checker propose/approve queue,
  never-silent impersonation banner + countdown, audit `before→after` visual diff.

Scoped jointly at PI-2. The `AppSession` type above already carries `stepUpAt` + `impersonation` so
the seam doesn't need reshaping later.

---

## 8. IDENTITY-SSO.md doc fixes I own (proposed edits — not applied)

Small, doc-only; posting for PM review before touching the doc:
1. **§4** — add: WorkOS access tokens are **environment-scoped, no per-API `aud`** (§12.4). Defer
   `aud` validation until a first-party token audience exists. **PI-1 stance:** WorkOS user tokens
   are consumed by **BFFs only**; `public-api` authenticates with **API keys** → no cross-API token
   `aud` to validate yet. (Resolves the §4↔§12.4 conflict newton confirmed.)
2. **§9 / §12.3** — add a **CSRF** bullet (G1) and make the **`state` param** explicit in the code
   snippets (G2); annotate the snippets "illustrative — use the AuthKit SDK's state/PKCE handling,
   do not implement literally."
3. **§12.5** — note the JIT-on-callback vs `user.created`-webhook **race** → idempotent
   upsert-by-`sub`, order-tolerant, provisioning via the non-tenant-RLS path (backend F8).

---

## 9. PI-1 deliverable checklist (what actually lands now)

- [ ] `apps/` added to `pnpm-workspace.yaml` (empty dir + workspace entry).
- [ ] `packages/fe-auth` scaffold: `package.json` (ESM, strict, dep `@workos-inc/node` **declared
      but flow unimplemented — stubs throwing `NotImplemented`**), `src/index.ts` = the frozen
      interface in §2.1, `README.md` = the security contract (§3–§7). No app consumes it.
- [ ] `@app/contracts` browser-safe guard (CI check) + shared F8.3 error-parser.
- [ ] IDENTITY-SSO.md doc edits (§8) — after PM review.

**Explicitly NOT in PI-1:** any login code, any WorkOS wiring, any Next app, any component, the
webhook tester, org-switch, the 5 safety-critical flows. All PI-2, seams preserved.

---

## 10. Open questions for PM

1. **Approve `apps/*` topology + the workspace edit?** (Gates everything FE.)
2. **Cookie-name convention per realm** — `wos-session` (customer) / `wos-staff` (staff) OK?
3. **Where does the F8.3 error-parser live** — `packages/contracts` (with the DTOs) or
   `packages/fe-auth`? I lean `contracts` (co-located with the error shape).
4. **Do you want the actual `packages/fe-auth` scaffold as a follow-up diff**, or is this design doc
   the PI-1 deliverable and the scaffold lands at PI-2 kickoff? (I recommend scaffolding the frozen
   interface now — it's tiny and locks the seam — but will hold on your call.)
