# Walking Skeleton — the trimmed P1 build target

**Date:** 2026-06-02 · Derived from `ARCHITECTURE-REVIEW.md`. This is the **thinnest vertical
slice that proves the riskiest things**, with every deferred piece keeping its seam so it's
additive later (Principle #1). Build *this*, not "the platform."

---

## Goal: retire the three real risks, nothing more

| Risk (if we're wrong, the business fails) | What proves it's retired |
|---|---|
| **1. Money is incorrect under concurrency** | Wallet reserve→commit/refund + double-entry ledger; CI invariant `Σcredits−Σdebits=balance` stays green under concurrent load |
| **2. We can't reliably send + know the outcome** | A real SMS leaves via **one** provider; a real DLR comes back; status + cost reconcile |
| **3. We can't get paid** | A real top-up via **one** payment provider credits the wallet idempotently |

Everything else (failover, multi-provider, multi-currency UX, dashboards, omnichannel, generic
registries) is *valuable later* but proves **nothing new** about viability now.

---

## In scope (P1)

**Identity & access**
- WorkOS AuthKit SSO (customer) + **separate staff org** (admin). Self-serve sign-up → JIT creates
  org + owner. MFA mandatory for admin/owner.
- API keys (`sk_live_*` / `sk_test_*`), scopes, hashed at rest.

**Money (the crown jewel)**
- Wallet + double-entry ledger, **multi-currency machinery; enabled-currency set is control-plane
  config** (operator enables one at launch; adding more = config change, no migration — see B2).
- Reserve → commit/refund lifecycle; idempotency keys; `FOR UPDATE` concurrency.
- **Reservation-TTL sweeper** (C4): a reservation with no resolving DLR within N minutes
  auto-resolves to a defined default (refund), audited. *No customer funds locked forever.*
- Billing/rating: segments × per-destination price; usage records. **Per-provider billable-status
  set + platform-fault exemptions** — bill the customer on the same basis the provider bills us;
  **never commit a charge for a failure the platform caused** (auto-refund the reservation).

**SMS**
- Engine: normalize (E.164) → encode/segment (GSM-7/UCS-2) → rate → reserve → send → commit/refund.
- **One** provider behind the **`SmsSenderPlugin` contract** (no selection/failover engine yet).
- DLR ingestion + reconciliation (canonical status mapping).
- **OTP / Verify (SMS channel)** (B1): generate + verify, attempt limits, expiry, **auto-redacted bodies**.
- **Opt-out / STOP suppression** (C2): inbound STOP path + a suppression check that **blocks** sends
  to opted-out numbers. Compliance, not optional.
- Message bodies stored by default, encrypted, retention window; per-message `redact` flag.

**Surfaces**
- Public API: `POST /v1/sms/send`, `GET /v1/sms/:id`, `GET /v1/messages`, OTP send/verify,
  `GET /v1/wallet`, `POST /v1/wallet/topups`, webhook registration.
- `webhooks-ingress`: DLR callbacks + payment callbacks (+ inbound STOP).
- **Minimal admin console** (control plane): **configure enabled currencies + default**, inspect
  tenant/messages/wallet, approve sender-IDs, audited manual wallet adjustment (maker-checker for
  money), read-only health. *No generic product registry.*
- Sandbox: `sk_test_*` + a **`FakeProvider`** that simulates accept + DLR (C5).

**Cross-cutting (day one)**
- Immutable audit log; events-bus (outbox); idempotency store; structured logs + traces;
  ledger-invariant job.

**Compliance (day one — schema-shaping; see `COMPLIANCE-AND-DATA-PROTECTION.md`)**
- **PII tokenization**: raw phone/body/attributes live only in an encrypted **`pii_vault`** keyed
  by a per-subject DEK; `messages`/`contacts`/ledger reference a stable **`subject_id`** surrogate,
  never the raw number. **Erasure = destroy the subject's DEK** (crypto-shred) — financial/audit
  rows stay intact. *This must land in the first migrations, not later.*
- **DPA template** auto-incorporated into ToS (we are processor for recipients, controller for
  tenant-users); **privacy notice + consent** (Ghana DPA).
- **Data-residency-aware**: `data_region` on tenants + `integration_instances`; default region
  chosen for NDPA/CBN (see Open Decisions).
- Encryption at rest (incl. vault) + retention purge job (already noted) + opt-out/STOP (already P1).
- **Administrative (non-code, do early):** Ghana **DPC data-controller registration** + appoint a
  **Data Protection Supervisor**; pick launch hosting region.

---

## Decisions embodied (flag if you disagree)

These three came from the review as **recommendations**; I've baked them in. Say the word to flip any.

- **B1 — OTP is P1**, not Phase 3. (Highest-margin use case; reconciled across all docs.)
- **B2 — Currency is *control-plane configuration*, not code (resolved).** We build the full
  multi-currency machinery (wallets keyed by `(tenant, currency)`, per-currency pricing); the
  **set of enabled currencies + default** is managed in the admin console. The operator enables
  **one** currency at launch; adding more later is a **config change — no migration, no deploy**.
  FX stays deferred (single-currency per ledger txn).
- **B3 — Bill on the provider's billable basis; never charge for *platform-caused* failures.**
  Each provider instance declares a **billable-status set** (e.g. `submission|accepted|delivered`)
  + a **platform-fault exemption list**. The customer is billed on the **same basis the provider
  bills us** (pass-through, no margin gap) and is **never charged for failures the platform caused**
  (internal error, account suspension, fraud/SMS-pumping block, geo-permission block) — those
  auto-refund. Always show reconciled DLR + cost-per-delivered. *Guaranteed-delivered billing* is an
  opt-in premium tier on trustworthy routes, priced ≥ `cost ÷ delivery_rate`.
  > **Refined (2026-06-02, PI-1 research):** the earlier "never charge for *any* failure" was too
  > absolute — Twilio bills `undelivered` + a $0.001 `failed` fee but exempts platform-fault cases;
  > Termii bills at MNO submission with no non-delivery refund. Honest + viable = "never charge for
  > failures *we* caused," not "never charge for failures."

---

## Explicitly deferred (seam preserved, build later)

| Deferred | To | Seam that stays now |
|---|---|---|
| Generic selection / failover / circuit-breaker engine (D1) | P2/P3 | The `SmsSenderPlugin` contract + a trivial registry |
| Payment **plugin framework** + initiation-only failover (D2) | later | One payment provider behind a thin `PaymentProvider` interface |
| Multi-currency multi-wallet UX + per-currency pricing (B2) | 2nd market | `currency` columns already present |
| `fx_rates` table (D3) | when FX is built | Documented intent only — **don't create the table** |
| Generic `ProductManifest` registry (D4) | product #2 | Control plane hardcodes SMS for now |
| Multi-channel OTP, scheduling, white-label, premium/shortcodes, omnichannel | P2/P3 | Engine + plugin contract |
| Business dashboard (campaigns/contacts/templates) | P2 | `dashboard-api` BFF stub |

---

## The demo that = "done" (exit criteria)

A single end-to-end script must pass on real infra:
1. Sign up self-serve → org + owner created, MFA enrolled.
2. Mint an API key; fund the wallet via a **real top-up** (one provider) → balance credits **once**
   even if the callback is retried.
3. `POST /v1/sms/send` → message normalized, segmented, **reserved**, sent via the one provider.
4. Provider **DLR** arrives → status + cost reconcile; wallet **commits** (or refunds on failure).
5. Send to an **opted-out** number → **blocked** before reserve.
6. Run **OTP send + verify** end-to-end (body redacted in storage).
7. Kill the DLR (simulate no callback) → **reservation sweeper** auto-resolves within TTL; funds freed.
8. Operator opens the **admin console** → sees the tenant, the messages, the ledger; posts an
   audited adjustment under maker-checker.
9. **Ledger invariant stays green** throughout, including a concurrent-send load test.

If all nine pass, the risky core is proven and you can scale features with confidence.

---

## Trimmed build order

```
0. WorkOS env (customer org + staff org) · staff-iam · audit · idempotency · events-bus
1. identity (accounts, users-by-sub, memberships) + `data_region` on tenants
1b. PII layer: data_subjects (subject_id surrogate) + pii_vault + per-subject DEK / crypto-shred
    — MUST exist before messages/ledger reference PII (compliance, schema-shaping)
2. api-keys
3. wallet (multi-currency machinery; enabled set via config) + ledger (refs subject_id) + reservation sweeper
4. billing (rating, usage)
5. sms plugin CONTRACT + ONE provider adapter + FakeProvider (sandbox)
6. sms/engine (normalize→encode→rate→reserve→send→commit/refund)
7. opt-out/STOP suppression + inbound ingest (minimal)
8. dlr (ingest + reconcile)
9. otp (send + verify, on the engine)
10. one payment provider (direct, thin interface) + top-up + payment-callback ingress
11. webhooks(out) + public API
12. minimal admin console (configure currencies · inspect · sender-ID approve · wallet adjust w/ maker-checker · health)
```

> Deferred vs the full build order in `MODULE-DECOMPOSITION.md §12`: no integrations *engine*,
> no payment *framework*, no product registry, no dashboard — those come after the skeleton walks.
