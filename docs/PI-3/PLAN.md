# PI-3 — "Make the thin thread real"

**Theme:** turn the verified walking skeleton + the mock-data dashboard into a **live, logged-in,
real-money, real-send vertical** — one slice made real, not five more mock screens.

PI-1 built + proved the correctness core (RLS, double-entry ledger, write-time money enforcement,
SMS engine on FakeProvider, standing gates). PI-2 built the Fabric customer dashboard (5 screens) on
**mock fixtures** + a hardened design system. PI-3 wires the preserved seams to reality.

---

## Decisions

**Resolved (2026-07-03):**
- **First SMS provider:** Africa's Talking (real `SmsSenderPlugin` adapter after FakeProvider).
- **First payment provider:** Paystack (E4 top-up adapter; strong GH+NG, webhooks).
- **Hosting region:** Ghana / West Africa (Ghana DPA focus; nearest AWS = `af-south-1` Cape Town).

**Still open (do not block the buildable lanes; gate the real-send/deploy lanes):**
- DPO / data-protection supervisor (compliance sign-off before real PII at scale).
- Staff-IdP shape + maker-checker scope + impersonation policy (admin-console realm).

---

## Redlines (unchanged, enforced)
production-deploy · real-payments · **real-sms-sending** · spending · external-comms ·
schema-migration-on-shared-db · irreversible-data-ops. Real Paystack charges + real Africa's Talking
sends happen **only behind an explicit human gate**; `sk_test_` + sandbox until ratified.

---

## Lanes

### L1 — fe-auth + BFF (SPINE · buildable now, no decisions needed)
Implement the **frozen `packages/fe-auth` WorkOS interface** (login/callback/session/refresh/logout,
sealed httpOnly cookie, CSRF, org-pinning) + make each Next app **its own BFF** (route handlers hold
tokens server-side). Wire the dashboard: **mocks → live** via the already-fixed `@app/contracts`
shapes (swap `mock-api` bodies for `fetch` to the BFF; signatures hold). Outcome: a **logged-in
tenant sees real data**. Owner: **vivian** (nextjs/bff/workos). Gate: **adams** (session security,
fail-closed on closed/suspended account, CSRF).

### L2 — real read endpoints (buildable now)
`services/*` expose `GET /v1/wallet` (balance + ledger), `GET /v1/messages` (+ `/v1/sms/:id`),
contract-shaped JSON, under RLS `withTenant`, F8.3 errors + `request_id`. The dashboard BFF calls
these. Owner: **newton/pascal**. Gate: **adams** (RLS scoping, contract conformance, integration).

### L3 — Paystack top-up (E4 · gated on real charges)
Payment adapter: Paystack initialize + **webhook** (HMAC-verified) → ledger `credit` on
`charge.success` (idempotent, exactly-once). Wire the mock top-up dialog → real init; balance moves
via the existing double-entry `credit` primitive. **Sandbox first; real charges human-gated.**
Owner: **newton/pascal** (+ the payment plugin seam). Gate: **adams** (webhook idempotency,
reconciliation, money-exactness).

### L4 — Africa's Talking SMS provider (gated on real sending)
Real `SmsSenderPlugin` adapter (send + DLR webhook + sender-ID provisioning + `verifyWebhook` HMAC),
swaps into the engine behind FakeProvider — **engine untouched** (that's why the plugin seam exists).
`adams`' segment-parity + honest-billing gates already guard the money. **Sandbox/allow-listed
numbers first; real sending human-gated.** Owner: **newton/pascal**. Gate: **adams** (DLR mapping,
possession-scoped resolve, real E2E).

### L5 — dev-portal + admin-console (the 2 remaining frontends)
- **dev-portal** (customer realm): real API keys (once-only reveal, test/live), OpenAPI docs, webhook
  tester (registered-endpoints-only, SSRF-guarded), request logs. Owner: **vivian/edison**.
- **admin-console** (staff realm, isolated): tenants, maker-checker, never-silent impersonation
  banner, kill-switch, audit log — **needs the staff-IdP decision**. Owner: **edison** + vivian
  (session). Gate: **adams**.
Both consume `@app/ui` + the `.dc` mockups (fidelity standard applies).

### L6 — deployment + CI (Ghana/West Africa)
Provision the region (`af-south-1` nearest), wire the standing `db:assert`/`db:gate` + parity/money
gates into **GitHub Actions** once a git remote lands (the deferred "provision-later" half). Owner:
**pascal** (build-graph) + fifi.

### Folded-in `[PI-2]` fast-follows (high-value, additive)
spend caps + auto-recharge floor · outbound-webhook **manual replay UI** · API **key rotation**
(dual-validity). Slot into L2/L3/L5 as they land.

---

## Sequencing
1. **L1 + L2 in parallel** → dashboard is real (logged-in, live data) with **zero redline** touched.
   *This is the milestone: the PI-2 dashboard stops being a demo.*
2. **L3 (Paystack, sandbox)** → real top-up path, human-gate the live charge.
3. **L4 (Africa's Talking, sandbox)** → real send path, human-gate the live send.
4. **L5 (dev-portal, then admin-console)** — admin waits on the staff-IdP decision.
5. **L6 (deploy/CI)** — when a remote + region are provisioned.

## Definition of done (per lane)
`.dc` fidelity (frontend) · money exact at every boundary · RLS scoped + fail-closed · F8.3 +
`request_id` · standing gates green · adams browser/integration QA · fifi review + ff-merge · real
external calls only after human ratify.

## The one-line goal
**A real Fabric customer logs in, tops up with Paystack (sandbox), sends an SMS via Africa's Talking
(sandbox), and sees exact money + live delivery — end to end, on the hardened dashboard.**
