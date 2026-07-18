# Fabric — session handoff

_Snapshot: 2026-07-18. Point-in-time; verify against code/git before asserting as fact. Companion to
[CLAUDE.md](./CLAUDE.md) (the how-we-build guide) and `docs/`._

## Latest (2026-07-18): stakeholder-testing hardening — customer journey verified end-to-end (PRs #151–#153)

All four apps live on the free testing stack (Neon + Render + Vercel). Swept the whole customer
journey with a real all-permissions **sandbox** key against the deployed API and closed every gap.
Each fix was deployed + re-verified in prod (API `fabric-jezz.onrender.com`, dashboard
`fabric-dashboard-teal`, playground `fabric-playground-red`). Stakeholders sign in with
`fabricservices8@gmail.com`.

- **#151** — (a) `verify.start` routed the OTP via the tenant/plan delivery mode, so a sandbox key
  demanded the live carrier (`live_provider_not_ready`); now threads the key's environment → routes
  virtual like `sms.send`. (b) `live_provider_not_ready` no longer leaks the carrier name ("Arkesel").
  (c) `messages:read`/`messages:send` added to the membership permission catalog + member baseline —
  the "Managed deliveries" nav was gated on a permission NO membership (not even owner/admin FULL)
  could hold. (d) Seed scripts now set `plan:"sandbox"`: the schema default `"free"` made the
  dashboard treat a workspace as **live** and hide every sandbox key/log/webhook/email, because the
  dashboard derives the shown environment from `session.plan === "sandbox"`. Live data corrected too.
- **#152** — (a) playground `email.*` was broken: it pinned published `@fabric-messaging/sdk@beta.3`,
  which predates the email resource (npm stops at beta.3). Vendored the workspace SDK `beta.5` as a
  packed tarball (`file:` dep) — **no public npm publish**. (b) `webhooks.create` 500'd for `sk_*`
  keys — it ignored the key's own application-environment and fell back to the app slugged `default`;
  a renamed app matched nothing → bare `throw` → 500. Now binds the key's environment; structured
  errors on the not-found paths.
- **#153** — Messages → **Insights** tab de-mocked: real `GET /v1/messages/insights` aggregates the
  tenant's `messages` (total_sent / delivered / failed / avg_segments + error breakdown). Was a
  hardcoded BFF stub (24,817 sent, Twilio codes 30008/30003…).

**Full SDK sweep green** (deployed API, sandbox key): sms.send/list/retrieve/sendBatch/retrieveBatch ·
email.send/list/retrieve · verify.start · wallet.retrieve · senderIds.list/create ·
webhooks.create/list/remove/verify/signAndVerify.

**Deploy mechanics (this stack):** Render API key is in Infisical (`RENDER_API_KEY`) — trigger a
deploy with `POST api.render.com/v1/services/srv-d9dfr6ernols73cbf0i0/deploys`, poll the deploy id
for status `live` (~5 min build). Vercel: `vercel deploy --prod` from the **repo root** with the
project linked (`--project fabric-dashboard|fabric-playground --scope in-hot`); the project's
root-directory setting drives the monorepo build. The REST token in auth.json goes stale (403
`invalidToken`) — the CLI auto-refreshes, so use the CLI, not raw REST.

**Follow-ups:** publish `@fabric-messaging/sdk@beta.5` to npm (redline — needs human go) so external
users get email; add an integration test for the insights aggregation; the playground has no
`messages.send` action so "Managed deliveries" can't be exercised from it; the shared sandbox test
key is to be revoked by the owner.

## Earlier (2026-07-18): ADR-0008 — Fabric-owned auth screens (WorkOS behind the scenes)

