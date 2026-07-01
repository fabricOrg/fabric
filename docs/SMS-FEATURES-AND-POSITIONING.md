# SMS Platform — Features, Competitor Analysis & Competitive Advantage

**Status:** Product strategy v1 · **Date:** 2026-05-31 · **Companion to:** the architecture docs
**Research:** WebSearch on Africa's Talking, Termii, Hubtel, mNotify, Twilio, Sendchamp, Infobip + market pain-point/trend analysis (sources at end).

---

## 1. The competitive landscape

| Tier | Players | Posture |
|---|---|---|
| **Global CPaaS** | Twilio, Infobip, Vonage, Plivo, Bird | API depth + omnichannel + enterprise orchestration. Premium price, weaker on African mobile-money & local pricing. |
| **African API-first** | Africa's Talking, Termii | Developer + fintech focus (OTP, transactional). Regional carrier links. |
| **African dashboard/SME** | Hubtel, mNotify, Sendchamp, Arkesel | Bulk SMS dashboards for non-technical businesses; Hubtel uniquely bundles SMS + payments. |

**The gap we target:** a platform that is **developer-grade *and* business-friendly** (dual-mode), **radically transparent on delivery + cost**, **multi-provider by design**, and **unified with payments/identity** — localized for African markets. No incumbent occupies all four corners at once.

---

## 2. Competitor feature matrix

✅ strong · 🟡 partial/limited · ⬜ absent/weak

| Capability | Twilio | Africa's Talking | Termii | Hubtel | mNotify | Sendchamp | Infobip |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| SMS API + SDKs | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ |
| Bulk/campaign dashboard | 🟡 | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| OTP / Verify (multi-channel) | ✅ | 🟡 | ✅ | 🟡 | ⬜ | ✅ | ✅ |
| Two-way / inbound SMS | ✅ | ✅ | 🟡 | ✅ | 🟡 | 🟡 | ✅ |
| Shortcodes / premium SMS | ✅ | ✅ | 🟡 | ✅ | 🟡 | ⬜ | ✅ |
| Number lookup / line-type intel | ✅ | ⬜ | 🟡 | ⬜ | ⬜ | ⬜ | ✅ |
| Delivery insights dashboards | ✅ | 🟡 | ✅ | ✅ | 🟡 | 🟡 | ✅ |
| Anti-fraud / pumping protection | ✅ | ⬜ | 🟡 | ⬜ | ⬜ | ⬜ | ✅ |
| Multi-provider failover/LCR | 🟡¹ | ⬜ | 🟡² | 🟡³ | ⬜ | ⬜ | ✅ |
| Omnichannel (WA/RCS/voice/email) | ✅ | 🟡 | ✅ | 🟡 | ⬜ | ✅ | ✅ |
| Integrated payments / wallet | ⬜ | 🟡⁴ | ⬜ | ✅ | 🟡 | ⬜ | ⬜ |
| Multi-currency billing | 🟡 | 🟡 | ⬜ | 🟡 | ⬜ | ⬜ | ✅ |
| Transparent cost-per-*delivered* | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Bring-your-own-provider | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 |
| Reseller / white-label sub-accounts | 🟡 | 🟡 | ⬜ | 🟡 | ⬜ | ⬜ | ✅ |

¹ Twilio Messaging Services pool senders but you're locked to Twilio. ² Termii "AI routing" within its own stack. ³ Hubtel best-path within Ghana networks. ⁴ Africa's Talking has airtime/payments adjacent.

**The two all-empty rows — `transparent cost-per-delivered` and `bring-your-own-provider` — are open territory.** Nobody owns them. We can.

---

## 3. Market pain points = our opening

From the research, what businesses actually complain about:

1. **Fake delivery reports.** Providers report "delivered" when the SMS never landed; businesses make decisions on false data. *Trust crisis across the market.*
2. **Hidden fees.** Low headline rate balloons with routing charges, retry charges, long-code limits.
3. **Cost-per-delivered ≫ cost-per-sent.** 10k sent at low rate but 60% delivered = far higher real cost. Nobody prices or reports on this.
4. **Spam filtering / sender-ID blocking** (unverified senders, keyword/URL filtering).
5. **Single-provider fragility** — one gateway outage = your messages stop.
6. **Integration pain** with CRM/ERP/fintech systems.
7. **Compliance complexity** — per-country sender-ID registration, consent/DND rules (Nigeria, Kenya strict).
8. **Operational cost of poor delivery** — support teams firefighting failed sends.

