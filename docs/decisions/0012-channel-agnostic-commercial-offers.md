# ADR 0012: Channel-agnostic commercial offers

Status: **accepted 2026-07-30** (product owner).

Extends and partially supersedes [ADR 0010](./0010-pricing-and-billing-model.md). The product owner
ratified the money-accounting and commercial-pricing roadmap and clarified that commercial offers
must serve every Fabric channel, not only SMS.

## Context

ADR 0010 introduced per-channel token entitlements but its implemented purchase path assumes:

- the channel is the existing `sms | email` message-channel enum;
- a customer chooses an arbitrary quantity;
- every unit has one positive whole-minor-unit price; and
- purchase consideration equals `quantity × unit_price_minor`.

That cannot represent fixed bundles whose total consideration is indivisible by their unit count.
It also makes every new Fabric channel a schema, contract, purchase, and accounting rewrite.

Fabric needs commercial offers for current and future channels. Their natural units differ:

- SMS uses segments;
- email uses recipients/messages;
- voice may use seconds or minutes;
- WhatsApp may use conversations or template messages;
- push and future channels define their own governed unit.

The accounting invariant is common even when channel eligibility and provider costs differ.

## Decision

1. **Commercial offers are channel-agnostic.** They reference a governed channel + natural-unit
   registry instead of an `sms | email` enum. The initial registry contains SMS/segment and
   email/recipient. Adding a channel is a registry and runtime-capability change, not a pricing
   schema migration.
2. **A registry entry is not proof of deliverability.** Drafts may target a registered channel, but
   publication and purchase fail closed unless the channel is active, provider-cost evidence
   exists, and the runtime can deliver and settle that unit.
3. **Pay-as-you-go and prepaid offers remain distinct.** PAYG continues to use effective per-unit
   sell rules. A prepaid offer is a named, immutable fixed quantity for a fixed total price.
4. **The fixed total is authoritative.** An offer version stores paid units, explicit bonus units,
   total units, and total consideration in integer minor units. It does not require or store a
   rounded unit price as financial truth.
5. **Indivisible totals use cumulative integer allocation.** For a lot with total consideration
   `P`, total units `Q`, and `n` units consumed:

   ```text
   recognized_through(n) = floor(P × n / Q)
   amount_for_this_consumption =
     recognized_through(consumed_after) - recognized_through(consumed_before)
   ```

   This allocates the exact total without floats, lossy rounding, or a stranded remainder.
6. **Published versions are immutable.** Staff change commercial terms by cloning a new draft
   version. Existing purchases reference the exact version and snapshot used at checkout.
7. **Eligibility is extensible but validated.** Common dimensions include destination country,
   traffic class, provider, and service class. Channel-specific additions extend the validated
   eligibility contract without changing the core money tables.
8. **Catalog assignment controls negotiated pricing.** Offers belong to a price-book catalog.
   Default/public and workspace-assigned catalogs determine eligibility; checkout never accepts an
   operator-authored or client-authored amount.
9. **Margin protection applies to every channel.** Publication requires expected and worst-case
   provider cost evidence for all permitted eligibility dimensions. Below-floor offers require a
   separately approved promotional policy; they do not bypass the standard margin guard.
10. **First release exclusions stay explicit.** Bonus units remain zero, with no expiry, coupons,
    recurring subscriptions, partial refunds, FX, or generic pricing formula language.

## Consequences

- New `commercial_offer_channels`, `pricing_offers`, and `pricing_offer_versions` control-plane
  tables establish the registry, stable identity, and immutable commercial terms.
- Existing unit-priced token lots remain valid. Offer-backed purchases require an expand/contract
  migration and a temporary dual recognition path until legacy lots are exhausted.
- Token holds select compatible lots by channel, natural unit, currency, and eligibility. A send is
  still fully token-backed or falls through to wallet money; entitlement never fails open.
- Admin authoring separates PAYG rates from prepaid offers and uses display-currency amounts.
- Customer copy names the actual unit rather than promising that one credit always equals one
  end-user message.
- Provider-cost and reconciliation work is required before any channel's bundle can be sold live.

## Alternatives rejected

- **Add SMS package-size columns to `price_book_rates`:** preserves the current screen but hardcodes
  the wrong channel and mixes PAYG rates with products.
- **Use a free-form discount percentage:** cannot express every fixed-total offer and is difficult to
  reconcile against an immutable purchase.
- **Round an implied unit rate:** can overcharge, undercharge, or leave deferred revenue stranded.
- **Use floating-point unit prices:** violates Fabric's exact-money invariant.
- **Store arbitrary JSON for the entire offer:** flexible but gives up database constraints on
  quantity, consideration, lifecycle, approval, and reconciliation.
