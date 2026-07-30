# ADR 0010: Pricing and billing model

Status: **accepted 2026-07-24** (product owner). A wallet + security review of the token subsystem
is still required before/alongside implementation — it is money-adjacent. Shaped with the product
owner in session; supersedes nothing but extends the wallet money semantics of
[ADR 0006](./0006-managed-delivery-acceptance-and-execution.md).

Amendment: [ADR 0012](./0012-channel-agnostic-commercial-offers.md) supersedes the assumption that
prepaid commercial offers are SMS-specific or must have a whole-minor-unit price per unit. The
underlying natural-unit, entitlement, deferred-revenue, and tokens-first invariants remain.

## Context

Fabric bills today as pure prepaid pay-as-you-go against a per-`(tenant, currency)` double-entry
money wallet (`packages/wallet`, `db/schema/wallet.ts`): every send `reserve`s cost from the
customer balance and `commit`s on delivery or `refund`s on failure, with a reservation sweeper and
Paystack top-up/auto-topup funding. Per-message cost comes from **hardcoded flat rate constants**
(`packages/domain/src/rating.ts` — GHS 3 / NGN 400 / USD 1 per SMS segment; email a base rate ×
a 1/3/6 size tier). Email has **no real provider** — the send path uses `FakeEmailProvider`
(sandbox only). There is no notion of bundles, credits, subscriptions, tiers, or configurable
pricing anywhere.

The product owner wants two purchase experiences, price differentiation between them to reward
commitment (lock-in), and staff-configurable pricing. Two facts from discovery shape the design:
(1) the SMS vendor **Arkesel** balance can be topped up **on demand** — provider supply is elastic,
not a finite pool; (2) the industry never sells expiring prepaid **email** packs because email's
marginal cost is ~zero (Amazon SES floor ≈ $0.10/1k) — email is sold by subscription/volume, SMS by
consumable credit because every SMS carries a real carrier cost.

## Decision

1. **Two purchase modes over one send path.** *Subscription* = the existing money wallet: fund a
   balance, send any channel pay-as-you-go, auto-topup to refill. *Tokens* = count-based per-channel
   counters, bought as a fixed one-off quantity, **no wallet**. An account may hold either or both.
2. **Tokens are logical entitlements, not a reserved slice of a finite pool.** Because provider
   supply is elastic (top up Arkesel/SES on demand), a token purchase is a promise — "you own N
   sends" — honoured by procuring capacity as needed. No physical capacity-reservation layer is
   built.
3. **Price books (rate plans).** A price book is a named set of per-channel/per-currency unit
   prices. Multiple books exist (e.g. `Token — Retail`, `Subscription — Standard`,
   `Subscription — Loyalty`). Each account is assigned a book (defaulted by mode, upgradeable). The
   wallet PAYG send prices against the account's current book; a token purchase **locks** the token
   book's price into the counter, so later rate changes never touch tokens already bought.
4. **All pricing is control-plane configurable in the admin console** — rate cards, price books, and
   token tiers are staff-editable state read through a short-TTL cache on the send path (the
   kill-switch read-through pattern). On a store read failure the send path **fails open** to
   last-known-good pricing; the **wallet still fails closed** (no funds / no tokens → no send).
5. **Unit basis.** SMS = per **segment** (the existing segment rating; a long SMS consumes multiple
   units). Email = **flat per send** — the 1/3/6 size tier is retired (not cost-justified: at the
   256 KiB cap the real data-cost delta is ≈ GHS 0.0004 while the 6× tier charged GHS 0.25 extra).
   Voice = per unit — **roadmap only; not built** (the DB CHECK limits channels to sms/email).
6. **Strategic pricing / lock-in.** Tokens are priced **above** the subscription rate (a convenience
   premium that nudges one-off buyers toward the sticky wallet). Subscriptions are generous —
   **especially email**, whose ~zero marginal cost makes abundant/cheap included email a near-free
   stickiness lever. v1 lock-in = a cheaper subscription baseline plus **spend-based automatic
   price-book upgrade** (loyalty). Committed-use plans and bonus-credit-on-top-up are deferred.
