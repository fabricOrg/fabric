# Becoming Convert's messaging layer

_Last updated: 2026-08-19. Plan, not a commitment — §5 decisions are Convert's to make._

Convert is a mobile-first sales and lead platform for Ghanaian SMEs (`D:\work\smes-leads-platform`).
Its MVP ships WhatsApp/SMS outbound, templates and lightweight campaigns, and its own documents name
**WhatsApp integration depth as the highest-risk unknown** in the build. That risk is the opening:
it is the part of their product they least want to own, and the part we have already built.

## 1. How we actually win this

Convert's `CLAUDE.md` mandates that every WhatsApp/SMS integration go through a provider-neutral
adapter, so no provider payload leaks into contacts, leads, campaigns or activities. That rule is
correct and we should not argue with it — a vendor who asks a customer to weaken their architecture
has already lost the technical audience.

So the goal is not lock-in. **The goal is coverage: implement their messaging port so completely
that a second provider is never worth the integration cost.** A swappable adapter with nothing worth
swapping to is the strongest position available, and it is the honest one.

Three things decide it:

1. **Cover the whole surface**, including the parts they have scoped as "where supported" and
   therefore expect to compromise on.
2. **Give them capabilities their MVP explicitly cannot build** — see §4. Being sufficient makes us
   a candidate; solving a problem their scope says is out makes us the default.
3. **Be the reason WhatsApp stops being their top risk.** They have written that production WhatsApp
   readiness blocks pilot launch. If we carry Meta verification, template approval and the service
   window, that entire risk row moves to us.

## 2. What already fits, measured against their scope

| Convert requirement | Our surface |
| --- | --- |
| Send SMS to a contact (§13) | `POST /v1/sms/messages` |
| Predefined SMS templates (§13) | `/v1/sms/templates`, `/v1/message-definitions` |
| Send approved WhatsApp templates (§12) | `POST /v1/whatsapp/messages` — proven live, real `wamid` |
| Delivery/message status (§12, §13) | `GET /v1/messages`, `message.sent/delivered/undelivered/failed` webhooks |
| Campaign to selected contacts (§14) | `POST /v1/sms/batches` |
| Record message against the customer (§12, §13) | message id + `GET /v1/messages/{id}` |
| Opt-outs before a campaign send | `/v1/opt-outs` |
| Sender IDs | `/v1/senders` |

**Inbound WhatsApp is further along than their documents assume.** `whatsapp-inbound.service.ts`
attributes an inbound message, stores it, extends Meta's 24-hour window and emits an outbox event, so
a `message.inbound` webhook already reaches customers — idempotent on Meta's `wamid`, because Meta
retries. Their §12 treats two-way capture as unconfirmed; ingestion is not the missing piece.

## 3. The gaps, in the order they block Convert

Each is stated as what Convert cannot do today, not as a feature name.

### G1 — They can receive an inbound message but cannot read the conversation

`message.inbound` fires, but listing or paging a thread lives at
`/internal/tenants/{id}/virtual-phone/messages`, which is BFF-only and not customer-callable. So
Convert can react to a message and cannot backfill after downtime, cannot show history on a contact
record, and cannot reconcile a missed webhook. This is what blocks their §12 "full two-way inbox
synchronization", not the ingestion.

**Do:** expose inbound reads publicly — `GET /v1/messages?direction=inbound`, filterable by
counterparty, with the same keyset cursor as the other list endpoints.

### G2 — They cannot tell whether a free-form reply is allowed

We track Meta's 24-hour service window internally for attribution and never expose it. Convert's §12
wants to "launch a WhatsApp conversation from the contact record" — and whether that is a free-form
message or a paid template depends entirely on window state. Without it their UI must either guess,
or always use a template and pay for messages that were free.

**Do:** return window state per counterparty — open/closed and expiry. This is small, and it is the
single most useful thing we can hand a CRM.

### G3 — Campaigns cannot be scheduled

Their §14 lists "schedule or send campaign". We have no future-dated send anywhere: not in batches,
not in contracts. Convert would have to build and operate its own scheduler over our synchronous
send, which is exactly the kind of thing that grows into a second messaging system.

**Do:** accept a send-at on batches, honoured by the existing worker.

