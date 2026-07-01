# PI 1 — Backlog (research-grounded)

**Date:** 2026-06-02 · **Scope:** the walking skeleton (`WALKING-SKELETON.md`). Every feature is
annotated with **competitor evidence (what + how)** and **value**, from the PI-1 research
(Twilio, Stripe, Plivo, Vonage, Africa's Talking, Termii, Infobip, Paystack, Flutterwave, Hubtel,
Modern Treasury) plus prior research already in the docs.

**Priority tags:** `[MUST]` committed PI-1 · `[STRETCH]` if capacity · `[PI-2]` deliberate fast-follow.
**How to read:** Epic → Feature → stories + acceptance criteria; each feature carries *Evidence/How*
and *Value*. This is intentionally larger than one team-PI — `MUST` is the commit; `STRETCH`/`PI-2`
are the relief valve and drop first.

---

## PI-1 objectives (measurable)
1. A developer self-signs-up, gets `sk_test`/`sk_live` keys, funds a wallet, and sends an SMS that
   reconciles to an accurate charge — **ledger invariant green under concurrent load**.
2. OTP send+verify works end-to-end (bodies redacted).
3. Opt-out/STOP and sender-ID rules are **enforced before send** (compliance-safe to operate).
4. Money is provably correct: no double-charge, no lost/locked funds, no charge for platform-caused failures.
5. Operators can configure currencies/pricing/providers and inspect/repair from an admin console.

**PI System Demo = the 9-step "done" script in `WALKING-SKELETON.md` + OTP + a STOP-blocked send.**

---

## Research-driven changes to prior decisions (read first)

1. **Billing principle refined.** "Never charge for failures" → **"charge on the provider's billable
   basis; never charge for failures the *platform* caused."** Twilio bills `undelivered` + a
   $0.001 `failed`-processing fee (since 30 Sep 2024) but **exempts internal errors, suspension,
   fraud/pumping blocks, geo-permission blocks**; Termii bills at MNO submission, no refund for
   non-delivery; Africa's Talking has an explicit `Refund` category. → encode a per-provider
   **billable-status set + platform-fault exemption list**. *(Updates `SMS-FEATURES §5.A`, `INTEGRATIONS §3`, `WALKING-SKELETON B3`.)*
2. **New P1 item — DLR-trust safeguards.** The African market's #1 problem ("fake DLRs" — routes
   reporting `delivered` for dropped traffic) is *our wedge*. Add **per-route delivery probing /
   test-number monitoring** as a first-class P1 feature, not an afterthought.
3. **OTP → a *managed Verify product*, not "send an SMS with a code."** Built-in expiry/attempt
   limits + fraud protection + **success-based pricing** is the high-margin SKU.
4. **Verify Fraud Guard / SMS-pumping protection** belongs in P1 (protects Verify margin + customer spend).
5. **Spend controls** (low-balance alert P1; auto-recharge + spend caps fast-follow) — Twilio ships 3 primitives.

---

# Epics

## E1 — Platform foundations & tenancy *(enablers)*
| F | Feature | Pri | Evidence/How · Value |
|---|---|---|---|
| 1.1 | Multi-tenant model + Postgres **RLS** + per-request tenant context | MUST | Industry best-practice; our `ARCHITECTURE §2`. *Value: hard isolation; app-bug can't leak across tenants.* |
| 1.2 | **events-bus** (transactional outbox) | MUST | Outbox pattern. *Value: state-change + event atomic → no lost/phantom events.* |
| 1.3 | **Idempotency** store/service | MUST | Stripe model (see F8.2). *Value: safe retries on the money path.* |
| 1.4 | **Immutable audit log** (actor/action/before→after/reason) | MUST | Twilio Trust / compliance. *Value: forensics + compliance evidence.* |
| 1.5 | Observability: structured logs (`tenant_id`+`request_id`), traces, metrics, **ledger-invariant job** | MUST | OTel. *Value: the invariant job is the money-correctness alarm.* |
| 1.6 | **Platform notifications** (transactional: low-balance, sender-ID approved, DSR receipts) | MUST *(post-thread → PI-1.5)* | Underpins F3.7 low-balance alert. *Value: operational + customer comms on the money/compliance path.* |

## E2 — Identity, SSO & API keys
- **F2.1 Customer SSO (WorkOS AuthKit)** `[MUST]` — self-serve signup → JIT create org+owner; MFA mandatory admin/owner; BFF httpOnly session.
  - *AC:* new email → org+owner created, MFA enrolled; tokens never in browser JS; second app = silent SSO.
  - *Evidence/Value:* WorkOS AuthKit (prior research). One login across all future apps.
