# Fabric — Positioning & Why Customers Choose Us

> **Date:** 2026-07-05 · **Owner:** Product (fifi) · **Status:** strategy — the "why", honestly
> Companion to [`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md). Written because the current product does **not** yet make the value obvious — this names the value and the gap.

## One line
**Fabric is the money-messages-identity backbone for African businesses** — one platform where verifying a user, charging them, and messaging them are a single, reconciled, auditable transaction.

## The problem we remove
A Ghanaian/Nigerian fintech, e-commerce, or logistics operator that transacts with customers today stitches **three vendors**:
- **Termii / WorkOS** — verify the user (OTP).
- **Paystack / MTN MoMo** — charge or pay out.
- **Africa's Talking / Hubtel** — notify (SMS/WhatsApp/USSD).

Result: three bills, three reconciliations, three compliance surfaces (NCC sender-ID, DND, DPO), and **no unified audit trail** tying "who was verified → what they were charged → what we told them." When money and messages disagree, nobody can prove what happened.

## The wedge — the seam nobody owns
Every incumbent owns one slice; **none owns the connection between them:**

| Player | Messaging | African payments | Identity/Verify | Ledgered as one txn |
|---|---|---|---|---|
| Africa's Talking / Hubtel | ✅ | ✅ | partial | ❌ |
| Twilio / Infobip | ✅ | ❌ | ✅ (Verify) | ❌ |
| Termii | ✅ | ❌ | ✅ | ❌ |
| **Fabric** | ✅ | ✅ | ✅ | **✅ (double-entry, audited)** |

Fabric's defensible idea: **messaging × payments × identity, joined by a double-entry ledger and a shared identity graph, Africa-native (USSD, mobile-money, NCC/DND compliance).** A competitor can add a channel in a week; they cannot cheaply add a *ledgered, identity-linked, locally-compliant* seam across all three — that's the moat.

## Who we win first (beachhead ICP)
Not "everyone who sends SMS." Target businesses that **already do all three** and feel the 3-vendor pain daily:
- **Ghana + Nigeria fintechs, e-commerce, and on-demand/logistics** running: OTP login/checkout → mobile-money charge → transactional notification.
- 10–200 staff, developer-led, cost- and reconciliation-sensitive, must satisfy NCC/DND to deliver at all.

## Honest current state (why you don't see it yet)
- **Real today:** SMS send + delivery, double-entry wallet/ledger, WorkOS SSO/identity, admin control-plane.
- **Mock / planned:** WhatsApp/USSD/Voice, campaigns, Verify product, compliance engine (sender-ID/DND), payments top-up, all analytics.

So the shipped product reads as *"a cleaner Africa's Talking with less."* The differentiator — the ledgered cross-product transaction — is exactly the part still on slides (PI-5 **E16**). **We built the edges, not the seam.** Until one flow proves the seam, the value is invisible. That's the whole problem, stated plainly.

## The proof — one lighthouse flow
Make **one** thing real end-to-end that no competitor can demo:
> **Authenticate a user → debit their wallet via mobile-money/Paystack → send a confirmation SMS/WhatsApp — recorded as a single, reconciled, audited transaction under one correlation id.**

Spec: [`PI-5/LIGHTHOUSE-FLOW.md`](./PI-5/LIGHTHOUSE-FLOW.md). This is the "oh, *that's* why" moment.

## What must be true to win
1. The lighthouse flow works end-to-end and is **provable** (one audit record, balanced ledger).
2. **We deliver in Nigeria** (registered sender-ID + DND compliance) — table-stakes to even send.
3. Channel breadth (WhatsApp/USSD) closes the "under-featured vs AT" gap so we don't lose on the checklist.
4. Pricing is transparent and local-currency (exact-cost wallet is already a strength).

## Non-goals (for now)
- Being a full Twilio-scale global CPaaS. Win Africa's transactional seam first.
- Self-serve signup / mass PLG — onboarding is ops-provisioned (compliance-gated).
- Marketing-campaign tooling as the headline — it's parity, not the wedge.

## Kill-criteria (honesty check)
If, after the lighthouse flow ships, target customers still say "I'd just use AT + Paystack + Termii" — the seam isn't valuable enough and we re-think. Test the thesis with the flow, not more features.
