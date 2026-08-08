# Fabric messaging capabilities

**Status:** Active product capability reference  
**Last verified:** 2026-08-08  
**Positioning:** See [`POSITIONING.md`](POSITIONING.md).

Fabric provides direct SMS, direct email, and managed messaging. Verify/OTP is supported, but it is
one use case rather than the platform's sole direction.

## Capability matrix

| Capability | Current status | Honest boundary |
| --- | --- | --- |
| Direct SMS send and retrieval | Implemented | Live carrier traffic remains human-gated |
| SMS batch send | Implemented | Durable per-item outcomes; current batch initiation needs scale hardening |
| SMS delivery reports and webhooks | Implemented | Accepted is not the same as delivered |
| Direct email send and retrieval | Implemented | Sandbox simulation is available; live provider/domain approval is gated |
| Managed SMS definitions | Implemented | Stable key, immutable versions, typed variables, locale, release, preview, send |
| Managed email definitions | Implemented | Same definition lifecycle; live delivery is gated |
| Verify/OTP | Implemented | Important use case, not the headline product category |
| Sender registration and consent controls | Implemented | Country/legal obligations still require operational review |
| Wallet, reservations, and ledger | Implemented | Money fails closed |
| Configurable price books | Implemented | Staff-managed; tenant and wholesale details are not public |
| Public standard rates | Implemented | Only the published subscription price book is exposed |
| Token purchase and consumption | Implemented in code | Live purchase remains payment-provider gated |
| Journeys/visual automation | Preview or partial | Do not claim a production execution engine where only local preview exists |
| Voice, WhatsApp, push, and USSD | Not current headline capabilities | Do not present as shipped |

Implementation and operational enablement are different. A compiled route or provider adapter does
not mean live traffic is approved.

## Send modes

### Direct SMS

The caller supplies recipient, content, sender context, reference, and idempotency information. The
platform segments and rates the message, reserves funding, dispatches it through an approved
provider path, records delivery state, and emits signed events.

### Direct email

The caller supplies recipient, subject, and text or HTML content. Sandbox delivery uses the virtual
email experience. Live sending requires an approved provider configuration and verified sending
domain and must fail closed when they are absent.

### Managed messaging

A definition owns content outside the application while the application calls a stable key.
Definitions support:

- application/environment scope;
- immutable stable key;
- typed variable schema;
- SMS or email channel variants;
- locale variants with a default;
- immutable published versions;
- environment release;
- preview through the same render and pricing path;
- managed send with reference, metadata, idempotency, and maximum-cost protection.

Direct APIs remain public. Managed messaging is additive, not a forced migration.

## Delivery and billing semantics

The platform distinguishes:

- **accepted:** Fabric validated and durably accepted the request;
- **submitted:** an approved provider accepted the outbound request;
- **delivered:** terminal provider evidence indicates delivery;
- **failed or expired:** terminal failure caused settlement according to the billing contract.

An accepted response must never be described as recipient delivery.

SMS is rated per segment. The send path resolves the tenant's price book, reserves the maximum
authorized amount, then commits or refunds according to the normalized terminal outcome and
provider billing rules. Platform-caused failures are not silently charged. Every money movement is
traceable by stable reference in the double-entry ledger.

Pricing strategy and token behavior are defined by
[ADR-0010](decisions/0010-pricing-and-billing-model.md). Provider adapters declare normalized
billing/status behavior; they do not decide customer authorization or mutate balances directly.

## Public pricing

Staff create and edit rate cards and price books in the admin console. One subscription price book
may be marked public. The public calculator receives only an allowlisted snapshot:

- channel;
- currency;
- unit price in exact minor units;
- effective timestamp/version metadata needed for cache behavior.

It does not receive price-book IDs, tenant assignments, wholesale provider costs, margins, tokens,
or unpublished rates. The public BFF parses the response against the public pricing contract before
returning it.

## Sandbox and live

Sandbox:

- uses `sk_test_*`;
- routes to virtual/fake providers;
- must be unable to reach a carrier or real inbox;
- exercises validation, rendering, pricing, idempotency, delivery state, webhooks, and wallet behavior.

Live:

- uses `sk_live_*`;
- requires approved sender/domain/provider configuration;
- requires funded wallet or valid tokens;
- respects kill switches, consent, DND, quiet hours, and environment entitlements;
- remains off until explicitly approved.

## Claims to avoid

- Do not describe Fabric as only OTP or transactional messaging.
- Do not claim voice, WhatsApp, push, or USSD as shipped.
- Do not claim a sandbox result proves carrier or inbox deliverability.
- Do not say "delivered" for an accepted or queued message.
- Do not publish compiled fallback rates as current public prices when the published rate store is
  unavailable.
- Do not describe local preview persistence as a real backend capability.
- Do not promise automatic multi-provider failover unless the configured production path and tests
  prove it.
