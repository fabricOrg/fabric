# Ghana (NCA) compliance findings — E10-S6 research spike

> **Date:** 2026-07-10 · **Owner:** Product · **Status:** research findings — closes
> COMPETITIVE-ANALYSIS open question C-6 ("confirm NCA Ghana sender-ID/registration rules for
> the actual launch market"). Confidence per item is marked: **[P]** primary (NCA/carrier),
> **[S]** secondary (aggregator guides/Twilio/Telesign — directionally reliable, verify before
> betting money).

## Headline findings

1. **[P] MTN Ghana mandates alphanumeric sender-ID PRE-REGISTRATION effective 2026-07-08** —
   two days before this spike. Unregistered sender IDs to MTN GH are **blocked** after the
   deadline. Provisioning lead time: **~2 weeks domestic, ~3 weeks international** (Twilio GH
   guidelines). Ghana is no longer softer than Nigeria on this — our E10-S4 send-time
   enforcement matches launch-market reality, not just NG.
2. **[P] The UEC Code of Conduct** (Unsolicited Electronic Communications, NCA, amended 2016)
   is the governing instrument for consent/opt-out: written consent required — even VERBAL
   consent must be confirmed by the recipient via SMS before any marketing may be sent;
   pre-checked boxes / assumed consent do not qualify; opt-out must be honored immediately;
   every marketing SMS must carry an opt-out (STOP).
3. **[S] Promotional sending window in Ghana: 08:00–19:00, and NO promotional SMS on
   Sundays** (Arkesel/Telesign compliance guides; the UEC Code is the primary source to
   verify). Stricter than Nigeria's 08:00–20:00. → **Code adjusted in this PR**: GH promo
   window tightened to 08:00–19:00 + Sunday block (compliance fails toward the stricter
   reading until the primary text is verified).
4. **[S] Sender-ID registration mechanics:** NCA + per-network approval; typical turnaround
   3–5 business days via aggregators; reseller registration fee observed around **GHS 300**
   one-time (varies; some aggregators absorb it). Only letters/digits/space/hyphen, ≤11 chars.
   Our Arkesel reseller relationship is the practical registration path — sender registrations
   submitted through the Arkesel account.
5. **[P] Penalties:** UEC violations up to **5,000 penalty units ≈ GHS 60,000 per violation**.
6. **[P] International A2P consultation (NCA, March 2026):** Ghana is consulting on a national
   international-A2P gateway + licensing + volume-tiered fees — the same shape as Nigeria's
   draft framework. **Consultation stage, not enacted.** Track quarterly; if enacted it
   changes the inbound-international economics, not our domestic GH sends.
7. **[S] Carrier-tech notes (Twilio):** two-way SMS effectively unsupported GH-wide (matters
   for STOP-reply ingestion — an inbound path may need shortcode arrangements via the
   aggregator); long codes/short codes not supported for A2P via international routes.

## What this changes in the product (mapped)

| Finding | Product impact | State |
|---|---|---|
| MTN pre-registration (7/8) | Sender-ID gate is a HARD launch dependency in GH, not just NG | ✅ E10-S4 enforces at send time |
| GH window 08:00–19:00, no Sunday | `promoWindowOpen` per-country rules | ✅ tightened in this PR |
| Written/SMS-confirmed consent | Opt-in evidence storage (consent receipts) | ❌ backlog — E10-S7 candidate: store consent proof per recipient |
| STOP must work | Needs an inbound path; GH two-way is limited | ❌ deferred (recorded in E10-S5) — explore Arkesel shortcode |
| Registration lead times (2–3 wks MTN) | Go-live UX should say "expect ~2–3 weeks for MTN" | ❌ copy tweak, senders screen — small follow-up |
| Intl A2P gateway consultation | No action; monitor | 🔭 track quarterly |

## Sources

Primary: [NCA UEC Code of Conduct (PDF)](https://nca.org.gh/wp-content/uploads/2021/11/Amended-UEC-Code-of-Conduct2.pdf) ·
[NCA International A2P consultation, Mar 2026 (PDF)](https://nca.org.gh/wp-content/uploads/2026/03/Consultation-Paper-for-Industry-Sensitization-on-International-A2P-2.pdf) ·
[Twilio Ghana SMS guidelines](https://www.twilio.com/en-us/guidelines/gh/sms) (MTN 7/8 mandate, lead times)

Secondary: [Arkesel NCA-compliant bulk SMS guide](https://arkesel.com/how-to-send-bulk-sms-in-ghana/) ·
[Arkesel legal/regulatory policies](https://arkesel.com/legal-and-regulatory-policies-of-bulk-sms-in-ghana/) ·
[Telesign Ghana messaging regulations](https://support.telesign.com/s/article/ghana---messaging-regulations) ·
[BulkGate GH sender registration](https://help.bulkgate.com/docs/en/text-sender-registration-ghana.html)

## Verification follow-ups (before GTM)

1. Read the UEC Code PDF end-to-end and confirm the 08:00–19:00 + Sunday rule is in the
   primary text (currently [S]).
2. Confirm with Arkesel (reseller account manager): registration SLA per network, fees, and
   whether MTN's 7/8 mandate is enforced on their route today.
3. Data-residency: no GH data-localization requirement surfaced for SMS metadata in this pass;
   confirm against the Data Protection Act 2012 obligations (registration with the Data
   Protection Commission may apply to us as processor).