- **F2.2 Staff identity + admin RBAC** `[MUST]` — separate staff org; MFA-all; roles `super_admin/platform_ops/finance/support/compliance/read_only`; step-up for dangerous actions.
  - *Evidence/Value:* `IDENTITY-SSO §13`. Blast-radius isolation from customers.
- **F2.3 API keys** `[MUST]` — **`sk_live_`/`sk_test_` prefix (env)** + **privilege scopes** (per-resource) + shown once + **hashed at rest** + prefix-indexed; secret-scanner auto-revoke hook.
  - *Evidence/How:* Stripe encodes env in prefix; Twilio encodes privilege in key type → **adopt both**. Stripe partner secret-scanning auto-revokes leaked `sk_live_`.
  - *Value:* instant human/scanner recognition; capped blast radius.
- **F2.4 Key rotation with overlap window** `[PI-2]` — dashboard rotate, ≤12h dual-validity (Stripe). *Value: zero-downtime rotation so teams actually rotate.*

## E3 — Wallet, ledger & billing *(crown jewel)*
- **F3.1 Multi-currency wallet + immutable double-entry ledger** `[MUST]` — balance **derived** from entries (never a mutable counter); `pending`→`posted`; reversals = compensating entries; minor-unit bigint; `UNIQUE(tenant_id,currency)`.
  - *Evidence/How:* Modern Treasury (double-entry, immutability, pending→posted) — *best-practice; CPaaS don't publish ledgers*. Africa's Talking transaction categories (Debit/Credit/Refund/Topup) = the vocabulary.
  - *Value:* "architecturally impossible to lose track of money."
- **F3.2 Two-phase debit (reserve→commit/refund) + idempotency + `FOR UPDATE`** `[MUST]` — reserve `pending` debit on send → `post` on billable status → compensating credit on platform-caused failure.
  - *AC:* concurrent sends can't spend same balance; retried send debits once.
  - *Evidence/Value:* Stripe idempotency + best-practice two-phase. Correct money under concurrency.
- **F3.3 Reservation-TTL sweeper** `[MUST]` — reservation with no resolving DLR auto-resolves (default refund) after N min, audited.
  - *TTL:* **~60 min default, config-tunable per-tenant** (not hardcoded). Since commit fires on `accepted` (submission, seconds) not delivery, at 60 min only *never-acknowledged* reservations are swept — safely generous. Final tuning → F3.3 story with newton+adams against observed provider-ack latencies.
  - *Value:* no customer funds locked forever (gap C4).
- **F3.4 Rating + usage records** `[MUST]` — each debit carries quantity, unit, unit price, currency, category; queryable per tenant.
  - *Evidence/How:* Twilio UsageRecords (`usage/usage_unit/price/price_unit`). *Value: customer-facing billing transparency.*
- **F3.5 Per-provider `billingBasis` + platform-fault exemptions** `[MUST]` — bill on provider's billable status; never charge for platform-caused failures (see refinement #1).
  - *Evidence/How:* Twilio bills undelivered + $0.001 failed fee but exempts internal/suspension/fraud/geo. *Value: honest + margin-safe; the transparency wedge, correctly scoped.*
- **F3.6 Enabled-currency config** `[MUST]` — supported currencies + default set in control plane; validate wallet/pricing/top-up against it.
  - *Value:* add a currency = config change, no migration.
- **F3.7 Low-balance alert** `[MUST]`; **auto-recharge floor + spend caps/threshold webhooks** `[PI-2]`.
  - *Evidence/How:* Twilio UsageTriggers (threshold webhooks, offset triggers, ~1/min eval) + $5/$0 emails + Auto Recharge (refill-to-Y-when-below-X). *Value: prevent interruption + runaway-spend/fraud protection.*

## E4 — Payments / top-up
- **F4.1 One payment provider (thin interface)** `[MUST]` — hosted checkout; **mobile money + card**; instant crediting.
  - *Evidence/How:* Hubtel instant credit; Flutterwave/Paystack hosted checkout; mobile money first-class in-market.
- **F4.2 Top-up flow (correct)** `[MUST]` — `initialize → redirect → verify server-side → webhook = source of truth → credit wallet only after verification` (idempotent handler).
  - *AC:* browser redirect alone never credits; duplicate webhook credits once.
  - *Evidence/How:* Paystack/Flutterwave both state explicitly: never trust redirect, verify server-side, webhook is source of truth. *Value: no fraudulent/duplicate credits.*
