# Fabric — Positioning & Why Customers Choose Us (v2)

> **Date:** 2026-07-10 · **Owner:** Product · **Status:** strategy — verification-led, payments-independent
> Supersedes v1 (2026-07-05, the payments-seam thesis) — v1 is preserved as **Appendix: Option B**
> and reactivates if payments ships. Companions: [`COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md),
> [`decisions/0002-self-serve-sandbox-onboarding.md`](./decisions/0002-self-serve-sandbox-onboarding.md),
> [`PI-4/REPOSITIONING-PROPOSAL.md`](./PI-4/REPOSITIONING-PROPOSAL.md).

## One line

**Fabric delivers the messages that move money** — OTP/verification and transactional SMS for
Ghana and Nigeria businesses, with compliance-grade deliverability and billing you can audit to
the pesewa.

## The stance

We **enter through the SMS market but never compete on SMS**. SMS is the commodity floor — it
must work and be priced sanely, and it is never the pitch. The pitch is three layers on top,
ranked by how hard they are for an incumbent to copy:

1. **Verify as the product.** One OTP/verification API, billed per verification. Termii proved
   the category in Nigeria (Paystack is their reference customer); **Ghana has no
   verification-led player** — Hubtel is commerce-first, Arkesel/mNotify are bulk-first. Verify
   is the first thing a developer integrates and the last thing they rip out: highest switching
   cost, best margin.
2. **Deliverability as the promise.** Sender-ID registration and DND/consent tooling built into
   the product. In Nigeria this is binary — an unregistered sender ID means the message is
   rejected by the carrier. "Your OTP arrives, provably, in NG + GH."
3. **Auditable spend as the trust wedge.** The double-entry ledger, reframed: not a payments
   rail but **audit-grade billing**. Every message is a balanced ledger entry; customers get a
   reconcilable statement, not a vanishing credit counter. No regional competitor offers this,
   and copying it is an architectural rebuild for them.

**Copyability test** for every roadmap item: *could Arkesel ship it in a month?* Yes → parity
work, spend the minimum. No (compliance engine, double-entry billing, Verify on our own
identity graph) → moat, invest there.

## The problem we remove

A Ghana/Nigeria fintech, lender, or e-commerce operator lives or dies on transactional
messages: an OTP that doesn't arrive is a lost login, checkout, or disbursement. Today they
get: opaque deliverability (no per-carrier visibility, silent NCC/DND filtering), opaque
billing (credits deducted against messages nobody can reconcile), and compliance they must
figure out alone (sender-ID registration, DND classes, quiet hours). Fabric makes the message
arrive, proves it arrived, and proves what it cost.

## Who we win first (beachhead ICP)

Not "everyone who sends SMS." **Ghana-first (Nigeria second) fintechs, lenders, e-commerce and
logistics** — developer-led, 10–200 staff, revenue-critical OTP + transactional traffic. Buyer
is the engineering lead; the finance team becomes the internal champion (auditable
statements). Reached via self-serve sandbox (ADR-0002): sign up → first OTP on your own phone
in under ten minutes → go-live after the compliance gate.

## The competitive map (why this hole exists)

| Segment | Owner | Why we don't fight there |
|---|---|---|
| Bulk/campaign SMS (GH) | mNotify, Arkesel, Wigal | Price war, race to the bottom |
| Channel-breadth CPaaS | Africa's Talking | Can't out-channel them soon; don't try |
| Verification-led (NG) | Termii | Entrenched; we meet them later |
| **Verification-led (GH)** | **nobody** | **This is the entry** |

## Honest current state

- **Real today:** SMS send + delivery, double-entry wallet/ledger, WorkOS identity, admin
  control plane, dev portal.
- **On paper:** Verify as a product (E6 exists, not productized), sender-ID/DND engine
  (partial), per-carrier delivery observability (shallow), self-serve onboarding (ADR-0002,
  not built), statement export (not built).

Until those surfaces ship, Fabric reads as "another SMS sender" regardless of this document.
The edge ships when the golden path ships.

## The proof — golden path lighthouse

One demoable flow that no regional competitor can match end-to-end:

> **A stranger signs up (self-serve) → integrates Verify → first OTP delivered to a real phone
> in under 10 minutes → watches per-carrier delivery status → downloads a reconcilable,
> balanced billing statement.**

This replaces the payments-seam lighthouse (old E16) as the activation moment and the demo.

## What must be true to win

1. Golden path works end-to-end and is instrumented (time-to-first-OTP is a tracked metric).
2. We deliver in Nigeria: registered sender IDs + DND/consent handling — table stakes to send.
3. Ghana NCA compliance confirmed (open research gap, C-6).
4. Verify pricing is transparent, local-currency, per-verification.

## Non-goals (for now)

- Payments as a product dependency — wallet top-up exists for billing; the payments **product**
  may never land, and nothing above requires it (see Appendix: Option B).
- Channel breadth as CPaaS parity — WhatsApp/voice arrive later as **Verify fallback
  channels**, not as headline channels.
- Marketing/campaign tooling as the headline — parity at most.
- Global Twilio-scale ambitions — win the West-African transactional seam first.

## Kill-criteria (honesty check)

If Ghana fintechs, shown the working golden path, still say **"I'd just use Arkesel — it's
cheaper"**, the verification-led wedge fails and Fabric is in commodity SMS: rethink the
venture, don't add features.

---

## Appendix: Option B — the payments seam (v1 thesis, dormant)

Preserved from v1 (2026-07-05). **Reactivates only if the payments product ships.**

The thesis: Fabric as the money-messages-identity backbone — verifying a user, charging them,
and messaging them as a single, reconciled, auditable transaction under one correlation id
(old lighthouse: `PI-5/LIGHTHOUSE-FLOW.md`, E16). The wedge table showed every incumbent owns
one slice (AT/Hubtel messaging+payments, Twilio/Termii messaging+verify) and none owns the
**ledgered, identity-linked seam** across all three.

Nothing in v2 forecloses this: the double-entry ledger and identity graph stay core
infrastructure, so if payments lands, Option B becomes the expansion story on top of the
verification beachhead — a stronger sequence than betting the launch on it.
