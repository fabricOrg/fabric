# ADR 0016: Per-tenant WABAs, and Solution Partner as the billing tier

Status: **accepted 2026-08-10** — decision recorded, **nothing implemented**. Phase 1 (Meta business
verification + App Review) has not started; the code still runs one shared WABA.

Supersedes the aggregator constraint in [ADR 0014](./0014-whatsapp-channel.md) §5 and resolves the
attribution defect [ADR 0015](./0015-whatsapp-inbound-and-service-window.md) §2 documented as
unfixable. ADR 0015 named the fix — "per-tenant phone numbers … are what Meta expects at scale, but
they are a commercial and onboarding change … Not available now." This ADR makes them available.

## Context

One WABA serves every tenant. A WABA — WhatsApp Business Account — is Meta's container for phone
numbers, message templates, and the quality rating. Everything that matters attaches to it, so
sharing one means sharing all three:

- **Inbound cross-attributes.** ADR 0015 §2: two tenants messaging the same consumer inside one
  service window, and the second wins. A test asserts the behaviour because no rule available to us
  separates two legitimate senders on one number.
- **The template namespace is global.** A template's identity at Meta is name+language *on the WABA*.
  `0150` gave each tenant its own cache ROW, but the Meta object underneath is still one — two
  customers wanting `order_confirmation` collide, and whoever edits it edits it for everyone.
- **Quality rating and policy violations are shared fate.** One tenant's spam degrades delivery for
  every tenant, and Meta can restrict the whole account. The blast radius of a single bad customer is
  the entire book of business.

There is also a product hole this exposes: customers cannot create templates. The adapter has
`listTemplates` (GET) and no create call
(`packages/integrations/src/meta-cloud/provider.ts:145`), and the empty-state copy tells customers to
"create one in Meta Business Manager" — a Business Manager they have no access to, because the WABA
is ours. The instruction is impossible to follow.

Letting customers submit templates against the *shared* WABA would not fix any of the three problems
above; it would accelerate them, and it would require a human moderation queue whose cost scales with
customers — the opposite of the PI-6 self-serve direction.

## Decision

**Each customer gets their own WABA, onboarded through Meta's Embedded Signup**, and Fabric pursues
the **Solution Partner** tier.

Embedded Signup is a Meta-hosted popup launched from our dashboard. The customer authenticates with
Facebook, creates or selects a Meta Business portfolio and a WABA, registers and verifies a phone
number, and grants our app access. They never create a developer account, an app, or an App Review
submission — those stay ours.

### Why Solution Partner and not Tech Provider

The tiers differ in **billing, not capability** (Meta's own comparison):

| | Solution Partner | Tech Provider |
| --- | --- | --- |
| Has a credit line | Yes | No |
| Customers bypass payment method collection | Yes | No |
| Bills customers directly for API usage | Yes | No — **Meta bills the client** |

Fabric's money architecture exists to bill customers for messages: the double-entry wallet,
`MinorUnits`, reserve→commit, price books, commercial offers, and flat per-template-message pricing
(ADR 0014 §3). That path was proven end to end on 2026-08-09 — a real `wamid`, ledger
`pending → committed`, GHS 0.30. The SMS side is the same shape: an Arkesel reseller account with our
wallet doing per-tenant billing.

Tech Provider inverts exactly that. Meta bills the customer directly for WhatsApp usage, our
per-message margin disappears, and the customer hits a hard wall — Meta: "Until the client adds a
payment method, they will be unable to use your app to send template messages." We would be running
two contradictory commercial models, reseller for SMS and pass-through for WhatsApp, inside one
product.

**Tech Provider is still the first step**, because business verification and Advanced Access to
`whatsapp_business_management` + `whatsapp_business_messaging` are prerequisites either way.

### Fallback, if Solution Partner is not attainable

Meta supports a **multi-partner solution**: a Tech Provider partners with a Solution Partner who
shares their credit line with clients onboarded through the joint Embedded Signup. That preserves the
customer experience (no card entry, Fabric invoices) at the cost of a revenue share and a partner
dependency. Take this before accepting Tech Provider billing.

## Consequences

**The engineering does not depend on which tier wins.** All three paths need the same change, so the
code can proceed before Meta answers:

- `plugin_instances.tenant_id` is already nullable and was added for exactly this
  (`packages/db/src/schema/integrations.ts:41-51`, ADR 0011 §2).
- `plugin-resolver.service.ts:222` filters `isNull(pluginInstances.tenantId)` and already states the
  intended change: "when it lands it takes a tenantId argument and prefers the tenant row over this
  one."
- Credential sealing and versioning are already per-instance; the template cache is already
  tenant-scoped as of `0150`.

What breaks and must be handled:

- **`tenantsForWaba` becomes actively wrong.** It assumes one platform WABA, and its second UNION arm
  is not even scoped by `waba_id` (`whatsapp-template.service.ts:271-281`, duplicated in
  `whatsapp-template-sync.scheduler.ts:76-86`). With per-tenant WABAs a webhook must resolve to the
  ONE owning tenant, by `phone_number_id`.
- **Kill-switch and fail-open posture become per-tenant.** One customer's misconfigured WABA must not
  fail sending closed for everyone.
- **`PLUGIN_MASTER_KEY` now seals customer-owned secrets.** The key-rotation problem already seen in
  testing (credentials sealed under a derived key cannot be reopened) stops being an internal
  inconvenience and becomes a customer outage.
- **Onboarding gains steps we do not control**: Meta business verification for the customer, a phone
  number not already on WhatsApp, and display-name review.

What this fixes: inbound attribution becomes exact, template names stop colliding, quality rating
stops being shared fate, and customers can own their templates — which removes the impossible
instruction in the empty state.

## Open question, owned by a human

**Whether Solution Partner applications are open to us, in our region, and on what commitment.** Meta
publishes no requirements beyond calling it "a lengthy process"; secondary reporting suggests roughly
4-6 weeks across the partner application and the WhatsApp specialty, and no public revenue threshold
could be confirmed. This is a conversation with a Meta partner manager, it is the long pole, and it
is the only input that decides between Solution Partner and the multi-partner fallback. Start it in
parallel with Phase 1 rather than after it.

## Phase 1 checklist (measured 2026-08-10 against app `1022581630670557`, "Fabric App 2")

```
app_status: dev_mode        is_live: false
privileges: []              rejections: []
privacy_policy_url: null    terms_of_service_url: null    data_deletion_url: null
contact_email_verified: false
```

Nothing is damaged — zero privileges and zero rejections mean it simply has not started. In order:

1. Verify the contact email, and move it off a personal Gmail to a domain address — Meta weighs
   consistency with the business license and corporate email during verification.
2. Publish privacy policy, terms of service, and data-deletion URLs. App Review will not proceed
   without a privacy policy.
3. Complete Meta business verification.
4. Submit App Review for Advanced Access to `whatsapp_business_management` and
   `whatsapp_business_messaging`, with a video demonstrating messaging and template creation.
