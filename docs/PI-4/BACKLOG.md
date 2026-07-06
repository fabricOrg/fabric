# PI-4 Backlog — Channel Breadth · Observability · Compliance UI

> **Date:** 2026-07-04 · **Owner:** Product (fifi) · **Theme:** "Stop being SMS-only."
> Groomed from [`../COMPETITIVE-ANALYSIS.md`](../COMPETITIVE-ANALYSIS.md) + [`../DASHBOARD-UX-REFERENCE.md`](../DASHBOARD-UX-REFERENCE.md). Every story traces to a research finding + competitor precedent.
> **Mode:** frontend-first / mock-first — UI + BFF stubs ship now (`TODO(BFF)`), backend catches up. Redline-gated items (real send/pay/deploy) marked ⛔.
> Size: **S** ≤1d · **M** ~2–3d · **L** ~1wk+. Priority: **P0** blocks credible launch · **P1** parity · **P2** edge.

---

## Epic E10 — Sender-ID & Compliance (P0, the delivery gate)

> Why now: Nigeria NCC rejects unregistered sender IDs at the operator; DND/consent is legally required. Without this, messages don't deliver. (COMP-ANALYSIS C-1/C-2/C-3.)

### E10-S1 — View & manage sender IDs — **P0 · M**
As a **tenant admin**, I want to see all my sender IDs and their registration status so that I know which are safe to send from.
- **AC1** Given I open Senders, when the page loads, then I see each sender ID with status (active/pending/rejected), country (NG/GH), type (alphanumeric/short-code), use-case, and submitted date.
- **AC2** Given a rejected sender ID, when I view it, then the rejection reason is shown.
- **AC3** Given I filter by status or country, then the table updates client-side.
- **AC4** Alphanumeric sender IDs display an 11-char constraint.
- Precedent: Twilio "Numbers & Senders" hub `3-0`; NCC mandate `3-0`. Status: **built (mock)** this PI.

### E10-S2 — Request sender-ID registration — **P0 · M**
As a **tenant admin**, I want to submit a new sender ID for registration so that I can send under my brand.
- **AC1** Dialog captures sender ID, country, type, use-case; validates alphanumeric ≤11 chars with inline errors.
- **AC2** On submit the sender appears as `pending` (optimistic) with a success toast.
- **AC3** ⛔ Real submission to carrier/NCC is redline-gated — mock now, `TODO(BFF)`.
- Precedent: NCC registration flow (1–5 business days, CAC/NIN/sample messages) `3-0`.

### E10-S3 — Consent & DND opt-out engine — **P0 · L**
As a **compliance owner**, I want promotional traffic to respect opt-outs and quiet hours while transactional/OTP always delivers, so that we stay legal in Nigeria.
- **AC1** Screen shows classification rules: promotional = DND-filtered + quiet-hours-enforced; transactional = bypasses both.
- **AC2** I can view/search the opt-out list (MSISDN, scope all/promotional, source STOP-reply/2442-registry/manual, date).
- **AC3** I can add/remove a manual opt-out (with confirm).
- **AC4** I can configure promotional quiet hours (start/end/timezone, enable toggle); default 20:00–08:00 WAT.
- **AC5** ⛔ Actual send-time enforcement is backend — UI + rules now, `TODO(BFF)`.
- Precedent: NCC 2442 DND registry, 08:00–20:00 WAT promo window `3-0`. Status: **built (mock)** this PI.

---

## Epic E11 — Channel Breadth (P0/P1 — the "not SMS-only" theme)