> Industry consensus from the trend research: **deliverability engineering is the moat** —
> verified senders, adaptive routing, real-time quality scoring, automatic failover. Pure
> coverage and price matter *less* than predictable delivery + accurate reporting.

---

## 4. Feature catalog for our platform

Phase tags: **[P1]** MVP · **[P2]** Growth · **[P3]** Advanced. Mode: **API** / **Dash** / **Both**.

### 4.1 Core messaging
- [P1][Both] Single send, bulk send, batch send
- [P1][Both] GSM-7/UCS-2 encoding + segment calculation (cost-correct)
- [P1][API] Idempotent send (Idempotency-Key)
- [P1][Both] Scheduled sends; [P2] recurring schedules
- [P1][Both] Sender ID per message; [P1] sender-ID registration workflow (per country)
- [P2][Both] Personalization/merge fields; templates with variables

### 4.2 Verify / OTP (high-margin, fintech demand)
- [P1][API] OTP generate + verify (SMS)
- [P2][API] Multi-channel OTP fallback: SMS → Voice → WhatsApp (deliver via whichever works)
- [P1][API] Configurable code length, expiry, attempt limits; auto-redact OTP bodies
- [P2][API] Anti-fraud: SMS-pumping/traffic-pumping detection + blocking (à la Verify Fraud Guard)

### 4.3 Deliverability & routing ★ our differentiator
- [P1][Both] Multi-provider plugin routing with **automatic failover** (already designed)
- [P2][Both] **Least-cost routing** + quality-weighted routing
- [P2][Both] **Real-time provider quality scoring** (per-route delivery %, latency)
- [P2][Both] Sender-ID/route health + circuit breaking (auto-demote bad routes)
- [P3][Both] Adaptive routing by time-of-day / network conditions

### 4.4 Number intelligence
- [P2][API] Number validation + normalization (E.164)
- [P2][API] Line-type / carrier lookup (reduce fraud, optimize routing)
- [P3][API] HLR lookup (active/ported number detection)

### 4.5 Business dashboard (non-technical users)
- [P1][Dash] CSV contact upload, contact lists, segments
- [P1][Dash] Campaign composer + send; [P2] A/B + scheduling
- [P1][Dash] Templates library; [P2] approval workflow
- [P2][Dash] Opt-out / DND list management (compliance)

### 4.6 Two-way & inbound
- [P2][Both] Inbound SMS / dedicated numbers / shortcodes
- [P2][Both] Auto-reply rules / keywords; [P3] inbound → webhook/workflow
- [P3][Both] Premium/billable SMS (MO/MT) for content monetization

### 4.7 Analytics & reporting ★ trust differentiator
- [P1][Both] Per-message status + reconciled DLR (not just "sent")
- [P1][Both] **Cost-per-delivered** reporting (nobody else shows this)
- [P2][Both] Delivery dashboards by country/carrier/route/status/error code
- [P2][Both] OTP conversion tracking; campaign analytics (delivery %, cost, failures)
- [P2][API] Exportable logs / Bulk Export API

### 4.8 Compliance & sender management
- [P1][Both] Sender-ID registration workflow + approval state (per country)
- [P2][Both] Consent capture + opt-out/STOP handling; DND routing
- [P3][Both] Per-country regulatory rule engine (content/sender rules)

### 4.9 Wallet & billing (from architecture)
- [P1][Both] Prepaid wallet, **multi-currency**, double-entry ledger
- [P1][Both] Transparent per-segment pricing (no hidden fees); auto top-up [P2]
- [P2][Both] Usage reports, invoices, spend alerts/low-balance
- [P3][Both] Volume/committed pricing tiers

