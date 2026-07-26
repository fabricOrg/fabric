# ADR-0010 Phase 2 — token subsystem: wallet + security review

Status: **DRAFT for human sign-off.** This is the review the ADR gates Phase 2 on
("A wallet + security review of the token subsystem and deferred-revenue accounting before /
alongside implementation — it is money-adjacent"). **No token code ships until this is accepted.**

Author: engineering (Opus). Grounded in the live money system:
`packages/wallet/src/wallet-service.ts`, `packages/db/src/schema/wallet.ts`,
`services/api/src/payments/{payments.service,paystack-webhook.controller}.ts`. Phase 1 (price books)
is the resolution layer this builds on (`services/api/src/pricing/pricing.service.ts`).

---

## 1. What Phase 2 must build (from ADR §Decision 1–9, Follow-up)

- Count-based **per-channel token counters**, bought as a fixed one-off quantity, **no wallet**
  (decision #1). An account may hold subscription wallet **and** tokens (#1).
- Tokens are **logical entitlements** honoured by elastic supply, not a reserved pool (#2).
- A token purchase **locks** the token book's unit price into the counter; later rate edits never
  touch bought tokens (#3).
- Send path: price book → **tokens-first** (hold on send, commit on delivery, return on failure,
  reusing the reservation sweeper) → else **wallet money** → else reject (#8).
- The token subsystem **mirrors the money ledger's guarantees in count space** (#9): append-only,
  idempotent lots/holds/consumption, failure-return through the same sweeper.
- **Deferred revenue**: recognized as tokens are consumed; paid-for-but-unsent is deferred (#9).
  **Unused tokens NON-refundable** (Follow-up, resolved 2026-07-24).
- Purchase **reuses the Paystack flow** like a top-up but grants a counter, not money (#9).

---

## 2. Core recommendation — keep money in ONE ledger; add a count layer beside it

The tempting design is a fully parallel "double-entry in count space." That duplicates the ledger's
hardest parts (balance projection trigger, invariant CI check, B6 backstop) for a quantity that is
**not money**. Cleaner and safer:

**Two coupled layers, each doing one job.**

1. **Count layer (new tables).** Tracks *entitlement quantity* only — how many sends the account owns
   per (channel, currency-of-locked-price). Append-only lots + holds + consumption rows, a cached
   `remaining` projection maintained write-time (mirror `ledger_apply_entry`), FOR UPDATE on the lot
   to gate over-consumption. **No money in these tables.**

2. **Money layer (existing ledger, extended).** A token purchase and its consumption are still money
   events for *revenue recognition* — route them through the existing double-entry ledger so there is
   exactly one source of financial truth:
   - **Purchase** (Paystack cleared): `debit gateway_clearing / credit token_deferred_revenue`
     — cash received becomes a **liability** (we owe N sends), not revenue yet.
   - **Consumption** (send committed on delivery): `debit token_deferred_revenue / credit revenue`
     at the lot's **locked** unit price — recognize revenue as the send clears.
   - **Breakage** (a lot expires unused, if expiry is ever enabled; or written off):
     `debit token_deferred_revenue / credit revenue` (or a `breakage_revenue` kind) — forfeiture is
     recognized when it becomes certain. Non-refundable means there is never a
     `token_deferred_revenue → customer` path.

This needs **one new `ledger_account_kind`: `token_deferred_revenue`** (a per-(tenant,currency)
liability contra), plus token-specific `ledger_reason` values (`token_purchase`, `token_consume`,
`token_breakage`) added to the existing enum (append-only — never drop the sms_*/message_* values,
same rule as SDK-007). The count layer references the money txn so the two reconcile.

**Why this is the safe call:** the count layer can never move money (structurally — no money columns),
so a bug there caps entitlement wrong but **cannot mint or lose cash**; the money layer keeps its
single append-only invariant, CI check, and B6 backstop unchanged. Revenue recognition is provably
tied to consumption because the recognition leg and the consumption row are written in the **same
tenant transaction**.

---

## 3. Proposed count-layer schema (for review — not final)

All tenant-scoped (carry `tenant_id` → RLS applies), all append-only, money-free.

- **`token_lots`** — one purchased batch. `(id, tenant_id, channel, currency, quantity_total,
  unit_price_minor_locked, purchase_payment_ref, purchase_txn_id → ledger_transactions,
  expires_at NULL, created_at)`. `remaining` is NOT stored here (derived/projected — see counters).
  `quantity_total > 0` CHECK; `unit_price_minor_locked > 0` CHECK (mirrors the price-book DB floor).
- **`token_holds`** — a send's in-flight claim (mirror `reserve`). `(id, tenant_id, lot_id, channel,
  quantity=1 typically, reference_id=deliveryId, idempotency_key, status pending|committed|returned,
  created_at)`. `UNIQUE(tenant_id, idempotency_key)` (mirror `uniq_ledger_txn_idempotency`).
- **`token_counters`** *(cached projection, optional)* — `(tenant_id, channel)` → `available`,
  maintained write-time by a trigger over lots/holds/consumption so the send path reads one row
  FOR UPDATE instead of aggregating. Mirrors `balance_minor`. A CI invariant asserts
  `available == Σ lot.quantity_total − Σ committed/pending holds` per (tenant, channel).
- **Commit-XOR-return backstop** — partial unique index: at most one terminal (committed|returned)
  hold per `reference_id` (mirror `uniq_ledger_txn_resolution_per_message`, B6). Closes the
  concurrent DLR-commit + sweeper-return race that would otherwise double-count.

**Consumption order across lots** (open decision, see §6): recommend **expiry-soonest, then
oldest-first (FIFO)** — burns the breakage-prone lot first, and the recognized revenue leg uses that
lot's locked price. Deterministic so preview == send.

---

## 4. Send-path integration (decision #8)

Extend the existing `SmsService.send` / managed accept choke point, AFTER price-book resolution
(Phase 1, already shipped) and BEFORE the wallet `reserve`:

```
rates = pricing.resolveRates(tenantId)          // Phase 1 — done
cost  = rate for (channel, currency)            // Phase 1 — done
if tokens.tryHold(tenantId, channel, reference): // NEW: hold 1 token, FOR UPDATE the counter
    proceed on the token path                    // commit-on-delivery / return-on-failure via sweeper
else if wallet.reserve(...):                     // existing money path, unchanged
    proceed on the wallet path
else:
    reject insufficient_tokens_or_funds (402)    // structured, fail-closed
```

Invariants the build must hold:
- **One resolution per message.** A message is EITHER token-backed OR wallet-backed, never both —
  the delivery/attempt row records which, and commit/return targets that layer only. The sweeper must
  branch on it (a token-held message returns to the counter, not the wallet).
- **Reuse the sweeper.** The reservation sweeper already resolves stuck messages; add token
  hold-return alongside money-refund, keyed by the same `reference_id = deliveryId` idempotency.
- **Fail closed.** No token and no funds → reject. A token-only account has no wallet → tokens-or-
  reject (#8). This is the money redline: unlike the price *resolution* (fails open, Phase 1), the
  *entitlement* check fails closed.

---

## 5. Purchase flow (decision #9) — reuse Paystack, grant a counter

Mirror `PaymentsService.initiate` → `handleWebhook`:

1. **Initiate** stores a **pending token-purchase intent** carrying the tier: `(reference=token-{uuid},
   tenant_id, channel, quantity, unit_price_minor_locked, currency, amount_minor = quantity ×
   unit_price, status pending)`. `amount_minor` is what Paystack charges.
2. **Webhook** (signature-verified over raw body, as today):
   - Reconcile `event.amountMinor`/`currency` against the **stored intent** — the existing
     anti-tamper check. **Critical for tokens:** the granted quantity/price come from the STORED
     intent, never from the webhook payload, so a forged webhook cannot inflate the grant.
   - In one tenant tx: insert the `token_lot` (idempotent on the reference → replay grants once,
     mirror `credit`'s `idempotencyKey = reference`), post the money leg
     `debit gateway_clearing / credit token_deferred_revenue`, emit a `tokens.purchased` outbox event
     only when the grant actually happened this call (mirror the `!credited.replayed` guard).
3. **Non-refundable** → there is no counter-decrement-to-cash path. Simplifies everything.

---

## 6. Open questions the build MUST resolve (need a decision before/at build)

1. **Currency of a token.** Consumption moves no money, so currency is a **revenue-recognition
   attribute of the lot** (which revenue/deferred account the recognition posts to), not a spend
   axis. Confirm: a token lot is bought in one currency and its recognition posts in that currency;
   a single account could hold GHS-priced and USD-priced lots for the same channel. Recommend: **yes,
   currency is a lot attribute; consumption order is per (channel) but recognition follows the
   consumed lot's currency.**
2. **Cross-lot consumption order** (§3) — FIFO-by-expiry-then-age vs strict FIFO. Drives which locked
   price is recognized. Recommend expiry-soonest-first.
3. **Counter granularity** — per (channel) or per (channel, currency)? If a hold must pick a lot, the
   counter that gates over-consumption is per-channel but the lot selection resolves currency. Needs
   nailing so the FOR UPDATE target is unambiguous.
4. **Deferred-revenue reporting** — does finance need a per-lot deferred-revenue balance, or is the
   `token_deferred_revenue` ledger account (per tenant,currency) sufficient? The ledger account gives
   the aggregate; per-lot needs the count layer joined to locked price. Recommend: ledger account for
   the financial number, count layer for the operational per-lot view.
5. **Breakage trigger** — with no expiry by default (#7), deferred revenue for never-sent tokens sits
   as a liability **indefinitely**. Confirm that is acceptable (it is honest — we still owe the sends),
   or define a breakage horizon. This is a finance/GTM call, not engineering.
6. **Auto price-book upgrade interaction (Phase 4)** — a spend-based upgrade changes the *wallet* rate
   book; token lots are price-locked and unaffected. Confirm loyalty spend counts token consumption
   too, or wallet spend only.

---

## 7. Security review

| Concern | Posture | Mechanism |
|---|---|---|
| Who can grant tokens | Only a signature-verified Paystack webhook | HMAC-SHA512 over raw body (existing); grant quantity/price from the **stored intent**, never the payload |
| Client-inflated grant | Blocked | Intent written server-side at initiate; webhook reconciles amount/currency; quantity never client-supplied |
| Replay (callback + webhook both fire) | Grant once | Idempotent on `reference` (mirror `credit`); `UNIQUE(tenant_id, idempotency_key)` at the DB |
| Over-consumption / negative counter | Blocked | FOR UPDATE the counter row + reject below the held quantity (mirror `reserve`'s overdraw check) |
| Double-settle (commit + return race) | Blocked | Commit-XOR-return partial unique index per `reference_id` (mirror B6) |
| Cross-tenant token spend | Blocked | All token tables tenant-scoped → RLS; consumption runs inside `withTenant` |
| Price-lock integrity | Held | `unit_price_minor_locked` copied into the lot at purchase; resolver rate edits touch price books only, never lots |
| Send with no entitlement | Fail closed | tokens-first hold fails → wallet → reject 402; no fail-open on entitlement (only price *resolution* fails open) |
| Tampered/forfeited refund | N/A by policy | Non-refundable → no counter→cash path exists to attack |
| Admin token-tier config | Staff-gated + audited | Same pattern as Phase 1 price books (`staff:write` + trusted origin + audit) |
| Buy-tokens (customer) | Role-gated + audited | Dashboard owner/admin only; `platform.payments` kill-switch gates it |

**No new redline is crossed by building this against fakes** — live payments/SMS/email stay
human-gated exactly as today. Token *purchase* uses `sk_test_` Paystack until a human flips live.

---

## 8. Verdict / recommendation

The design is **sound and buildable on the existing money spine** with the money-in-one-ledger
approach (§2), which is materially safer than a parallel count-space double-entry. The six open
questions (§6) are mostly finance/product decisions, not blockers to schema work, **except #3
(counter granularity)** which the schema depends on directly.

**Recommended gate:** product owner + a human money reviewer sign off on §2 (one-ledger recognition),
§6.1–6.3 (currency/order/granularity), and §6.5 (indefinite deferred-revenue liability). On sign-off,
Phase 2 decomposes like SDK-007 / Phase 1: (2a) count schema + migration + purchase-grant idempotency;
(2b) send-path tokens-first hold/commit/return + sweeper branch; (2c) deferred-revenue ledger legs +
CI invariant; (2d) dashboard buy-tokens/balance (Phase 3). Each slice real-Postgres tested +
independently reviewed before the next.