- **F4.3 Payment reconciliation & reversals** `[MUST]` — reconcile PSP settlement vs credited top-ups; handle chargebacks/reversals as **compensating ledger entries** (never edit history).
  - *AC:* a reversed/failed-after-credit top-up posts a compensating debit; ledger + trial-balance stay balanced.
  - *Evidence/How:* Paystack/Flutterwave webhooks incl. reversal/chargeback events; ties to the `gateway_clearing` account (`ledger-double-entry` v1.0.0). *Value: no orphaned credits; money-in stays correct.*

## E5 — SMS engine & delivery
- **F5.1 `SmsSenderPlugin` contract + ONE provider adapter + `FakeProvider`** `[MUST]` — contract carries `send/parseDlr/verifyWebhook/supports/healthCheck/billingBasis`.
  - *Evidence/Value:* `INTEGRATIONS §3`; FakeProvider powers test mode (F8.5). Anti-lock-in seam.
- **F5.2 Send pipeline + segmentation** `[MUST]` — normalize E.164 → encode (GSM-7 **153**/UCS-2 **67** concatenated) → rate → reserve → send → commit/refund.
  - *Evidence/How:* Twilio segment math; one non-GSM char flips whole msg to UCS-2 (152+1 → 3 segments). *Value: revenue correctness.*
- **F5.3 Normalized message-status enum** `[MUST]` — **`queued→sending→accepted→sent→delivered/undelivered/failed`** (+ error codes); every provider maps onto it; unmapped raw status → explicit error, never a silent default.
  - *Commit-point (ratified, PRE-IMPL B1):* `accepted` = provider acknowledged submission (the new state). COMMIT fires on transition into the **first canonical status in the provider's `billableStatuses` set — default `{accepted}`**; a platform-fault-exempt status (F3.5) → REFUND. Guarded by the B6 message-row terminal SM + deterministic `commit:{msgId}`/`refund:{msgId}`.
  - *Evidence/Value:* Twilio statuses. The provider-abstraction contract; billing+SLA observability.
- **F5.4 DLR ingestion + reconciliation** `[MUST]` — terminal statuses persisted; cost reconciled; error codes mapped; out-of-order tolerant.
  - *Evidence/Value:* Twilio StatusCallback (`MessageStatus`,`ErrorCode`,`RawDlrDoneDate`).
- **F5.5 Smart-encoding warning / segment quote at send** `[MUST]` — surface segment count + encoding before/at send.
- **F5.6 Basic bulk/batch send** `[STRETCH]` — fan-out a list; per-recipient status. *(Throughput/backpressure hardening = `[PI-2]`, gap C1.)*
- **F5.7 Inbound message ingestion (MO)** `[MUST]` — receive inbound SMS (incl. STOP/START/HELP); normalize → resolve `subject_id` → route to the opt-out engine (F7.2) + tenant inbound webhook.
  - *AC:* an inbound STOP reaches F7.2 and suppresses future sends. *Value:* prerequisite for STOP handling. **In the thin thread.**

## E6 — OTP / Verify *(managed, high-margin)*
- **F6.1 Managed Verify** `[MUST]` — `start`(send) + `check`(verify); configurable code length (4–10), **~10-min expiry** (re-request returns same token in window), **attempt limit (~5/10min)**; auto-redact bodies.
  - *Evidence/How:* Twilio Verify + Vonage Verify + Termii Token (`pin_length/pin_time_to_live/pin_attempts/pin_type`). *Value: customer writes ~no code.*
- **F6.2 OTP body redaction** `[MUST]` — auto-redact the verification code in stored message bodies (never persist a live OTP in cleartext).
  - *Evidence/Value:* Twilio/Vonage Verify redact codes. Privacy + limits credential-theft blast radius.
- **F6.3 SMS-pumping / Fraud-Guard-style protection** `[MUST-basic]` — block destination-prefix anomalies; on by default (full traffic analytics → PI-2).
  - *Evidence/How:* Twilio Fraud Guard (analyzes traffic, blocks AIT prefixes, free). *Value: protects Verify margin + customer spend.*
- **F6.4 Verify success-based pricing** `[Seam in PI-1 · full billing PI-1.5]` — bill per successful verification (+ channel cost), not just per SMS.
  - *PI-1 seam (MUST):* a Verify charge records with its own **usage-category (`verify`) in F3.4 `usage_records` + txn `metadata`**, distinct from a raw SMS charge, and captures the verification outcome — even though PI-1 bills per-SMS. **No new `ledger_txn_type`/`reason` values** (ledger enums stay SMS-clean). PI-1.5 flips the rate to per-successful-verification with **zero schema/enum migration**.
  - *Evidence/How:* Twilio ($0.05/verify + SMS); Vonage "Verify Success" charges only on conversion. *Value: 5–7× a raw SMS — the margin SKU; seam protects it without over-scoping PI-1.*