### 4.10 Developer experience (Twilio's moat — localized)
- [P1][API] Versioned REST API, clear error model, request IDs
- [P1][API] **Test mode / sandbox** (sk_test keys, no charge/send)
- [P1][API] TypeScript SDK first; [P2] PHP/Python/Java
- [P1][API] **Excellent docs + code samples + webhook tester** (competitive weapon in this market)
- [P2][API] Webhooks (signed) for status/inbound; [P2] Postman collection

### 4.11 Platform / account
- [P1][Both] Multi-tenant orgs + SSO (WorkOS, already designed); RBAC
- [P1][API] API key management + scopes
- [P2][Both] **Reseller / white-label sub-accounts** (multi-tenant enables this)
- [P3][Both] **Bring-your-own-provider** (tenant plugs their own gateway creds)

### 4.12 Omnichannel — DEFERRED (avoid scope creep)
- [P3] WhatsApp Business API, RCS (SMS fallback), Voice, Email
- Trend: RCS/WhatsApp with **SMS fallback** is where messaging is heading; our plugin +
  failover engine is the right foundation, but **do not build this in P1/P2.**

---

## 5. Competitive advantages we can leverage ★ the core of this doc

Each advantage is grounded in an architecture decision you've **already made** — so these are
real and buildable, not aspirational.