> Why: African incumbents (Africa's Talking, Arkesel) ship 5–6 channels; SMS-only is under-featured day one. (COMP-ANALYSIS A-1, C-4.)

### E11-S1 — WhatsApp Business channel surface — **P1 · L**
As a **tenant**, I want to send WhatsApp messages (templates + session) so that I reach the ~dominant OTT channel.
- **AC1** Compose supports a WhatsApp channel with template selection + variables.
- **AC2** Channel picker on Send routes SMS vs WhatsApp; cost shown per channel (exact minor units).
- **AC3** ⛔ Real WABA send redline-gated; mock now.
- Precedent: Infobip/Bird native WhatsApp; WhatsApp dominance in NG.

### E11-S2 — Voice channel surface — **P2 · M**
As a **tenant**, I want voice/OTP-call fallback so that verification succeeds when SMS fails. Precedent: AT/Arkesel voice.

### E11-S3 — USSD session builder — **P1 · L**
As a **tenant**, I want to build USSD menu flows so that I reach feature-phone users with no internet.
- **AC1** Visual menu-node builder (prompt → options → next node); preview of the session.
- **AC2** Shortcode assignment display.
- Precedent: Africa's Talking USSD `3-0`; eNaira feature-phone inclusion lesson `3-0`.

### E11-S4 — Channel failover / smart routing config — **P1 · M**
As a **tenant**, I want a channel to fall back (e.g. WhatsApp→SMS) so that delivery is resilient. Precedent: Infobip RCS→SMS failover `3-0`.

---

## Epic E12 — Observability & Analytics (P0/P1)

> Why: Twilio Messaging Insights = six tabbed dashboards + multi-dim filtering; a flat log is under-featured. (UX-REF S-5/S-6, COMP-ANALYSIS A-3.)

### E12-S1 — Tabbed observability on Messages — **P0 · M**
As a **tenant**, I want message analytics separate from the raw log so that I can diagnose delivery at a glance.
- **AC1** Messages screen has Log + Insights tabs; Log preserves the existing real-BFF table + delivery-timeline drawer.
- **AC2** Insights shows total sent, delivery rate %, failed, avg segments.
- **AC3** A Delivery & Errors breakdown lists error codes by frequency with description + doc-hint.
- Precedent: Twilio six-dashboard Insights `3-0`. Status: **built (mock)** this PI.

### E12-S2 — Multi-dimensional log filtering — **P0 · S**
As a **tenant**, I want to filter the log by status/channel/country/error-code/date so that I can isolate issues.
- Precedent: Twilio verbatim filter set `3-0`. Status: **built (partial)** this PI.

### E12-S3 — Unified at-a-glance Overview — **P1 · M**
As a **tenant**, I want traffic + delivery rate + spend on one home view so that I get the health picture instantly.
- **AC1** Stat tiles: messages sent, delivery rate, spend this month, wallet balance.
- **AC2** Spend-by-channel with proportion bars (exact money, 3:1 contrast both themes).
- **AC3** Recent activity list linking into detail.
- Precedent: Infobip Analyze central dashboard `3-0`. Status: **built (mock)** this PI.

---

## Epic E13 — Dashboard Shell & DX polish (P0/P1)

> Why: Twilio combined nav + workbench; Linear ⌘K/local-first. (UX-REF N-1/N-2/N-3, D-1, Q-2.)

### E13-S1 — ⌘K command palette — **P1 · S**
As a **user**, I want ⌘K to jump anywhere so that navigation is keyboard-first.
- **AC1** ⌘K/Ctrl-K opens a palette searching all nav destinations; Enter navigates; Esc closes; no keyboard trap.
- Precedent: Linear command palette `3-0`. Status: **built** this PI.

### E13-S2 — Module-framed nav + topbar org switcher — **P1 · M**
As a **user in multiple orgs**, I want an account/tenant switcher in the topbar so that I can swap workspaces fast.
- Precedent: Twilio Account Switcher + combined nav `3-0`; Bird Users page `3-0`.

### E13-S3 — Credit-free sandbox / test mode — **P1 · M**
As a **developer**, I want a test mode that simulates sends (incl. delivery callbacks) without spending so that I integrate before paying.
- **AC1** A visible test-mode indicator; test sends use FakeProvider and don't debit real balance.
- Precedent: Arkesel sandbox `2-1`; Twilio Virtual Phone `3-0`. (Do NOT cite Stripe test/live toggle — refuted `0-3`.)

---

## Epic E14 — Developer Portal & Admin polish (P1)

### E14-S1 — Dev workbench (keys + webhooks + logs + alarms) consolidation — **P1 · M** — precedent Twilio workbench `3-0` (keys/logs/webhooks already grouped — add alarms/alerts).
### E14-S2 — Admin one-Users-table (roles + workspace access + status) — **P1 · M** — precedent Bird `3-0`.
### E14-S3 — Keep validated patterns — **P0 · S** — once-only key reveal (Clerk `3-0`), impersonation banner, dev-workbench grouping: regression-guard, don't remove.

---

## Cross-cutting quality (applies to every story)
- **WCAG 2.2 AA**: 4.5:1 text / 3:1 large + **3:1 non-text/chart contrast in BOTH themes**; full keyboard, no traps. `3-0`
- Money = exact bigint minor units (`formatMoney`/`toMoney`), never float.
- Palette A + Clash/Inter/JBM; shadcn for anything it provides; pass `pnpm guard` + biome + typecheck.
- Africa: locale-correct GHS/NGN/USD; plan low-bandwidth; USSD for reach.

---

## ⛔ Redline-gated (need human + backend, NOT in mock scope)
Real SMS/WhatsApp/Voice send · real sender-ID submission to carriers · real payments · production deploy · schema migration on shared DB. UI may be built mock-first; the live wire is a separate gated story.

---

## PI-4 Sprint-1 candidate (one screen)
1. **E10-S1/S2 Sender-ID management** (P0) — delivery gate.
2. **E10-S3 Consent & DND** (P0) — legal gate.
3. **E12-S1/S2 Messages observability tabs + filters** (P0) — diagnosis.
4. **E12-S3 Overview at-a-glance** (P1) — health picture.
5. **E13-S1 ⌘K palette** (P1 · S) — cheap DX win.

_All five are built mock-first in this PI's first cut; backend wiring (`TODO(BFF)`) and the ⛔ live paths follow._