7. **No token expiry by default.** Elastic supply gives expiry no cost basis; count-based counters
   make adding an optional expiry date trivial later if it is ever wanted purely as a pricing lever
   (mirroring Arkesel's cheaper-if-expiring SMS tier).
8. **Send-path resolution order.** Resolve unit cost from the account's price book → consume
   **tokens first** for the channel (hold on send, commit on delivery, return on failure — mirroring
   the money `reserve`/`commit`/`refund` lifecycle and reusing the reservation sweeper) → else debit
   **wallet money** → else reject with a structured error. Token-only accounts have no wallet, so it
   is tokens-or-reject.
9. **The token subsystem mirrors the money ledger's guarantees in count space.** Purchased lots
   (quantity, locked price, optional expiry), holds, and consumption are append-only and idempotent,
   with failure-return through the same sweeper. Revenue is recognised as tokens are consumed
   (tokens paid-for-but-unsent are deferred revenue). A token purchase reuses the Paystack flow
   (like a top-up) but grants a counter instead of crediting money.
10. **Email provider = Amazon SES** (eu-west-1, pay-as-you-go, Fabric owns deliverability), wired
    behind the existing `FakeEmailProvider` interface. Deliverability is managed **operationally**
    (customer domain auth, cold-sender throttling, no dedicated IP for low-volume senders), never
    priced by message size. Speed-to-prod is explicitly not a priority; margin is, hence SES over
    Resend/Postmark.
11. **Honesty / redlines.** Rate-card defaults sit above real cost floors (SES ≈ $0.10/1k, Arkesel
    ≈ GHS 0.022–0.031/SMS) — no fabricated or below-cost rates. Live SMS, email, and payments stay
    human-gated. Fabric never creates third-party accounts or enters credentials on the user's
    behalf; the SES key is supplied via the secret manager.

## Alternatives rejected

- **Money-backed "bonus credit" bundles for tokens:** simplest (reuses the wallet), but dead on
  arrival — token buyers have no wallet, and money-backed credit cannot be price-locked or expired
  cleanly (money is fungible; expiring part of a balance needs credit-lot tracking).
- **Physical capacity pool with hard per-customer reservations:** matches the owner's first framing,
  but unnecessary given elastic supply and a large build (inventory accounting, isolation,
  oversell protection) protecting against a constraint that does not exist.
- **A single global rate card:** cannot differentiate subscription vs token pricing or drive
  loyalty lock-in — the whole point of price differentiation.
- **Size-tiered email pricing:** not cost-justified; overcharges by ~600× on the size delta at the
  256 KiB cap and matches no industry provider.
- **Expiring prepaid email packs:** no underlying cost to justify expiry; reads as a cash grab; no
  ESP does it.
- **Resend / Postmark as the ESP:** better DX / turnkey deliverability, but 4–9× the unit cost,
  which erodes the email-as-generosity-lever. Rejected because launch speed is not a constraint.

## Consequences

- **Reuses:** double-entry ledger, `reserve`/`commit`/`refund`, the reservation sweeper, Paystack
  top-up + auto-topup, the pure segment rating function, the kill-switch read-through cache, and the
  transactional outbox — all extend rather than change.
- **New:** the token subsystem (lots / holds / consumption + sweeper hook + deferred-revenue
  accounting); the price-book data model, per-account assignment, and resolution; the admin-console
  rate-card / price-book / token-tier config surface; spend-based auto price-book upgrade; the SES
  adapter; dashboard buy-tokens + pricing + token-balance surfaces.
- **Deferred:** voice channel and its pricing; committed-use and bonus-credit lock-in levers; email
  attachments / per-MB data surcharge (the 256 KiB cap and flat per-send stay); token expiry.
- Email flattening changes an existing wire/price behaviour — the size-tier removal must land as a
  deliberate rating change, not a silent one.
- Deferred-revenue accounting for unsent tokens is a new obligation the wallet review must cover,
  including the **unused-token refund policy** (open — see follow-up).

## Follow-up

- Wallet + security review of the token subsystem and deferred-revenue accounting before acceptance.
- ~~Decide the unused-token refund policy.~~ **Resolved (product owner, 2026-07-24): unused tokens
  are NON-refundable for now.** Simplifies revenue recognition (recognized at consumption; the
  unconsumed remainder is a breakage/forfeiture on expiry-or-never) and the counter lifecycle (no
  refund-to-wallet path, which also fits token buyers having no wallet). Revisit if support/GTM
  demands it.
- ~~Confirm the email attachment decision.~~ **Resolved (product owner, 2026-07-24):** keep the
  256 KiB transactional cap + flat per-send; a per-MB data surcharge (SES-style $/GB) is deferred
  until/unless the cap is raised to allow real attachments.
- Phased build sequence (no code until this ADR is accepted):
  1. Rate card + price books: control-plane config, resolution, admin-console UI; wallet PAYG reads
     the account's book; flatten email to per-send. (Replaces the hardcoded `DEFAULT_RATES`.)
  2. Token subsystem: schema, Paystack-backed purchase granting a price-locked counter, tokens-first
     send-path consumption with sweeper failure-return, deferred-revenue accounting.
  3. Dashboard: buy-tokens flow, pricing/plan surface, token-balance display (mirrors the wallet
     page).
  4. Spend-based automatic price-book upgrade (loyalty lock-in).
  5. SES adapter behind `FakeEmailProvider` (separate track; human-gated live go).
  6. Later: voice channel + pricing, committed-use / bonus-credit levers, attachment surcharge.
