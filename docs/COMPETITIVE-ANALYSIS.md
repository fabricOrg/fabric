# Fabric — Competitive Analysis & Feature Roadmap

> **Historical research notice (2026-07-26):** competitor observations remain useful, but the
> product baseline and strategic recommendations in this document predate direct email, managed
> SMS/email definitions, application environments, and the public SDK. Use
> [`POSITIONING.md`](./POSITIONING.md) for current product strategy and verify competitor claims
> again before making a new investment decision.

> **Date:** 2026-07-04 · **Author:** Product (fifi) · **Status:** research-backed, for prioritization
> **Method:** multi-agent deep-research fan-out — 6 search angles, 25 sources fetched, 122 claims extracted, top 25 adversarially verified (3-vote, need 2/3 to kill). **24 confirmed, 1 refuted, 0 unverified.** Full source list at the end. Claims tagged with their verification vote (e.g. `3-0`).
> **Caveat up front:** pricing/feature claims are current as of mid-2026 but move fast; the Nigerian A2P licence framework (§C-1) is a **July-2025 draft** ("proposed"), not gazetted law — track it before betting GTM on the numbers.

---

## 1. Executive summary

The research shows a clear, uncomfortable pattern: **the CPaaS players who win in Africa are already multi-channel, and the global leaders have set a high bar on developer experience and observability.** A pure SMS-first product with a basic dashboard is under-featured against *both* groups from day one.

Three strategic reads:

1. **Channel breadth is table-stakes here, not a "later" feature.** Africa's Talking (SMS · USSD · Voice · WhatsApp · Airtime · Payments) and Arkesel (SMS · USSD · WhatsApp · Voice · Email · OTP, 5 countries) bundle channels the global giants *don't* — especially **USSD** (feature-phone reach, no internet) and **airtime distribution**. These are Africa-specific must-haves. `3-0`
2. **Fabric's real moat is the bundle it already chose.** Messaging **+ payments + identity** in one platform is exactly what pure-messaging rivals can't easily match. Termii built a business on Verify/Token OTP; Twilio Verify is a flagship product; Africa's Talking bolts payments onto messaging. Fabric already has epics for all three (E2 identity, E3 wallet/ledger, E4 payments, E6 OTP/verify) — the job is to **productize the seams between them**, not to catch up feature-by-feature.
3. **Regulation is the P0 gate, not a compliance afterthought.** Nigeria (NCC) now mandates registered sender IDs as a hard delivery gate, runs a 2442 DND opt-out registry, and (draft) requires a ₦10M international A2P aggregator licence routing all inbound international traffic through one government gateway. Without sender-ID + consent tooling, **messages simply won't deliver** in the largest West-African market.

### What Fabric already has (honest baseline)

