# Lighthouse Flow — Verify → Charge → Notify as one ledgered transaction

> **Date:** 2026-07-05 · **Owner:** Product (fifi) · **Epic:** E16-S1 · **Status:** spec → build
> The proof of Fabric's thesis ([`../POSITIONING.md`](../POSITIONING.md)): the one demo no competitor can match — a verification, a payment, and a notification stitched into a **single, reconciled, auditable transaction** under one correlation id.

## Goal
Let a business run, through **one Fabric call/flow**, this sequence for one of *their* customers:
1. **Verify** the customer (OTP) → identity assured.
2. **Charge** — collect a payment from the customer (Paystack / mobile-money) → posted to the **double-entry ledger** (exact minor units).
3. **Notify** — send a confirmation (SMS/WhatsApp).

…and produce **one transaction record** that ties the verification, the ledger entries, and the message, with a balanced ledger and an immutable audit entry. "Prove what happened" = one query.

## Non-goals
- Cross-service ACID (verify/charge/notify span external systems — this is a **saga**, not a DB transaction).
- New payment rails beyond the E4 Paystack integration.
- General workflow engine — this is one opinionated, high-value flow.

## User story
**As** a fintech/e-commerce operator, **I want** to verify, charge, and notify a customer as one audited operation, **so that** money and messages never disagree and I run one vendor instead of three.

### Acceptance criteria
- **AC1** Given a customer msisdn + amount, when I run the flow, then an OTP is sent and, on correct code, the flow proceeds; on wrong/expired code it stops before any charge.
- **AC2** Given verification passed, when the charge succeeds, then the ledger posts a **balanced** double-entry (customer collection → tenant wallet) in **exact bigint minor units**, and a confirmation message is sent.
- **AC3** Given any step, then a single **transaction record** (one `correlation_id`) shows each step's status + refs (verification id, ledger entry ids, message id) + timestamps, and an **immutable audit entry** is written.
- **AC4** Given the charge succeeds but notify fails, then money stays moved, the record shows `notify: failed`, and notify is **retryable** (no silent divergence).
- **AC5** Given the charge fails, then no money moved and no confirmation is sent; the record shows `charge: failed`.

## The transaction (sequence)
```
correlation_id = corr_… (one id threads the whole flow)

1. VERIFY   → Verify API (E6): send OTP (SMS/voice/WhatsApp) → customer submits code → verified
                fail → STOP (record: verify=failed). No charge.
2. CHARGE   → Payments (E4, Paystack/MoMo): collect `amount` from customer
                on success → LEDGER (E3) posts balanced double-entry:
                   Dr  payment-clearing/collection      amount
                   Cr  tenant wallet (available)         amount
                fail → STOP + compensate nothing (record: charge=failed).
3. NOTIFY   → SMS/WhatsApp (E5): confirmation to customer
                fail → record: notify=failed, mark retryable (money already moved).

Every step appends to the transaction record + one audit entry (actor=tenant, correlation_id,
verification_id, ledger_entry_ids, message_id, amounts, statuses, timestamps).
```

## Ledger model (the differentiator)
The charge is not a number in a log — it's a **balanced double-entry posting** (reusing PI-1 E3's write-time-enforced ledger), amounts as exact bigint minor units, currency GHS/NGN. The transaction record links the ledger entry ids, so the collection is provable + reconciled against the message and the verification. **This tie is what AT/Twilio/Termii cannot produce.**

## Failure / saga semantics
- **Forward-only after charge:** once money moves, we never "undo" by deleting ledger entries — a reversal is its own balanced posting. MVP: charge is last-but-one; if notify fails, record + retry (money stands).
- **Stop-before-charge:** verify failure costs nothing.
- **Idempotency:** the flow is keyed by `correlation_id`; re-submitting the same id never double-charges.

## API shape (conceptual — not final)
Two viable shapes; MVP uses **(a)**:
- **(a) BFF-orchestrated:** dashboard/BFF calls the existing primitives — Verify → Charge (wallet/Paystack) → Send — passing a shared `correlation_id`; a new **`transactions` read model** aggregates them; a dashboard **"Transaction" detail** view renders the unified, reconciled, audited record.
- **(b) First-class endpoint:** `POST /v1/flows/verify-charge-notify` in the API runs the saga server-side (better idempotency/atomic audit) — the PI-5 hardening of (a).

Contracts: `flowRunRequest { correlationId, msisdn, amount: Money, channel, template }` → `flowRunResponse { correlationId, verify, charge (ledgerEntryIds), notify (messageId), status }`.

## Real today vs to-build
| Piece | State | Epic |
|---|---|---|
| OTP / Verify | backend exists (OTP engine); Verify product UI is mock | E6 / E15 |
| Double-entry ledger + wallet | **real** (write-time enforced, exact bigint) | E3 |
| Payment collection (Paystack/MoMo) | integration planned; wallet debit is real | E4 |
| SMS send | **real** (FakeProvider); WhatsApp mock | E5 / E11 |
| **Flow orchestration + `transactions` read model + Transaction view** | **new — the actual build** | **E16-S1** |

**MVP path (demoable fast, no external writes):** orchestrate with the **real ledger + real SMS (FakeProvider) + OTP**, funding via the existing wallet — proving the *seam + audit* end-to-end locally. Then swap in real Paystack collection + WhatsApp.

## Redlines (external / gated)
Real Paystack/MoMo collection (money movement), real SMS to real numbers, real OTP delivery — all **human-gated**, run against staging/sandbox (`sk_test_`, FakeProvider) until a human approves live. The MVP uses sandbox/fake providers, so it's safe to build + demo.

## Demo script (the "oh, that's why")
1. Operator triggers the flow for a test customer + amount.
2. OTP delivered → code entered → verified.
3. Charge posts → **show the balanced ledger entries update** (exact minor units).
4. Confirmation SMS shown delivered.
5. Open the **Transaction record** → one screen: verification ✓, ledger entries (balanced) ✓, message delivered ✓, one correlation id, one audit row. "Three vendors' worth of truth, in one reconciled record."

## Milestones
1. `transactions` read model + correlation-id threading across the existing primitives.
2. Dashboard **Transaction** detail view (the proof screen).
3. MVP orchestration (Verify + wallet charge + FakeProvider SMS) — local, no external writes.
4. Swap in real Paystack collection + WhatsApp (gated staging).
5. First-class `POST /v1/flows/verify-charge-notify` (saga hardening + idempotency).
