# PI-4 Repositioning Proposal — Verify-First, Open Front Door

> **Superseded strategy (2026-07-26):** this proposal records the July 10 PI-4 planning context. Its
> open-front-door work informed the current product, but Verify-first positioning no longer governs
> Fabric. Direct SMS, direct email, and managed messaging are now shipped product surfaces. Use
> [`../POSITIONING.md`](../POSITIONING.md) for current strategy.
>
> **Date:** 2026-07-10 · **Owner:** Product · **Status:** proposal — re-sequences
> [`BACKLOG.md`](./BACKLOG.md); pending fifi ratification at grooming.
> Historical strategy snapshot: POSITIONING v2 · Onboarding decision:
> [`../decisions/0002-self-serve-sandbox-onboarding.md`](../decisions/0002-self-serve-sandbox-onboarding.md)
> Size: **S** ≤1d · **M** ~2–3d · **L** ~1wk+ (matches BACKLOG.md scale).

## What changes and why

POSITIONING v2 drops the payments-seam dependency and re-anchors on **verification-led
transactional messaging** (Verify product · deliverability · auditable billing). PI-4's theme
shifts from *"stop being SMS-only"* to *"ship the golden path"*:

> Stranger signs up self-serve → sandbox tenant → first Verify OTP on their own phone in
> <10 min → per-carrier delivery view → reconcilable billing statement.

Success metric: **time-to-first-OTP**, instrumented.

## Impact on the existing backlog

| Existing (BACKLOG.md) | Disposition |
|---|---|
| **E10 Sender-ID & Compliance** | **Promoted** — stays P0 and graduates from mock-first to real backend (stories below make E10-S1/S2/S3 live: registration engine + send-time enforcement) |
| **E12 Observability** | **Kept P0/P1** — becomes an edge pillar ("prove it arrived"), not polish |
| **E13-S3 sandbox/test mode** | **Absorbed & expanded** into the self-serve front door (F-epic below) |
| **E11 Channel Breadth** (WhatsApp/Voice/USSD/failover) | **Demoted to P2 / deferred** — returns later as *Verify fallback channels*, not CPaaS parity |
| E13-S1/S2, E14 polish | Unchanged priority, capacity-permitting |
| PI-5 E16 payments-seam lighthouse | **Shelved** (dormant Option B in POSITIONING v2) |

## New epics (codes provisional — number at ratification)

### Epic F — Open the front door (ADR-0002)

- **F1 · Tenant-scoped BFF credentials at provision time — P0 · M (prereq).** ADR-0001
  consequence: dashboard BFF uses a tenant-bound API key, so a self-provisioned org has no
  credentials. Mint tenant-scoped BFF credentials during auto-provisioning.
  *AC:* self-provisioned tenant serves authenticated BFF requests immediately; secret never
  reaches the browser; integration test provisions an org and completes one BFF round-trip.
- **F2 · Self-serve sign-up → sandbox auto-provision — P0 · L.** AuthKit
  `screen_hint: 'sign-up'` (customer realm only); first callback provisions WorkOS org +
  `accounts` + active owner membership, idempotent upsert by `sub`, provisioning connection.
  *AC:* new email → fresh sandbox tenant, zero staff touch; replayed callback/webhook in either
  order provisions exactly one org (integration test); staff realm + invite flow regression-
  tested unchanged; sign-up rate-limited per IP + email; unverified email cannot provision.
- **F3 · Sandbox entitlement state — P0 · M** (expands E13-S3). Flag on the tenant:
  `sk_test_*` only, routing pinned to FakeProvider, seeded test credits (ledgered), sends only
  to owner-verified numbers, rate-limited.
  *AC:* sandbox send **cannot** reach a real provider — enforced in routing with a test that
  attempts to force live routing; SANDBOX banner in dashboard; own-number verification flow.
- **F4 · Go-live request + ops approval — P1 · M.** In-dashboard request (business info, KYC,
  sender-ID application) → admin-console queue on the existing maker-checker flow.
  *AC:* approval needs maker + checker, flips entitlements, audit-logged; rejection reason
  visible to customer; tenant detail shows sandbox/live state.
- **F5 · Guided first-OTP quickstart + activation metric — P1 · S/M.** Dev-portal quickstart
  (copy test key → curl Verify → OTP); instrument time-to-first-OTP.
  *AC:* quickstart alone reaches a successful `verify/check`; metric recorded per tenant,
  visible in admin-console.

### Epic V — Verify as the product

- **V1 · Public Verify API — P0 · L.** `POST /v1/verify` + `POST /v1/verify/check` on E6 OTP +
  identity; per-verification billing as ledger entries, idempotent on reference; code hashing,
  expiry, max attempts, resend throttle.
  *AC:* zod contract in `@app/contracts`, parsed at API + BFF; one verification = one balanced
  ledger entry, replay-safe (integration test); brute-force bounded (tests); works on
  `sk_test_*` via FakeProvider; structured error codes (expired / exhausted / wrong-code).
- **V2 · Verify dashboard surface — P1 · M.** Attempts, conversion, per-channel stats;
  explicit error/loading/empty states; keyset pagination; no mock data.

### Epic B — Auditable billing

- **B1 · Statement export — P1 · S/M.** CSV statement: per-message/per-verification cost
  lines, opening/closing balance, balanced by construction; wallet UI copy reframed to
  "billing you can audit."
  *AC:* exported lines sum exactly to the period's balance delta (integration test on real
  ledger data); reference ids usable in disputes; server-side stream.

### E10 additions (make compliance real)

- **E10-S4 · Send-time sender-ID enforcement — P0 · M.** Live sends with unregistered sender
  ID blocked with a structured error, not silently dropped (closes E10-S2's `TODO(BFF)`).
- **E10-S5 · DND/quiet-hours send-time enforcement — P0 · M/L.** Message class required at
  send; promo to opted-out recipient blocked + surfaced in DLR view; quiet hours enforced for
  promo, never for OTP (tests assert both directions; closes E10-S3's `TODO(BFF)`).
- **E10-S6 · Ghana NCA compliance spike — P0 · S (legal/ops).** Confirm NCA sender-ID process,
  data residency, carrier requirements for the launch market (COMPETITIVE-ANALYSIS C-6).
  *AC:* written findings; E10 scope adjusted for GH; GTM gate decision recorded.

## Sequence

```
F1 (prereq) ──► F2 ──► F3 ──► F5 ◄── V1 ──► V2
E10-S4/S5 + E12 (parallel) · E10-S6 first (legal lead time) · B1 anytime (quick win)
```

## Open decisions (fifi / human)

1. Ratify this re-sequencing + ADR-0002 (decision taken by product owner 2026-07-10;
   sequencing ratification pending).
2. Verify pricing model (per-verification vs SMS-cost+margin) — blocks V1 billing line-items;
   needs the wholesale-rate research (COMPETITIVE-ANALYSIS §5 Q1).
3. Sandbox limits: credit amount, rate caps, TTL cleanup of never-activated tenants.
4. E10-S6 findings may reshape E10 scope for Ghana.