- **F6.5 Channel fallback (SMS→voice→WhatsApp)** `[PI-2]` — Vonage workflow / Termii channels.

## E7 — Compliance & data protection *(legally gating)*
- **F7.1 PII tokenization** `[MUST — schema-shaping, build first]` — `data_subjects` surrogate + encrypted `pii_vault` + per-subject DEK; **erasure = crypto-shred DEK**; all tables reference `subject_id`.
  - *Evidence/How:* Bird's published erasure model (can't erase legally-retained; keep request-proof 5y). *Value: right-to-erasure vs immutable ledger, resolved.*
- **F7.2 Opt-out engine (STOP/START/HELP) + suppression list checked on every send + DND-aware routing** `[MUST — legally mandatory]`.
  - *Evidence/How:* Twilio Advanced Opt-Out (default keyword set; blocked-list checked pre-send; Error 21610); Nigeria NCC **2442** DND; Termii **`dnd` channel**. *Value: fines (₦10M/2% revenue) + blocking otherwise.*
- **F7.3 Sender-ID registration workflow** `[MUST]` — tenant-owned, **per-country/per-operator approval state**; **block sends on unapproved IDs**; track multi-day approval.
  - *Evidence/How:* Africa's Talking (11-char, trademark proof, 7–14 working days per network). *Value: unregistered = filtered/blocked in-market.*
- **F7.4 Message-body handling** `[MUST]` — store default (config), encrypted in vault, retention purge (~180d), per-message `redact`.
  - *Evidence/Value:* Twilio/Plivo/Bird (prior research). Privacy + support.
- **F7.5 DLR-trust safeguards** `[MUST-basic]` — per-route delivery probing via **test SIMs/monitoring**; flag routes whose real delivery diverges from reported DLRs.
  - *Evidence/How:* "fake DLR" problem (Testelium/CM.com); independent delivery testing. *Value: our reliability wedge — don't resell fraud.*
- **F7.6 Governance** `[MUST]` — DPA template auto-incorporated; privacy notice/consent; `data_region` on tenants. **Enablers (non-code):** Ghana DPC registration, appoint DPO/Supervisor.
  - *Evidence/Value:* `COMPLIANCE-AND-DATA-PROTECTION.md`. Ghana = criminal if unregistered.
- **F7.7 DSR (operator-initiated access/erasure)** `[MUST-basic]`; **DSR-by-API** `[PI-2]` (Bird Personal Data API pattern).

## E8 — Developer experience & public API *(the wedge African rivals left open)*
- **F8.1 Versioned REST API** `[MUST]` — date-based, account-pinned, `Version` header overrideable.
  - *Evidence/How:* Stripe date-based; Twilio path-based. *Value: ship breaking changes without breaking integrators.*
- **F8.2 `Idempotency-Key` on writes** `[MUST]` — cache status+body **24h**, **replay even errors**, return `Idempotent-Replayed: true`, same-key+different-body → error.
  - *Evidence/How:* Stripe's exact semantics. *Value: deterministic safe retries.*
- **F8.3 Typed error envelope + request IDs** `[MUST]` — `{type,code,message,param,doc_url}` + `req_…` on every response + semantic HTTP codes (400/401/402/409/429/…).
  - *Evidence/Value:* Stripe/Twilio. Programmatic handling; "give me the req id" support.
- **F8.4 Outbound webhooks** `[MUST core]` — `t=…,v1=HMAC-SHA256` + **~5-min tolerance**, **per-endpoint signing secret**, **exponential backoff over hours/days + DLQ**; **manual replay UI** `[PI-2]`.
  - *Evidence/How:* Stripe signature + 3-day retries + CLI; **Twilio's single 15s retry is the gap to beat**. *Value: reliable at-least-once delivery + replay.*
- **F8.5 Test mode + magic MSISDNs** `[MUST]` — `sk_test` simulates without charge/real carrier; magic numbers deterministically yield `delivered/failed/undelivered/rejected/insufficient-funds`; **unlike Twilio, fire status callbacks** so webhook handling is testable.
  - *Evidence/How:* Stripe magic cards; Twilio magic numbers + test creds. *Value: full happy+failure paths in CI before real spend.*
- **F8.6 TypeScript SDK + docs/dev portal** `[MUST-basic]` — key mgmt, usage logs, webhook tester; interactive docs. **More SDKs + CLI (`listen/forward/trigger/replay`)** `[PI-2]`.
  - *Evidence/Value:* Stripe/Twilio docs+CLI = the moat; AT/Termii lack CLI, idempotency, signed/retried webhooks, interactive docs → **DX is our wedge.**