### G4 — Template approval state is invisible

WhatsApp templates sync at `/internal/admin/whatsapp/template-sync`, staff-only. Convert's UI needs
to show an SME that a template is pending, approved or rejected by Meta, because that gates whether a
campaign can run at all.

**Do:** publish template listing with Meta status on the customer surface.

### G5 — Inbound SMS does not exist

Arkesel has no mobile-originated path. Every SMS reply, STOP and SMS-originated lead is impossible
today. This is parked pending one answer from Arkesel (MO callback? per-workspace number or shared
shortcode?).

**Do:** get the Arkesel answer, or tell Convert plainly that inbound is WhatsApp-only and SMS opt-out
runs through a link. Saying so early is worth more than discovering it during their pilot.

### G6 — Each SME cannot bring its own WhatsApp number

We arm one `meta-cloud` credential per tenant by hand. Convert has many SMEs, each with their own
business number, which is Meta Embedded Signup. Without it, either every SME sends under our identity
— a different compliance story they must accept knowingly — or onboarding is manual per customer.

**Do:** decide the model with them (§5), then build Embedded Signup if it is per-SME.

### G7 — Production Meta readiness

Business verification and App Review still gate real customer launch, and live sending is switched
off by policy (`SMS_PROVIDER=fake`, `sk_test_` only) until a human flips it per engagement. Their
docs already carry this risk; we do not remove it by being chosen, we remove it by finishing it.

## 4. What makes us the obvious choice rather than a sufficient one

**Cost per message, exposed.** Their pitch deck names "marketing spend is a black box" as problem P2,
and their scope says the MVP does not solve it because it ships no cost-per-lead attribution. We
already price every message and hold a per-tenant ledger. Handing Convert per-message cost against a
lead id closes a deck problem their own MVP declared out of scope. Nothing else in their stack can do
this, and it is not a feature we would build for them — it exists.

**Phone verification.** `/v1/verify` is live. Lead capture forms with a verified number is a natural
fit for a leads product and needs no new work from us.

**One compliance surface.** Consent, opt-outs, sender-ID approval and delivery reconciliation are
most of the work in their §12 risk row. They inherit it rather than building it.

## 5. Decisions Convert has to make, and the first one is commercial

**Who holds the Fabric account?** Their MVP ships **no billing** and must not hardcode tier
entitlements. We charge per message against a wallet that fails closed. Two shapes:

- **Aggregator** — Convert holds one account, absorbs message cost as COGS, prices it into their
  tiers. Simplest for their MVP, and their org model needs no new field.
- **Per-SME** — each SME is a tenant with its own wallet and pays directly. Better margins for
  Convert and better compliance separation, but their org record now carries a tenant id and their
  onboarding grows a funding step.

This decision changes their data model and their pricing, so it belongs in an ADR on their side
before either team builds. It also determines G6.

**Two more:** whether SMEs bring their own WhatsApp number (G6), and whether inbound SMS is required
for pilot or WhatsApp-only inbound is acceptable (G5).

## 6. Sequencing

**Phase 0 — demo, unblocks their build.** Sandbox tenant, `sk_test_` keys, SMS + WhatsApp send +
delivery webhooks. Everything in §2 already works; this is an onboarding exercise, not development.
Their docs allow test credentials for demo, so nothing here waits on Meta.

**Phase 1 — pilot fit.** G1, G2, G3, G4. These are the four that decide whether Convert builds
around us or beside us, and none is large. G2 in particular is days, not weeks.

**Phase 2 — production.** G6 and G7, gated on the §5 decisions and on Meta verification. G5 depends
on an answer we do not control.

## 7. What would make us lose

Worth naming, because each is avoidable:

- **Arguing with their adapter rule.** It is good architecture. We implement it well instead.
- **Letting them build a scheduler.** The first piece of messaging infrastructure they own is the
  beachhead for the second.
- **Being vague about inbound SMS.** If they discover the gap mid-pilot it reads as a surprise; if we
  state it now it reads as candour.
- **Shipping unproven endpoints.** §12 of our own guide exists because a documented endpoint that has
  never returned a 2xx is a claim, not a capability. Convert will find out either way.