### A. "Delivered, not sent" — honest billing + reconciled delivery + cost-per-delivered
- **Pain attacked:** #1 fake DLRs, #2 hidden fees, #3 cost-per-delivered.
- **Enabled by:** DLR reconciliation + reserve→commit/**refund** + double-entry ledger + per-provider `billingBasis`.
- **The billing model (transparency that's also margin-safe):**
  1. **Bill on the same basis the provider bills us** — each provider instance declares a
     **billable-status set** (`submission|accepted|delivered`); pass-through, no phantom charges,
     no margin gap.
  2. **Never charge for *platform-caused* failures** — internal errors, account suspension,
     fraud/SMS-pumping blocks, geo-permission blocks auto-refund (a **platform-fault exemption
     list** per provider). *(Note: messages the carrier accepts then drops may be billable if the
     provider bills us for them — we mirror that, transparently; we don't eat carrier-side failures.)*
  3. **Always show reconciled status + cost-per-delivered** — never fake "delivered".
  4. **Premium opt-in:** *guaranteed-delivered billing* on trustworthy-DLR routes, priced
     ≥ `cost ÷ delivery_rate` with abuse controls — a feature, not a blanket liability.
- **Message:** *"We bill the way the network bills us, never charge you for a failure on our side,
  and show you the real delivered cost — no phantom 'delivered' charges."*
- **Why it beats everyone:** competitors bill on submission **and** fake the delivered status, with
  no exemption for their own faults. We bill honestly, exempt platform-fault failures, and prove delivery.
- **Refined (2026-06-02, PI-1 research):** Twilio bills `undelivered` + a $0.001 `failed` fee but
  exempts internal/suspension/fraud/geo faults; Termii bills at MNO submission, no non-delivery refund.
  So the honest, viable line is **"never charge for failures *we* caused,"** not "never charge for failures."

### B. Multi-provider reliability + least-cost routing (no lock-in, no single point of failure)
- **Pain attacked:** #5 single-provider fragility, #2 hidden routing fees.
- **Enabled by:** the integrations plugin framework + failover + health/circuit-breaker.
- **The play:** automatic failover across gateways → higher real delivery %; least-cost +
  quality-weighted routing → lower effective cost; **bring-your-own-provider** for advanced
  tenants. Even resilient to *your own* vendor outages.
- **Message:** *"One outage shouldn't stop your messages. We route around failure automatically."*

### C. Transparent, multi-currency prepaid pricing
- **Pain attacked:** #2 hidden fees.
- **Enabled by:** multi-currency wallet + transparent per-segment rating.
- **The play:** clear per-segment cost up front, no surprise routing/retry charges, pay in
  local currency. Pricing honesty as a brand.

### D. One platform, two experiences (developer API + business dashboard)
- **Gap attacked:** Twilio = devs only; Hubtel/mNotify = dashboard only.
- **Enabled by:** one engine, two interfaces (BFF dashboard + public API), already designed.
- **The play:** a dev integrates the API *and* their marketing team runs campaigns from the
  dashboard — same account, same wallet, same logs. Serve the whole company.

### E. Unified ecosystem: SMS + Payments + Identity on one wallet/account
- **Gap attacked:** only Hubtel bundles SMS+payments; nobody unifies SMS+payments+identity.
- **Enabled by:** shared platform core (wallet, billing, WorkOS SSO) + payment plugin framework.
- **The play:** top up the same wallet that powers SMS *and* (later) collect payments; one SSO
  login across all your products. Massive cross-sell + switching-cost moat as verticals grow.
- **Message:** *"Your infrastructure stack, one account, one wallet, one login."*

### F. Developer experience as a weapon (localized)
- **Gap attacked:** #6 integration pain; most African providers have weak docs/SDKs/sandbox.
- **Enabled by:** test mode, TS SDK, versioned API, webhook tester, great docs.
- **The play:** make integrating in Accra/Lagos as pleasant as integrating Twilio in SF.

### G. Compliance-as-a-feature
- **Pain attacked:** #4 sender blocking, #7 compliance complexity.
- **The play:** built-in sender-ID registration workflows per country, consent/DND/opt-out
  handling. Turn a regulatory headache into a guided in-product flow.

### H. Reseller / white-label (platform leverage)
- **Enabled by:** multi-tenant + sub-accounts from day one.
- **The play:** let agencies/ISVs resell under their own brand → distribution multiplier.

---

## 6. Positioning — where to play, where not to

**Play here:** reliability transparency + dual-mode + unified wallet/payments + African
localization + honest pricing. Win the SME-to-mid-market and the developer/fintech segments.

**Do NOT try to win on (yet):**
- Enterprise omnichannel orchestration + CDP + agent desktop (Infobip's turf) — capital-heavy.
- Global carrier coverage breadth (Twilio's turf) — use plugins to borrow it instead.
- RCS/WhatsApp omnichannel at launch — defer to P3; the failover engine makes it additive later.

**One-line positioning:**
> *"The transparent, reliability-first communications + payments platform for African
> businesses and developers — one account, one wallet, messages that actually arrive."*

---

## 7. Recommended MVP cut line (P1)

Ship exactly this first; everything else is P2/P3:
- Core send (single/bulk/scheduled) + sender-ID registration
- OTP/Verify (SMS) with auto-redaction
- Multi-provider routing **with failover** (the differentiator, even with 1–2 providers)
- Reconciled DLR + **cost-per-delivered** reporting
- Multi-currency prepaid wallet + transparent pricing
- Business dashboard: contacts (CSV), campaigns, templates, basic analytics
- Public API + TS SDK + test mode + great docs
- Multi-tenant + WorkOS SSO + API keys

This MVP already differentiates on **A, B, C, D, F** — the five advantages we can stand behind
on day one without building omnichannel.

---

## Sources
- Africa's Talking — SMS / Bulk / Premium: https://africastalking.com/sms · https://africastalking.com/sms/premiumsms
- Termii — Messaging & Verify (SMS/Voice/WhatsApp/Email OTP): https://developers.termii.com/messaging-api · https://termii.medium.com/new-termii-voice-otp-286f196131a2
- Hubtel — Bulk SMS (delivery quality, best-path routing): https://explore.hubtel.com/bulk-sms-ghana/ · https://developers.hubtel.com/
- mNotify — Bulk SMS / Sender ID: https://mnotifybms.com/bulk-sms/
- Twilio — Verify, Lookup, Messaging Insights, Fraud Guard: https://www.twilio.com/en-us/user-authentication-identity/verify · https://www.twilio.com/docs/messaging/features/messaging-insights
- Sendchamp / Infobip (omnichannel, African CPaaS): https://sendchamp.com/verification · https://www.infobip.com/
- Market pain points: https://africala.net/blog/top-challenges-in-bulk-sms-delivery-in-africa/ · https://techriseglow.co.ke/solve-bulk-sms-delivery-challenges-kenya/
- Messaging trends (deliverability moat, RCS/WhatsApp): https://clevertap.com/blog/a-2025-guide-to-business-messaging-comparing-sms-whatsapp-and-rcs/ · https://prelude.so/blog/best-sms-gateway-providers