Per the PI-1 epics and PI-3 plan, Fabric is **not** a bare SMS sender — it has (built or planned): SMS engine + delivery (E5), OTP/Verify (E6), wallet + double-entry ledger + billing (E3), payments top-up (E4, Paystack), identity/SSO (E2, WorkOS), compliance (E7), developer experience (E8), control-plane/admin (E9), and three dashboards (product, dev-portal, admin-console). PI-3 wires the real spine (Africa's Talking for SMS, Paystack for payments, Ghana/West-Africa region). **The gaps below are measured against that baseline** — several "table-stakes" items are partially covered and need finishing/surfacing rather than net-new builds.

---

## 2. Competitor landscape

### Tier 1 — African-focused (the ones we actually compete with for the launch market)

| Player | Channels | Geography | Standout | Note for Fabric |
|---|---|---|---|---|
| **Africa's Talking** | SMS, USSD, Voice, WhatsApp, **Airtime**, **Payments/Mobile-money** | 16+ countries, pan-African | One SDK across 20+ telcos; bundles comms **and** payments | The closest analog to Fabric's thesis — and proof it works `3-0` |
| **Arkesel** | SMS, USSD, WhatsApp, Voice, Email, OTP | Ghana, Nigeria, Kenya, SA, Tanzania | Multi-channel + local pricing, "built for Africa" positioning | Direct Ghana competitor; multi-channel is their baseline `3-0` |
| **Termii** | SMS, Voice, Email, WhatsApp + **Verify/Token OTP** | Nigeria-first, West Africa | Verification-led; powers Paystack's transactional comms | Validates messaging+identity bundle; **Paystack is their reference customer** `3-0` |
| **Hubtel** | SMS, Voice, Payments | Ghana | Comms + payments + commerce, deep MTN/Telecel/AT ties | Ghana incumbent bundling the same three pillars |
| **mNotify / Sendchamp / Wigal** | SMS, Voice, some WhatsApp | Ghana / Nigeria | Bulk-SMS + campaign tooling, local aggregation | Bulk-campaign UX is their strength |

### Tier 2 — Global leaders (the feature-depth & DX benchmark)

| Player | Standout differentiator |
|---|---|
| **Twilio** | Best-in-class **Console + onboarding + observability** (see §A). Verify is a flagship. Positions on API breadth/customization. |
| **Infobip** | **Unified omnichannel** portal (SMS/email/voice/WhatsApp/Messenger) with **RCS→SMS automatic failover** `3-0` |
| **MessageBird/Bird, Sinch, Vonage, Zenvia** | Native WhatsApp (still a *differentiating*, not universal, channel among CPaaS) |
| **Telnyx, Plivo** | Cost/infra plays — owns network, BYOC, aggressive per-message pricing |

---

## 3. Prioritized findings

Priority scale: **P0** = blocks launch / hard delivery gate · **P1** = needed for competitive parity · **P2** = edge / later. Each item cites a competitor precedent and its verification vote.

### A. Table-stakes gaps to close (parity)

| # | Gap | Priority | Fabric status | Precedent (vote) |
|---|---|---|---|---|
| **A-1** | **Channel breadth beyond SMS** — at minimum WhatsApp Business API + Voice; treat SMS as one channel, not the product | **P0** | SMS built; WhatsApp/Voice not yet | AT & Arkesel ship 5–6 channels each `3-0` |
| **A-2** | **Sender-ID management** — buy/register/track sender IDs with guided compliance flow | **P0** | Partial (E7 compliance) — needs first-class UI | Twilio "Numbers & Senders" hub `3-0`; NCC mandate `3-0` |
| **A-3** | **Delivery observability** — DLR/error dashboards with per-error-code frequency, doc links, and filtering by carrier/country/status/error/sub-account/number | **P0** | Messages screen exists; needs Insights-grade depth | Twilio's 6 Messaging Insights dashboards `3-0` |
| **A-4** | **Unified developer workbench** — API keys, webhooks, logs, alarms in one place | **P1** | dev-portal has keys/webhooks/logs — consolidate into one debug surface | Twilio redesigned Console `3-0` |
| **A-5** | **No-wait sandbox** — send/receive over real APIs before compliance approval ("virtual phone") | **P1** | Not yet | Twilio Virtual Phone; Twilio *reports* 62% better first-message activation, 33% faster prod launch (self-reported) `3-0` |
| **A-6** | **Guided onboarding path** — sequenced milestones (foundations → sender strategy → build → monitor/comply) that end in observability | **P1** | Ad-hoc | Twilio 4-milestone onboarding `2-1` |
| **A-7** | **Channel failover / smart routing** — auto-fallback (e.g. WhatsApp→SMS, or provider→provider least-cost) | **P1** | Single provider (FakeProvider→AT) | Infobip RCS→SMS failover `3-0` |
| **A-8** | **Campaigns & bulk** — bulk send, scheduling, templates, link tracking, opt-out handling | **P1** | Send screen is 1-to-few; bulk/campaign UX missing | mNotify/Arkesel bulk tooling; Twilio Link Shortening dashboard `3-0` |

### B. Differentiators to pursue (where Fabric can pull ahead)

| # | Differentiator | Priority | Why rivals can't easily match |
|---|---|---|---|
| **B-1** | **Verify-as-a-product** — a single OTP/identity API across SMS/voice/WhatsApp/email/TOTP, billed per verification, sitting on Fabric's own identity layer | **P0/P1** | Termii & Twilio Verify prove the demand `3-0`. Fabric already has E6 OTP + E2 identity — connect them into one primitive. |
| **B-2** | **Fraud & number intelligence** — carrier lookup, risky-number scoring, rate-limiting, SIM-swap signals bundled into Verify | **P1/P2** | Twilio layers Fraud Guard/Lookup onto Verify `3-0`. Pure-messaging rivals lack the identity graph to do this. |
| **B-3** | **Messaging + payments + identity as one ledgered flow** — e.g. "send OTP → authenticate → charge wallet → confirm by SMS" as a single audited, double-entry-backed transaction | **P1** | This is the bundle. AT/Hubtel bundle comms+payments but Fabric's double-entry ledger + WorkOS identity make the *seam* auditable end-to-end — a real wedge. |
| **B-4** | **Airtime/data distribution via API** — bulk top-up disbursement, priced in local currency | **P1** | AT offers it; global players don't `3-0`. Natural bridge from Fabric's existing wallet/payments rails. |
| **B-5** | **Unified omnichannel inbox + failover** — one managed portal, not just APIs | **P2** | Infobip's positioning wedge vs Twilio `3-0`. |

### C. Africa-specific must-haves (regulatory & market fit)

| # | Must-have | Priority | Detail (vote) |
|---|---|---|---|
| **C-1** | **Nigeria A2P compliance posture** | **P0 (NG)** | NCC draft (8 Jul 2025): all inbound international A2P must route through one NCC-approved gateway; ₦10M/5yr licence + 5% admin fee; **Nigerian-registered body required, MNOs barred.** Options: partner with a local licensee or route via OTT (WhatsApp). `3-0` / `2-1` — **DRAFT, track finalization** |
| **C-2** | **Sender-ID registration engine** | **P0** | NG: unregistered sender ID = message rejected by originating/terminating operator. Alphanumeric IDs need pre-registration (1–5 business days; CAC cert, NIN, sample messages); banks need 4 No-Objection Certificates (one per operator). Build registration status into the dashboard. `3-0` |
| **C-3** | **DND / consent / opt-out engine** | **P0** | NG 2442 DND registry: promo SMS filtered against registry, STOP=opt-out, promo time-boxed 08:00–20:00 WAT; **transactional/OTP bypasses DND 24/7.** Must classify traffic promo-vs-transactional and enforce quiet hours + opt-out. `3-0` |
| **C-4** | **USSD channel** | **P0/P1** | Real-time interactive sessions on *any* handset incl. feature phones, no internet — reaches users SMS/data can't. AT & Arkesel both ship it. `3-0` |
| **C-5** | **Local pricing + mobile-money top-up** | **P1** | Native GHS/NGN/USD pricing and MTN MoMo / Paystack wallet top-up (PI-3 already targets Paystack). Local currency is how AT/Arkesel win on cost. `3-0` |
| **C-6** | **Ghana (NCA) compliance parity** | **P1** | Launch market is Ghana, but surviving regulatory evidence was almost all Nigeria — **open question:** confirm NCA Ghana sender-ID/registration + data-residency rules before launch (see §5). |

---

## 4. Recommended sequencing (PM view)

Mapped onto Fabric's increments — not a commitment, a starting point for backlog grooming:

- **Now / PI-3 (make-it-real spine):** C-2 sender-ID engine, C-3 DND/consent engine, A-2/A-3 sender + delivery observability, B-1 Verify-as-a-product (connect E6+E2). These are P0 and mostly *finish/surface* work on existing epics.
- **PI-4 (channel breadth):** A-1 WhatsApp + Voice, C-4 USSD, A-7 failover, A-8 campaigns/bulk. Turns Fabric from "SMS sender" into "CPaaS."
- **PI-5 (edge):** B-3 ledgered messaging+payments+identity flow, B-4 airtime distribution, B-2 fraud/number intelligence, A-5 sandbox, A-6 guided onboarding, B-5 omnichannel inbox.
- **GTM gate (parallel, legal-owned):** C-1 Nigeria A2P licence decision (partner vs OTG vs defer NG), C-6 Ghana NCA confirmation.

---

## 5. Caveats & open questions

**Caveats (verification honesty):**
- **Nigeria A2P licence is a DRAFT** (July 2025, "proposed"). ₦10M / single-gateway / 5% admin-fee figures are accurate *as drafted* but may change on gazetting. `10/11: 3-0`, `19/20: 2-1`.
- **Twilio's 62%/33% onboarding gains are self-reported**, unaudited "early results" — cite as "Twilio reports," not fact.
- **One claim refuted (0-3) and excluded:** WhatsApp Nigeria user-base (~90–100M / 95% of internet users). Do **not** cite that figure.
- Some African vendor homepages (Africa's Talking) blocked the fetcher (HTTP 403); substance confirmed via help/docs subdomains + third parties. Arkesel channel/geography rests on Arkesel's own marketing (self-positioning). Error code 30007 is Twilio-specific "message filtered," not an NCC standard.

**Open questions (worth a follow-up pass):**
1. **Current 2026 wholesale rates** (SMS/WhatsApp/USSD, GHS/NGN/USD) across AT, Termii, Hubtel, Arkesel, mNotify — pricing detail didn't survive verification. Needed to price competitively at margin.
2. **Concrete integration shape** of mobile-money/airtime (Paystack, MTN MoMo) into a CPaaS flow — what exactly does the bundle look like that rivals can't replicate?
3. **Finalized status & enforcement date** of Nigeria's A2P licence; equivalent regimes + data-residency in Ghana and other West-African targets.
4. **Ghana (NCA) specifics** — carrier/aggregator relationships and sender-ID registration process for the *actual launch market*.

---

## 6. Sources

Primary (highest weight):
- Twilio — New Console: https://www.twilio.com/en-us/blog/products/launches/new-twilio-console · docs: https://www.twilio.com/docs/usage/new-twilio-console
- Twilio — Onboarding redesign: https://www.twilio.com/en-us/blog/developers/redesigning-twilio-onboarding-experience-whats-new · Virtual Phone: https://www.twilio.com/docs/messaging/guides/guide-to-using-the-twilio-virtual-phone
- Twilio — Messaging Insights dashboards: https://www.twilio.com/docs/messaging/features/messaging-insights/dashboards · Onboarding: https://www.twilio.com/docs/messaging/onboarding
- Twilio — Verify: https://www.twilio.com/en-us/products/verify-resources · SIM-swap Lookup: https://www.twilio.com/docs/lookup/lookup-sim-swap
- Termii — Verify/Token API: https://developers.termii.com/verify-token
- Africa's Talking — home: https://africastalking.com/ · pricing: https://africastalking.com/pricing · USSD docs: https://developers.africastalking.com/docs/ussd/overview
- Infobip — RCS→SMS failover: https://www.infobip.com/docs/tutorials/set-up-failover-from-rcs-to-sms
- NCC — A2P Licence Framework (PDF, draft): https://www.ncc.gov.ng/sites/default/files/2025-07/A2P-LICENCE-FRAMEWORK.pdf · Consumer/DND portal: https://consumer.ncc.gov.ng

Secondary / analysis:
- MEF — Nigeria A2P licensing overview: https://mobileecosystemforum.com/2025/08/06/nigerias-new-international-a2p-messaging-aggregator-licensing-comprehensive-overview-and-market-impact/
- Sent.dm — Nigeria SMS compliance guide: https://www.sent.dm/en/resources/sms-compliance/nigeria-sms-guide
- SelectHub — Twilio vs Infobip: https://www.selecthub.com/cpaas-platforms/twilio-vs-infobip/
- Arkesel — provider/OTP/WhatsApp comparisons (self-positioning): https://arkesel.com/comparing-top-5-bulk-sms-providers-features-pricing/
- Termii — Paystack case study: https://blog.termii.com/secure-and-reliable-how-termiis-communication-platform-transformed-paystacks-transactional-processes
