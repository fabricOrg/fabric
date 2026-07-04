# PI-5 Backlog — The Bundle Edge (Messaging × Payments × Identity)

> **Date:** 2026-07-04 · **Owner:** Product (fifi) · **Theme:** "Do what pure-messaging rivals can't."
> Groomed from [`../COMPETITIVE-ANALYSIS.md`](../COMPETITIVE-ANALYSIS.md) §B + [`../DASHBOARD-UX-REFERENCE.md`](../DASHBOARD-UX-REFERENCE.md). PI-5 assumes PI-4 (channels, observability, compliance) is landing.
> Size **S/M/L**, Priority **P0/P1/P2**. Redline-gated ⛔. Mock-first where backend lags.

---

## Epic E15 — Verify as a Product (P0/P1)

> Why: Termii & Twilio Verify prove a dedicated multi-channel verification primitive is a real business, and Fabric already has an OTP epic (E6) + identity (E2) to build it on. (COMP-ANALYSIS B-1.)

### E15-S1 — Verify dashboard (channels · conversion · log) — **P1 · M**
As a **tenant**, I want to configure OTP channels with failover and see conversion so that I run reliable verification.
- **AC1** Channel config (SMS/Voice/WhatsApp/Email) with enable + failover order.
- **AC2** Conversion funnel: sent → delivered → verified with headline rate.
- **AC3** Recent verifications log filterable by channel + status.
- **AC4** A test-verification widget (send test code → verify) — mocked.
- Precedent: Termii Verify/Token `3-0`; Twilio Verify one-API-multi-channel `3-0`. Status: **built (mock)** in this buildout.

### E15-S2 — Verify API + once-only key scoping — **P1 · M**
As a **developer**, I want a single Verify API across channels so that I don't integrate each channel separately. ⛔ real send gated. Precedent: Twilio Verify `3-0`.

### E15-S3 — Fraud & number intelligence — **P2 · L**
As a **risk owner**, I want carrier lookup + risky-number scoring + SIM-swap signals on Verify so that I block abuse.
- Precedent: Twilio Fraud Guard / Lookup `3-0`. Rivals lack the identity graph to match this.

---

## Epic E16 — Ledgered cross-product flows (P1 — the actual moat)

> Why: AT/Hubtel bundle comms+payments, but Fabric's double-entry ledger (E3) + WorkOS identity (E2) make the *seam* auditable end-to-end. (COMP-ANALYSIS B-3.)

### E16-S1 — "OTP → authenticate → charge → confirm" as one audited flow — **P1 · L**
As a **platform**, I want a verify+charge+notify sequence recorded as one double-entry-backed, auditable transaction so that reconciliation is trivial and disputes are provable.
- **AC1** A flow view links the verification, the wallet debit (ledger entries), and the confirmation message under one correlation id.
- **AC2** Every money move is exact bigint minor units; the ledger stays balanced.
- **AC3** ⛔ real charge/send gated; mock the orchestration UI first.
- Precedent: none of the pure-messaging rivals can match a ledgered bundle — this is the wedge.

### E16-S2 — Usage → wallet → billing continuity — **P1 · M**
As a **tenant**, I want spend-by-channel folded into wallet/billing so that cost and delivery live together. Precedent: Infobip Analyze expense reporting `3-0`. (Overview at-a-glance in PI-4 is the first cut.)

---

## Epic E17 — Airtime / Value distribution (P1/P2)

### E17-S1 — Airtime/data bulk disbursement UI — **P1 · L**
As a **tenant**, I want to disburse airtime/data via API in local currency so that I run rewards/refunds. ⛔ real disbursement gated. Precedent: Africa's Talking Airtime API `3-0` — global CPaaS lacks it; natural bridge from Fabric's wallet rails.

---

## Epic E18 — Omnichannel & inbox (P2)

### E18-S1 — Unified omnichannel inbox — **P2 · L** — one managed conversation view across SMS/WhatsApp/Voice. Precedent: Infobip unified portal positioning `3-0`.
### E18-S2 — Managed portal vs API-only positioning — **P2 · M** — Infobip's wedge vs Twilio.

---

## Epic E19 — Onboarding & Activation (P1)

> Why: Twilio's guided onboarding + sandbox drove activation (self-reported 62% first-message, 33% faster prod). (COMP-ANALYSIS A-5/A-6, UX-REF.)

### E19-S1 — Guided setup checklist — **P1 · M** — sequenced milestones (verify identity → register sender → fund wallet → first send → monitor), empty-state driven. Precedent: Twilio 4-milestone onboarding `2-1` + SaaS best-practice.
### E19-S2 — Empty/loading/error/notification state system — **P1 · M** — consistent skeletons, actionable empty states, alert hierarchy. [best-practice] (no verified precedent survived — UX-REF coverage gap).

---

## Cross-cutting quality
Same bar as PI-4: WCAG 2.2 AA incl. 3:1 non-text/chart contrast in both themes; exact-money; Palette A + shadcn; `pnpm guard`/biome/typecheck; Africa localization + low-bandwidth.

## ⛔ Redline-gated (human + backend)
Real Verify send · real charge/ledger post to shared DB · real airtime disbursement · production deploy. Build UI mock-first; live wire is a separate gated story.

## Open follow-ups (from research, worth a 3rd pass)
- Ghana NCA sender-ID/residency specifics (research was NG-heavy).
- Current-2026 wholesale pricing (AT/Termii/Hubtel/Arkesel) for competitive pricing.
- African-competitor dashboard specifics (wallet/sender-ID/low-bandwidth) — AT blocked the fetcher.
- Cited precedent for sandbox/test-mode toggle placement (Stripe claim was refuted).