- **F8.7 Rate limiting & quotas** `[MUST — post-thread → PI-1.5]` — per-key/per-tenant token-bucket limits; `429` + `Retry-After`; **atomic** (single Redis Lua script / `CL.THROTTLE`, PRE-IMPL S7) so bursts can't bypass fraud controls.
  - *Evidence/Value:* abuse/cost protection; prerequisite for public exposure — **not needed for the 9-step demo**, so it lands after the thin thread.

## E9 — Control plane / admin console *(minimal)*
| F | Feature | Pri |
|---|---|---|
| 9.1 | Config: enabled currencies+default, price lists, **provider instances enable/disable** | MUST |
| 9.2 | Inspect tenant / messages / wallet (support) | MUST |
| 9.3 | **Sender-ID approval queue** | MUST |
| 9.4 | **Audited manual wallet adjustment (maker-checker)** | MUST |
| 9.5 | Read-only health / provider quality + DLR-trust view | MUST |
| 9.6 | DSR execution · sub-processor list (from instances) · `data_region` · breach tooling | STRETCH/PI-2 |
*Evidence/Value:* `CONTROL-PLANE-ADMIN.md`. Never in the data-plane hot path.

---

## Recommended iteration sequencing (5 iterations, follows the topological build order)
- **Iter 1 — Foundations:** E1 (tenancy/RLS, outbox, idempotency, audit, observability) + F7.1 PII vault + F2.1/2.2 identity. *(PII vault before any PII table.)*
- **Iter 2 — Money:** E3 wallet/ledger/reserve-commit-refund/sweeper/rating/billingBasis + F3.6 currency config + F2.3 API keys.
- **Iter 3 — Send path:** E5 plugin+adapter+FakeProvider, pipeline, statuses, DLR + F7.2 opt-out + F7.3 sender-ID + F7.4 bodies.
- **Iter 4 — Money-in + Verify:** E4 top-up + E6 Verify (+ Fraud Guard) + F3.7 low-balance + F7.5 DLR-trust basic.
- **Iter 5 — Surfaces + harden:** E8 (versioning, idempotency, errors, webhooks, test mode, TS SDK, docs) + E9 admin console + PI System Demo + invariant load test.
- **IP iteration:** hardening, the demo, stretch items.

> **Post-thin-thread (MUST in PI-1 but slip-first → PI-1.5, not on the 9-step demo path):** F8.7 (rate limiting), F1.6 (platform notifications), F6.4-full (Verify success-based *billing*; the PI-1 seam still lands). These are committed but ship after the thin thread walks end-to-end. See `PI-1/README.md` "Scope realism".

## Out of scope for PI 1 (→ PI 2+)
Business dashboard (campaigns/contacts/templates), the **generic** failover/selection engine + payment **plugin framework** (one of each, directly, in PI-1), multi-channel OTP fallback, Lookup/line-type/SIM-swap risk, CLI + multi-language SDKs, auto-recharge/spend caps, DSR-by-API, sub-processor notifications, Messaging-Service sender pools, white-label/reseller, ISO/SOC certification, omnichannel (WhatsApp/RCS/voice/email).

## Open decisions still gating start
Launch market + **first SMS + payment vendor**; launch **hosting region** (NDPA/CBN); **DPO/Supervisor**; control-plane §16 (staff IdP shape, maker-checker scope, impersonation).

---

## Sources (PI-1 research)
**DX/API:** Stripe keys/idempotency/webhooks/versioning/errors/CLI (docs.stripe.com), Twilio API keys/test-credentials/webhooks-security/errors (twilio.com/docs), Africa's Talking & Termii developer docs.
**Wallet/billing:** Twilio billing/recharge/UsageRecords/UsageTriggers/failed-message-fees (help.twilio.com, twilio.com/docs), Termii terms, Africa's Talking billing, Paystack & Flutterwave accept-payments/webhooks, Hubtel top-up, Modern Treasury ledger journals (moderntreasury.com).
**SMS/Verify/compliance:** Twilio Messaging/statuses/StatusCallback/Verify/Fraud-Guard/Advanced-Opt-Out/Lookup, Vonage Verify, Termii Token/DND, Africa's Talking sender-IDs, NCC 2442 DND, fake-DLR (Testelium/CM.com).
**Identity/compliance (prior):** WorkOS AuthKit; Twilio/Infobip/Bird/Vonage DPAs, sub-processors, residency, certs; Ghana DPA 2012; Nigeria NDPA 2023.