Branch `feature/ops-adr0008-custom-auth-screens` (off dev `2f457f6`, after ADR-0007 #146 merged).
ADR-0008 **accepted** — own the credential pixels, WorkOS stays the identity engine. Amends the
locked CLAUDE.md "we own no credential form" line (hosted AuthKit is now the FALLBACK, not the only
surface).

- **Slice 1 (`c3c03d2`)** — `@app/fe-auth/credentials.ts`: signInWithPassword, signUpWithPassword,
  verifyEmailCode, sendMagicCode + signInWithMagicCode, all wrapping WorkOS User Management APIs
  and funnelling through the SAME sealed cookie + resolve-v2 as the OAuth callback.
  `buildAuthorizationUrl` gains a `GoogleOAuth` provider (skips hosted, straight to Google). Typed
  `CredentialOutcome` (authenticated / verification_required+pending token / fallback_hosted /
  invalid_credentials / error). Passwords never stored/logged/thrown. 9 unit tests.
- **Slice 2 (`77aa001`)** — split-panel `/signin` + `/signup` (brand hero + form, Relay-style) and
  `/api/auth/*` BFF routes (sign-in, sign-up, verify-email, magic/start, magic/verify, google).
  `credentialResponse` sets the sealed cookie + workspace selector and routes by membership count.
  Per-IP + per-email rate limiting, fail-closed. `/login` → thin forwarder to `/signin` (still the
  registered logout URI; carries flash notices). **Verified live vs WorkOS Test env**: screens 200,
  bad password → invalid_credentials, SSO-domain email → fallback_hosted, Google → provider=GoogleOAuth.

**Deferred (ADR-0008 non-goals)**: passkeys + full custom MFA UI stay on hosted AuthKit; password
reset stays hosted (WorkOS v10 dropped sendPasswordResetEmail — custom reset would need our own
mailer). AuthKit branding already themed (indigo/#fcfcfd) as the fallback surface. **No new WorkOS
redirect-URI registration needed** — Google returns via the already-registered `/auth/callback`,
logout via the already-registered `/login`.

## Earlier (2026-07-18): ADR-0007 — user-level auth, in-app workspace selection (Stripe model)

Branch `feature/ops-adr0007-user-level-auth` (off dev `f1427c9`, after #145 merged). ADR-0007
**accepted** (owner sign-off) and implemented in 4 slices — WorkOS now authenticates the PERSON
only; tenancy lives exclusively in Fabric `memberships`:

- **Slice 1 (`cfc69d2`)** — `POST /internal/identity/session-v2` (subject+email → user + ALL
  memberships; verified stranger gets a bare user row, invited email binds + activates every
  pending invite in active accounts) + `POST /internal/identity/workspaces` (onboarding submit:
  account + owner membership + default app/envs + seeded sandbox credits in ONE local tx — **no
  WorkOS org**). Gates: signup kill-switch, verified email, throttle. 7 real-Postgres tests.
- **Slice 2 (`806b4ff`)** — fe-auth user-level path (`readUserSession`/`handleUserCallback`/
  `refreshUserSession*`); dashboard cut over. Active workspace = HMAC-signed selector cookie
  (`fabric-workspace`) that grants nothing by itself — every request revalidates the selection
  against the freshly resolved membership list before an AppSession/tenant token exists (fail
  closed). BFF routes unchanged (`orgId` = selected tenant).
- **Slice 3 (`beff11c`)** — branded `/onboarding` (user NAMES their workspace), `/workspaces`
  picker (replaces the WorkOS hosted org screen), sidebar workspace switcher (Stripe account
  picker; `POST /api/workspace/switch` validates membership server-side, rewrites only the
  selector cookie). AuthKit hosted screens themed to Fabric via WorkOS MCP (indigo #383a96,
  #fcfcfd canvas, System theme, sign-up name fields on).
- **Slice 4 (`95912e7`)** — org-less invitations everywhere (team invites + ops provisioning;
  role/tenancy = local rows only), ops provisioning is now one local tx (`workos_organization_id`
  stays null — reserved for future enterprise SSO), v1 org-scoped path DELETED (session +
  organization-for-user routes, self-serve adoption provisioner, fe-auth adoptOrganization).
  fe-auth's org-agnostic `resolveSession` no longer requires IdP org/role claims — required so
  the staff realm keeps working once users are detached from WorkOS orgs.

**WorkOS (Staging env) wiring done via MCP**: Vercel redirect/logout URIs registered per app
(dashboard `fabric-dashboard-teal.vercel.app`, admin `fabric-admin-console.vercel.app`; localhost
kept; dead CloudFront URIs dropped); admin-console Vercel `WORKOS_CLIENT_ID` fixed (was the
dashboard's) + redeployed. **Pending, deliberately sequenced AFTER deploy of this branch**: remove
the 5 org memberships in the 2 staging WorkOS orgs (org_01KXB4SH… "fabricservices8's workspace",
org_01KWP2NBAD… "Test Organization") — detaching before the relaxed fe-auth ships would break
logins on the deployed v1 code. Existing sealed cookies force one re-login (accepted, pre-launch).

## Latest (2026-07-15): SDK-002 — endpoint-specific webhook delivery

Branch `feature/ops-neutral-surfaces-template-seeds`. Committed `8f47945`, **local only — no push,
no package publication** (external gate intentionally closed).

- One durable delivery per (outbox event × endpoint). Worker commits a recoverable lease before
  network I/O, retries endpoints independently, keeps append-only attempt history, surfaces
  pending/dead health, and supports owner/admin **replay** (resets the dead cycle, preserves
  history, appends the successful attempt) with a `webhook_delivery.replay` audit record. Endpoint
  removal is a **soft disable** so evidence is retained.
- Outbound SSRF guard (`webhook-url-policy.ts`): resolve + pin the destination immediately before
  connecting (closes the DNS-rebinding gap), reject non-public targets and any multi-A set with a
  private member, HTTPS-only, no credentials/fragments, no redirect-follow, TLS validated, 10s
  timeout, response bodies never buffered. `WEBHOOK_ALLOW_PRIVATE_NETWORKS` override is **local-test
  only** — must never be set in a deployed env.
- Migrations `0067`–`0074` (deliveries + attempts tables, RLS on both). SDK + contracts + dashboard
  deliveries dialog/replay route + OpenAPI updated. DTO mappers extracted to `webhook-dto.ts` to
  clear the 300-line file-length guard.
- **Verification: full `pnpm verify` green** (guard, lint, typecheck, 141 API tests incl. webhook
  delivery/event-contract/HTTP/URL-policy suites, all 4 app builds). Real-Postgres RLS + drift gates
  passed. Evidence: `docs/sdk/evidence/sdk-002.md`. AC01–AC06 traced.
- Env note: `next build` standalone needs **Windows Developer Mode ON** (unprivileged symlink) — a
  prior verify run failed only on the admin-console sharp symlink until it was enabled; CI (Linux)
  unaffected.

**Next up — SDK-003** (author/version/release/**preview** managed SMS definitions). Planning committed,
**no feature code yet, BLOCKED on sign-off**:
- Readiness + 8-slice decomposition: `docs/sdk/sdk-003-readiness.md` (`f729494`). Reuse map: pure
  `@app/domain` `encodeAndSegment`+`rateSegments` reusable; **server-side renderer is net-new** (only
  exists client-side in `preflight.ts`); `sms-engine/engine.ts` is the side-effect boundary preview must
  not cross.
- Slice-0 design: `docs/sdk/sdk-003-slice0-design.md` (`9657b89`) — locks stable-key grammar, the
  portable closed JSON-Schema variable subset, and the pure `analyzeCompatibility` verdict table.
- Slice 1 DONE (`699a86e`) — proceeded on ADR-0005 per explicit go. `message_definitions` /
  `_versions` / `_releases` (migrations `0075` DDL + `0076` RLS): stable key unique per app
  case-insensitively, version immutability enforced by REVOKE (a default-privilege grant hands
  app_runtime full DML, so it must be revoked, not merely un-granted), one-release-per-env, composite
  containment FKs blocking cross-app/tenant releases. 9 real-Postgres invariant tests +
  `db:assert`/`db:assert:drift` green.
- Slice 2 DONE (`d4bfdc8`) — `@app/contracts` stable-key grammar + closed variable-schema subset
  (strict nodes reject `$ref`/`oneOf`; path-coded depth/size/count checks) + definition/version/release
  DTOs; `@app/domain` pure `analyzeCompatibility` (per-field breaking/compatible verdict + JSON paths).
  34 new unit tests.
- Slice 3 DONE (`8bb37a8`) — `@app/domain/message-render.ts`: pure `validatePayload` (subset →
  path-coded errors, never echoes the value) + `previewSms` (token-declared check → validate → render
  → `encodeAndSegment` → `rateSegments`, bounded, blockers ⇒ nothing rendered/priced). The single
  render source preview (slice 5) and SDK-005 send will share. 11 tests incl. preview↔send parity +
  no-PII-in-errors.
- Slice 4 DONE (`ec96a2d`) — `v1/message-definitions` create/list/add-version/publish/archive.
  Authority (ADR-0005 #6): operator or dashboard session (BFF token → `applicationId===null`); a
  scoped `sk_*` key is refused (`management_requires_session`). Breaking version rejected via
  `analyzeCompatibility`; publish upserts the single sandbox release + audits; live refused. 7
  real-Postgres + 5 controller-unit tests.
- Slice 5 DONE (`b13dd91`) — `POST /v1/messages/preview` resolves the released definition for the key's
  env and renders via the shared `previewSms` core; `sms:read` scope (a dedicated `messages:read`
  scope deferred); unreleased key → 404; invalid payload → path-coded blockers. No-side-effect
  integration (3) asserts messages/dispatches/outbox/PII counts unchanged; 3 controller-unit tests.
- Slice 6 core DONE (`d99c140`) — dashboard `/message-definitions`: server-only client + BFF routes
  (list/create/publish/archive/preview with owner/admin write gating + trusted-origin), a page with
  status/version/release state + per-definition Use-in-code snippet + publish/archive actions, and a
  create dialog (key + body + JSON variable schema validated against the subset). 6 route-handler
  tests (role matrix). **Slice 6b deferred** (visual schema builder, interactive preview panel,
  template→draft conversion, member-draft/developer-read-only gating — a developer's session role
  collapses to member, so that split needs a `definitions:write` permission).
- Slice 7 DONE (`a126861`) — `@fabric-messaging/sdk` `MessagesResource.preview` (typed
  `MessagePreview`) wired + exported; `/v1/messages/preview` + schemas in the OpenAPI generator,
  both artifacts regenerated + `openapi:check` current; SDK contract-parity test; evidence doc
  `docs/sdk/evidence/sdk-003.md` (AC01–AC07; AC02 member-draft + AC07 template conversion deferred
  to slice 6b).

## Per-user permission management (2026-07-16, local, unpushed)

Admin-managed per-user permissions on top of the role model (resolves the "tell a developer from a
member" gap). Decisions: **full per-user override** (explicit set wins; role = template), **any admin
grants anything** (escalation trade-off — commented at the seam), **existing catalog** + new
`definitions:write` / `definitions:publish`. Safety rails: **owner is never editable** (no lock-out).

- `@app/contracts/permissions` — single-source catalog + role baselines + pure
  `baselinePermissions`/`effectivePermissions`. `memberships.permissions text[]` (migration `0077`;
  NULL = baseline, set = exact override).
- API: identity session = `effectivePermissions(override ?? baseline)`; `members.setPermissions`
  (owner-immutable); `PUT /internal/tenants/:id/members/:userId/permissions`. identity.service local
  role map removed (now one source with the dashboard).
- Dashboard: message-definitions BFF gates on `definitions:write`/`definitions:publish` (not role);
  Team page per-user permission editor (`MemberPermissionsDialog` + `PUT /api/team/.../permissions`,
  owner/admin gated). Commits `63ee169`, `61ccc48`, `0f15b56`.
- Baseline: member gains `definitions:write` (may draft), not publish; owner/admin get both;
  developer-access adds only api_keys/logs (so a developer cannot author definitions — the original
  ask, now enforced by permission, and an admin can override per user).
- **Follow-ups:** member mutations (incl. permission grants) are still **unaudited** in the members
  module (matches existing updateRole/remove — worth adding); a bounded-by-granter escalation rule if
  the "any admin grants anything" trade-off is revisited; slice-6b definitions UI still open.

**SDK-003 STATUS: core slices 0–7 COMPLETE + verified (local, unpushed).** Full engine + API + SDK +
OpenAPI + dashboard surface for author/version/release/preview managed SMS definitions. Remaining:
**slice 6b** (visual schema builder, interactive preview panel, template→draft conversion,
member-draft/developer-read-only gating). Redline: ADR-0005 still `proposed` — product+security
sign-off required (slice-0 §5) before push/publish. Next backlog item after 6b: SDK-004 (typed
definition catalog CLI).
- RESOLVED (2026-07-17): the `wallet/statement.integration` local failure was residue from crashed
  test runs (fixed-hash `api_keys` + tenant rows whose `afterAll` never ran, colliding on
  `uniq_api_key_hash`), not ledger drift. Stale tenants deleted; full API integration suite green.
- **Still open:** ADR-0005 remains `proposed` (product+security review pending — slice-0 §5 lists the
  asks); the runtime-vs-management authority split lands at the API layer in slice 4, not the DB grants.
- Local-env note: this dev DB has `app_owner`/`app_migrator` table-ownership drift; running the
  migration needed a one-off `GRANT REFERENCES ON applications, environments TO app_migrator` (not in any
  migration — a single-owner DB, i.e. CI, does not need it). Also `drizzle-kit generate` emits composite
  FKs before the unique indexes they reference; the `0075` SQL was hand-reordered (indexes first).

## SDK-005 — managed message deliveries (2026-07-17, local, unpushed)

**Persistence boundary DONE + verified** (`00dda4d`): `POST /v1/message-deliveries` sends a released
definition by stable key through the two-phase SMS pipeline. Preview-gated eligibility; cost cap
fails closed pre-write; atomic delivery+attempt+message+outbox insert keyed on `Idempotency-Key`;
deterministic delivery id per tenant/app/env/key → identical replay returns the same resource with
no second reserve/attempt/outbox; payload mismatch on a reused key → 409 via request fingerprint.
Tables `message_deliveries`/`message_delivery_attempts` (migrations `0080`–`0082`): FORCE RLS +
provisioner policy, composite containment FKs, retention `expires_at` + `legal_hold`.

- Migration failure root-caused: drizzle-kit again emitted the attempts containment FK before its
  target unique index — `0080` hand-reordered (same quirk as `0075`). Second bug: the tenant-tx
  serializer rejects `Date` binds; `expiresAt` now binds `toISOString()::timestamptz`.
- Verified: 7-test real-Postgres spec (`managed-messages.integration.spec.ts`, seeding split into
  `managed-messages.spec-harness.ts`) incl. a **3-way concurrent same-key race → one delivery** and
  reconciliation assertions (inline sandbox resolution propagates delivered + exact cost +
  `resource_version` bump onto delivery/attempt); full API integration 158/158 + wallet/sms-engine
  tiers + unit suites + typecheck green.
- Also fixed (`1a8ccce`): flaky `webhook-http-client.spec` — 20ms shared timeout misclassified
  outcomes under parallel load; per-case timeouts now deterministic.
- **SDK surface DONE** (`e465876`): `fabric.messages.send(key, { to, data, idempotencyKey, … })` +
  `retrieveDelivery(id)` with catalog-generated per-key typing; parser proven against canonical
  `sendManagedMessageResponse`; OpenAPI paths/schemas regenerated; `release:check` green (39 tests).
  Definitions-page Use-in-code snippet now shows `send`.
- Evidence: `docs/sdk/evidence/sdk-005.md` (AC traceability; AC04/AC06 + purge job + dashboard
  delivery logs + packed-example UAT still open).
- **Delivery log DONE (list):** `GET /v1/message-deliveries` (summary rows, no recipient PII; sk_*
  key lists its own env, dashboard tenant token names `environment_id` + sms:read) + dashboard
  `/message-deliveries` page (per-application sandbox log, nav entry). Reads split into
  `managed-messages-reads.ts`. 8-test spec incl. list ordering + no-PII-in-list.
- **Retention purge DONE:** daily maintenance cron purges past-`expires_at` deliveries + attempts;
  `legal_hold` pins indefinitely; ledger/audit untouched; advisory-locked provisioner pass
  (`maintenance-retention.ts`); 2-test real-Postgres spec (purge/hold/fresh + no-op second pass).
- **Detail view DONE:** `/message-deliveries/[id]` — identity facts, masked recipient, exact cost,
  metadata, attempt timeline; list rows link through. Retrieve endpoint gained the same dual
  authority as list (sk_* own env / tenant token names app+env); 9-test spec incl. the
  tenant-token fail-closed + serve path.
- **Crash recovery PROVEN (AC04):** `managed-crash-recovery.integration` — accept → crash (no
  dispatch) → sweeper converges message/delivery/attempt on `expired`, terminal outbox event,
  exactly-one refund, zero provider contact. Full API integration now 37 files / 164 tests.
- **AC06 SHIPPED + PROVEN:** attempt-time rechecks on the queued dispatch path
  (`sms-dispatch-recheck.ts` — kill-switch/consent/sender re-checked before provider contact;
  block → refund-once + terminal event; fail-open on store errors). 3-test spec incl. replay
  no-op. Also fixed the REAL cause of the intermittent statement-spec failures: integration specs
  sharing raw API keys race on the globally-unique key_hash and authenticate as each other's
  tenants — keys de-duplicated/randomized; failure-path diagnostic left in the statement spec.
- **PR #144 MERGED to dev (`dbfd7d1`, 2026-07-17, CI green).** Continuing on
  `feature/ops-sdk005-closeout`.
- **Webhook status DONE (`3073099`):** `GET /v1/message-deliveries/:id/webhooks` (fan-out rows per
  outbox event — endpoint URL/state/attempts/last HTTP, secret never; containment 404) + dashboard
  Webhooks section on the detail page; shared `readScope` dual-authority helper. Also: queue-spec
  flake root-caused (dev-stack worker shares Redis, raced the spec's worker) → `REDIS_QUEUE_PREFIX`
  on QueueService + per-run prefix in the spec. Light canvas → near-white `#fcfcfd`.
- **Sandbox UAT DONE (2026-07-18):** `managed-sdk-uat.integration` — real SDK over real HTTP:
  send by key → worker fan-out → SDK-verified TYPED events (accepted + terminal delivered,
  tampered payload refused) → delivery/attempt/wallet reconcile to one logical message. Full API
  integration now 39 files / 169 tests.
- **DSR/offboarding DONE (2026-07-18):** erasure scrubs managed reference/metadata same-tx with
  the key destruction (money facts survive), summary counts managed deliveries, offboarding =
  soft-close + status-blind retention (proven on a closed tenant). 2-test spec.
- **SDK-005 SCOPE COMPLETE.** Full API integration 40 files / 171 tests. Evidence:
  `docs/sdk/evidence/sdk-005.md`. Next backlog: SDK-006 (live provider path — behind the live-SMS
  redline) or SDK-010 (Journeys, unblocked). Packed-tarball UAT variant = nicety.

## Current direction (2026-07-12): PI-6 — self-service developer platform pivot

Product direction pivoted to a **self-service developer platform** (Stripe/Twilio/Resend-class).
Self-serve sign-up becomes the **primary** onboarding; ops-provisioning is demoted to an
**enterprise exception**; **dev-portal merges into the customer dashboard**; admin-console
tenant-invite-as-primary is removed. Plan: `docs/PI-6/PLAN.md`. Baseline: ~60-70% already exists
(PI-4 verify-first + ADR-0002 self-serve sandbox + ADR-0003 BFF tokens).

**Locked decisions (2026-07-12):** build a real **Workspace → Application → Environment** hierarchy
(**ADR-0004**, supersedes ADR-0002's flat sandbox-entitlement); landing = a **separate marketing
app**; SDKs **Node + Python** first; **Email + AI assistant deferred** to later PIs.

**Branch `feature/e14-workspace-hierarchy`** (off the E13 tip — depends on E13 landing in `dev`
first; then rebases). **Local commits only, NO push until the program is done** (user directive).
Milestones so far:
- ADR-0004 + PI-6 plan committed (`2301adc`).
- Foundation schema: `applications` + `environments` tables (migration `0045`) + RLS/grants
  (`0046`, provisioner + tenant_isolation). RLS boundary stays the workspace/tenant. Cross-tenant
  read/write denial + fail-closed proven — full db integration suite green, 34 tests (`337ae79`).
- Application/environment zod contracts in `@app/contracts` (`c537739`).
- Backfill flat→hierarchy: `cloud-backfill-app-env.ts` (in-image, runs as `app_provisioner` — the
  only cross-tenant role, since FORCE RLS binds even the owner and nothing has BYPASSRLS) + its
  in-VPC ECS task-def. Also re-points existing keys/webhooks. Verified on real Postgres, idempotent
  (`16b081d`).
- `api_keys` + `webhook_endpoints` gain `application_id`/`environment_id` (migration `0047`,
  nullable during two-step backfill) (`c523157`). API keys mint into the default app's env matching
  the key type; live keys gate on the live env being `active` (not on `accounts.plan`); `resolve()`
  + `req.tenant` carry app/env; 8/8 spec green (`a58d2f4`). Webhook endpoints scope to the default
  app's sandbox env (`8f6b512`).
- Both provisioning paths birth the hierarchy: self-serve → live env LOCKED (go-live unlocks); ops
  (enterprise exception) → live env ACTIVE. Converged with the backfill; self-serve spec asserts it,
  5/5 green (`7451ed8`).

- SMS routing keys on `environment.type` (sandbox env → virtual, never a carrier), not
  `accounts.plan`; `send()` uses the presenting key's env, falls back to plan-based for the BFF
  token path; sandbox-routing spec exercises the env pin, 4/4 (`912cd03`).
- Go-live unlocks the live environment (`locked→active`) — the functional gate live-key minting +
  live routing depend on; proposals spec asserts it, 8/8 (`f30a65a`).

**ADR-0004 FOUNDATION COMPLETE — the Workspace→Application→Environment model is in end-to-end:
schema, RLS, contracts, backfill, per-env keys/webhooks, converged provisioning, env-based routing,
go-live env-unlock. Every step tested on real Postgres. All committed, NOTHING pushed.**

Residual hardening (tracked, NOT core, no regression) — task #9:
- `outbox_events` gains `environment_id` + env-filtered webhook delivery (matters once multiple envs
  have live endpoints; delivery is tenant-scoped all→all today, unchanged from before).
- E13 `delivery_mode` moves from `accounts.settings` onto the environment once the dashboard has an
  env selector.

**Phase 2 (applications API):** `GET/POST /v1/applications`, `ApplicationsService.list/create`. New
app is born sandbox-active / live-locked; duplicate slug → 400; tenant-scoped (RLS). 4/4 integration
green (`c5814c4`). Then made customer-consumable (`af4419d`): a new `OperatorOrTenantGuard` lets the
one controller serve BOTH the staff/ops operator path (operator-supplied tenantId) AND the customer
dashboard's tenant-token path (ADR-0003 minted token → `req.tenant`; tenantId derived from the token,
NEVER the client). A present operator token must be valid (no silent fall-through); absent → the
ApiKeyGuard path runs. This sets the reuse pattern for W-B (keys/webhooks real-wiring). Controller +
guard unit specs (11) + full api integration suite (117) green; also fixed stale `api-key.guard.spec`
assertions predating the ADR-0004 `req.tenant` app/env fields.

**Phase 2/3 (dashboard Applications surface) — DONE (`e0f87e5`):** the FIRST customer-facing consumer
of the applications API. New `/applications` dashboard section (server component) lists the workspace's
apps with each one's environment status (sandbox active / live locked-until-go-live) + an owner/admin
create dialog (TanStack Form against `createApplicationRequestSchema`, slug auto-derived). Server-only
`applications-client` calls `/v1/applications` via `dashboardApi` (session-minted tenant token) and
parses the response against the contract; BFF POST route gates trusted-origin + session (refresh
fallback) + owner/admin. Added `applications:read` (universal — the switcher is a core surface) +
`applications:write` (owner/admin) to the role→permissions map so the BFF gate resolves; dev-login
stub matched. Verified: dashboard typecheck + production build green (`/applications` +
`/api/applications` compile), identity specs green (21). NOTHING pushed.

**Auth pivot — DONE (`4bf5a4c`), locked rule OVERRIDDEN per user directive.** SSO-only → **WorkOS
AuthKit hosted self-serve** (email+password + Google + passkeys, SSO optional; WorkOS hosts every
credential form, we own none). Customer realm self-serve; staff realm invite-only. CLAUDE.md §1+§4
rewritten. **Dev-login bypass DELETED** (shared `fe-auth/development.ts` + all 3 apps + dashboard
`/auth/development` route + bypass e2e + `DEV_AUTH_ENABLED`/`DEV_SESSION_PASSWORD`/`DEV_TENANT_ID`
env) — local sign-in now goes through the WorkOS Test env like every env. **`/login` no longer an
intermediate "click again" page** — 302s straight to the AuthKit hosted page (renders only for a
denial/sign-out banner); verified live (forwards to `…authkit.app`). Copy de-SSO'd → "Sign in" /
"Create an account". dev-portal edits were mandatory-only (it imported the deleted shared module) —
it's being deleted in W-B, don't invest.
- **Stripe-style LOOK is WorkOS-dashboard config (EXTERNAL — human):** enable Email+Password /
  Google / Passkeys, apply Fabric branding + one-screen layout, optional custom auth domain; confirm
  each `<APP>_BASE_URL/auth/callback` + `/login` redirect URIs.
- **"Access denied" after sign-in = self-serve signup gate OFF.** Now the **`platform.signup`
  kill-switch** (not an env flag) — fails closed, seeded OFF, toggled live from the admin console
  (`4bf5a4c`… converted in a later commit). A new WorkOS account isn't auto-provisioned a workspace
  until it's flipped on. Flipping it = **W-A**, testing-only; staging/prod human-gated redline (and
  gated on Phase-5 abuse controls existing first).

**W-B slice 1 — API keys real, under an application (`28e616f`).** First dev-portal→dashboard merge
slice. Keys were mock in the dev-portal; now real on the tenant-token API. Per ADR-0004 they live on
the **application-detail page** `/applications/[slug]`, split into **environment sections** (Sandbox
always; **Live hidden until go-live** unlocks it — a sandbox workspace never sees a live table).
`ApiKeysController` reuses `OperatorOrTenantGuard`; `ApiKeyService.create/list` gained an optional
`applicationId` (mint into the NAMED app's env, not just `default`; list filters by app). owner/admin
gained `api_keys:read/write`. Application cards link to the detail + show/count only ACTIVE envs.
Flat `/api-keys` page + nav item removed. **Fixed** a real bug: the tenant-token client set
`content-type: application/json` on every request, so a bodyless DELETE tripped Fastify's empty-JSON
parser → 400 and revoke silently failed; now set only when there's a body. **Browser-verified**
end-to-end (create → once-only secret; revoke → 200 → Revoked). **Key expiry/TTL added (`86bebae`,
migration 0048):** `api_keys.expires_at`; `resolve()` rejects expired keys (auth lookup gains
`expires_at IS NULL OR > now()`); create dialog Expires select (Never/30/60/90d) + table Expires
column. Integration-proven (future-expiry resolves; expired → null).

**W-B slice 2 — webhooks (`a84977b`):** real webhook endpoints under an application, per environment.
`WebhooksService.create/list` app/env-scoped; `WebhookEndpointDto` gains `env` (joined from
environments.type). App-detail page now uses **Tabs (API keys | Webhooks)** per active env, each a
standard Card-wrapped table; webhooks tab has Add-endpoint (url+description → once-only whsec_) +
delete. Fixed `apiRequest` to not parse a 204 body (webhook DELETE). Integration-proven (5/5).

**W-B slice 3 — request logs (`283232a` backend, `fae87df` UI):** net-new vertical (no prior backend).
`request_logs` table (migration 0049 + hand-written RLS 0050) — metadata only (never bodies/raw keys).
Global `RequestLogInterceptor` captures customer sk_* requests fire-and-forget + FAIL-OPEN (skips
bfft_ dashboard calls); `GET /v1/logs` keyset-paginated per app+env; daily retention @Cron in
MaintenanceService (default 30d, advisory-locked). owner/admin gain `request_logs:read`. Dashboard:
a third **Logs** tab per env section (colour-coded status, latency, request_id, time, "Load more").
Integration-proven (4/4: env-scoped keyset, record() fail-open, retention sweep).

**App-detail UX refinements (feedback-driven):** removed the per-page env switcher — the **topbar
Virtual/Live toggle is the ONE env selector** (env is workspace-wide: delivery mode + go-live are
per-workspace, no per-app exception), page follows `session.plan`. The **API keys tab** has its own
**Test/Live switch** (in the card header beside Create key, `ApiKeysPanel`) shown only post-go-live —
you manage both key sets independent of delivery mode. Application card footer shows the **API-key
count** (matches the table, incl. revoked) not the env count (`api_key_count` on ApplicationDto).
Dropped the sidebar "DASHBOARD" badge (ProductMark `showBadge`, dashboard-only). Standard empty
states + Card-wrapped tables throughout.

**dev-portal RETIRED (W-B final step).** Its developer surfaces are now real in the dashboard, so
`apps/dev-portal` is deleted along with its package.json scripts, pnpm-workspace entry, the CI
`deploy-dev-portal-testing` job, and all `infra/dev` Terraform (dev-portal.tf + the dev_portal
blocks in autoscaling/waf/monitoring/ecs/github-oidc/database/variables). `contracts/dev-portal.ts`
STAYS (the dashboard reuses its apiKey/webhook types — misnamed now, rename is a cosmetic follow-up).
No code imports the app; lockfile pruned; api/dashboard/admin typecheck green.
✅ **Live teardown DONE (human-approved "Full apply").** `terraform apply` in `infra/dev` destroyed
all 23 dev-portal resources (ECS service + task def + task role, service discovery, API-GW
api/integration/route/stage + its log group + 5xx alarm, autoscaling target/policies + alarms,
CloudFront edge, app log group, 2 secrets + versions) and dropped the dev-portal ARNs from 3 IAM
policies. The ECR repo refused the default delete (`RepositoryNotEmptyException` — held build
images); force-deleted via `aws ecr delete-repository --force`, then a second `terraform apply`
reconciled it out of state. Plan is now clean (`No changes`); 0 dev_portal resources in state. The
same apply also registered the drifted `app_env_backfill` E14 task def (harmless — task-def revision
only, runs nothing).
⚠️ **Remaining (external, not required):** remove the dev-portal `:3200` redirect URIs from the WorkOS
app (no WorkOS MCP tool this session — do it in the WorkOS dashboard, or ask me to browser-drive it).
They're now-unused entries, not a functional risk.

⚠️ **Local migration drift:** `__drizzle_migrations` tracks through 0046, but 0047–0050 are applied
to the local DB (0047/0048 out-of-band from prior sessions; 0049/0050 applied directly this session
because `drizzle-kit migrate` re-runs the untracked 0047 and errors). Migration FILES are correct +
journaled for a fresh CI/deploy migrate. To reconcile locally: `db:up` fresh + migrate, or record
0047–0050 into `__drizzle_migrations`.

⚠️ **Running API dev server was serving STALE code this session** (didn't hot-reload the api-keys
controller/service edits — a live create wrote NULL expiry despite correct, integration-proven code;
a direct BFF probe confirmed the request reached the API but the stale handler dropped it).
**Restart the API** (`dev:stack:infisical`) to pick up this session's api-keys backend (app-scoping +
expiry). Dashboard-side changes hot-reloaded fine (revoke fix verified live).

**Next — Phases 1–5** per `docs/PI-6/PLAN.md` (frontend-heavy): global environment SWITCHER (chrome
control that pins the selected app/env into subsequent calls — keys, sends; tied to task #9 moving
`delivery_mode` onto the environment); **W-B dev-portal→dashboard merge** — real-wire the still-MOCK
developer surfaces (`apps/dev-portal` keys/reference/webhooks/logs use `@/lib/mock-api`) as
`developer_access`-gated dashboard sections scoped per app-env; marketing app (separate); flip
the `platform.signup` kill-switch in testing (needs human go — redline); Node/Python SDKs; usage;
admin-console realignment. Email + AI are later PIs. Frontend verifies via build/browser, not the
integration-test discipline — different cadence. NB: a live browser drive of `/applications` needs the
full stack up (db + infisical api + dashboard + dev-seed); the tenant-token path itself is API-layer
integration-proven.

**Branch commits (E14):** `2301adc` ADR/plan · `337ae79` schema+RLS · `c537739` contracts ·
`16b081d` backfill · `c523157` key/webhook columns · `a58d2f4` key mint/resolve · `8f6b512` webhook
scope · `7451ed8` provisioning · `912cd03` env routing · `f30a65a` go-live env-unlock · `c5814c4`
applications API · `af4419d` applications API tenant-token path · `e0f87e5` dashboard Applications
surface + permissions · `4bf5a4c` remove dev-login bypass + login forwards to AuthKit (auth pivot) ·
`d68113e` self-serve gate → platform.signup kill-switch · `0400737` ApplicationCard restyle ·
`28e616f` API keys under an application per env (W-B slice 1) (+ HANDOFF/doc commits). Merge order
when done: E13→`dev` first, then this rebases (fifi merges).

_Milestone rule (user directive 2026-07-12): update this HANDOFF.md at every milestone._

## Where things stand

**All 4 apps are DEPLOYED and live in the AWS testing env** (account 677035504110 / eu-west-1),
OIDC→ECR→ECS Fargate behind API Gateway:

| App | URL |
|---|---|
| API | `https://jl4j64pxl3.execute-api.eu-west-1.amazonaws.com` |
| Dashboard (customer :3100) | `https://eq0ydft9pa.execute-api.eu-west-1.amazonaws.com` |
| Admin-console (staff :3300) | `https://leg9wvf1bb.execute-api.eu-west-1.amazonaws.com` |
| Dev-portal (developer :3200) | `https://ko1yjzer8b.execute-api.eu-west-1.amazonaws.com` |

`dev` HEAD ≈ `558e723`. `testing` promoted to it (migrations 0022–0026 applied). Deploy uses the
**`app-dev`** AWS CLI profile (the default profile has NO creds; on git-bash set `MSYS_NO_PATHCONV=1`
for `aws`/`gh` calls with `/`-paths). Seeded testing staff admin: `dacsolo10@gmail.com` (via a
`cloud-seed` ECS run-task).

## Architecture-review remediation (2026-07-09, PRs #96–#111, squash-merged to dev)

Worked an architecture + admin-console review to merged PRs, one finding per PR
(`team/product-owner/ARCHITECTURE-FIXES-PROMPT.md` is the tracking doc):

- **Money correctness:** scheduled reservation-sweeper + ledger-invariant job (#96); client
  `Idempotency-Key` on `POST /v1/sms/send`, no double-charge on retry (#97).
- **Data-plane hardening:** kill-switch TTL cache w/ last-known-good fallback (#98); pino
  structured logging + request-id (#99); token-bucket rate limiting per key + per tenant (#102).
- **Async spine (build-now):** BullMQ send pipeline — provider call + tx2 in an in-process worker,
  tx1 stays in-request, inline fallback (#100); **ElastiCache Redis applied to testing** +
  `REDIS_QUEUE_URL` on the api task-def (#101); transactional outbox + HMAC-signed tenant webhooks
  (#105); provider kill-switch wired to the send path + dead switches pruned (#107).
- **Admin console:** dropped `mock-admin` dead code + repointed at contracts + codified CLAUDE.md
  §3 standards (#106); trusted-origin CSRF gate on every BFF mutation route (#103); single-flight
  token refresh + typed failure semantics + dev-portal helper (#104); vitest bootstrap + first
  tests (#108); tenant detail route keys on slug (#109); **standardized keyset pagination across
  all control-plane tables** (#110); tenant lifecycle actions suspend/reinstate/soft-close (#111).
- **Docs:** ARCHITECTURE §4/§5/§10 + IDENTITY §12.5 (invite-only) / §3.3 (SLO) reconciled to
  as-built (this PR).

**Still open:** A1 full act-as impersonation (plan approved, not built — largest item);
back-channel SLO; MFA enforcement (env-gated); OTel tracing/metrics; admin-console
component/e2e tests. Redis infra is the one applied `terraform apply` (human-confirmed).

## Shipped in the prior session (PRs #71–#90, squash-merged to dev)

Auto top-up · Arkesel SMS adapter + DLR (sandbox) · full UI standardization (PageHeader, shadcn
date/time pickers, DataTable, Form kit, StatCard, chart skeletons, first-class states) · big-bang
TanStack (Query/Table/Form) migration across all 3 apps · real overview (no mocks) · Transactions/
Lighthouse flow slices 1–2 (persist + real Paystack collection via webhook) · SSO journey fix
(denied/signed-out flash-cookie banners, authed→home bounce) · admin+dev deploy plumbing (#87) ·
invite provisioning (#88: staff WorkOS onboarding + `developer` role) · member management (#89:
role-change / soft-remove / resend) · admin-console tenant-member management + dropped provisioning
mock (#90).

## In flight (branch `fix/ops-callback-base-url`, not yet merged)

Fixes the deployed admin/dev callback redirecting to `http://0.0.0.0:3000` after WorkOS auth (built
redirects from `request.url`, which behind API Gateway is the container's internal host). Now uses a
`redirectUrl()` helper resolving `<APP>_BASE_URL`. Also carries this `HANDOFF.md` + `CLAUDE.md`.
**Next:** PR → CI → squash-merge to dev → promote `dev`→`testing` (`git checkout testing; git merge
--no-ff origin/dev; git push`) → redeploy. Until then, deployed admin/dev login dead-ends on
`0.0.0.0:3000`.

## To log in to deployed admin/dev

Invite via the real flow (dashboard Team / admin-console Staff). Unprovisioned identities get the
now-explained `access_denied`. `dacsolo10@gmail.com` is already a testing staff admin → lands on the
Staff Console once the callback-base-url fix deploys.

## Next candidates

- Flows slice 3 (human-gated): real Verify provider + OTP delivery + live SMS notify.
- Staging/production deploy jobs for admin/dev (mirror dashboard) + staging/prod Terraform → flip
  gates (human go).
- Real auth provider off the WorkOS Test IdP (enable Google / email+password at the env level, or
  per-tenant SSO connections) — env-level toggle, no code.
- SMS live: Arkesel done + gated; needs sender-ID approval + funded wallet (human).

## Redlines — never cross without an explicit human go

`terraform apply`, deploy-gate flips, and live external writes need explicit confirmation. **Live
SMS** (Arkesel real) and **live payments** (Paystack live keys) stay OFF — sandbox `sk_test_` /
`SMS_PROVIDER=fake` only. No credentials into third parties. Print secret prefixes, never values.

_Deeper, always-current state also lives in the assistant's memory (`MEMORY.md` index →
`deploy-state`, `auth-provisioning-state`, etc.)._
