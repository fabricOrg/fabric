# ADR 0014: WhatsApp as a Fabric channel

Status: **accepted 2026-08-08**.

Extends [ADR 0011](./0011-provider-plugins-as-control-plane-config.md) (provider plugins) and
[ADR 0012](./0012-channel-agnostic-commercial-offers.md) (channel-agnostic commercial offers).

## Context

WhatsApp has existed in this repo since migration `0011` as two strings and nothing else: a
`plugin_capability` enum value, and a `meta-cloud` catalog row
(`services/api/src/plugins/plugin-catalog.ts:52-61`, `enabled: false`). There is no adapter, no send
path, no persistence, no webhook route. ADR 0012 named WhatsApp a future channel and guessed its
natural unit would be "conversations or template messages".

A seam recon over the SMS dispatch path established what a second channel actually costs here, and
two findings decided most of this ADR:

1. **Email — the one existing second channel — did not generalize anything.** It got its own table
   (`email_messages`, migration `0062`) reusing the SMS `messageStatus` enum, rather than adding a
   `channel` column to `messages`. `messages` still has no `channel` column.
2. **Email reuses the SMS ledger transaction type verbatim.** There is no `email_charge` anywhere;
   `packages/wallet/src/wallet-service.ts:88` uses `sms_charge` for every send, and email's own
   integration specs assert `type = 'sms_charge'`. The type is already the generic "a send", misnamed.

## Decision

1. **WhatsApp gets its own table, `whatsapp_messages`, modelled on `email_messages`.** It reuses the
   shared `messageStatus` enum and carries WhatsApp-specific columns (recipient wa_id, template
   name/language/category, direction) instead of SMS's `sender_id` / `encoding` / `segments`. We do
   NOT generalize `messages` into a multi-channel table: that is a refactor across the money path
   (`prepare-send.ts`, `engine.ts`, the ledger's `reference_id` semantics) for no delivery benefit,
   and the codebase already chose duplication once and can generalize all three later from a position
   where three shapes are known rather than two guessed.

2. **The ledger does not change.** WhatsApp sends open `sms_charge` transactions, exactly as email
   does. The unique terminal index (`packages/db/src/schema/wallet.ts:203-210`, predicate
   `type = 'sms_charge'`) keys on `(tenant_id, reference_id)`, and a `whatsapp_messages` id is a
   distinct UUID, so idempotency holds unchanged. The name is pre-existing debt and renaming it means
   rewriting a partial unique index that guards commit-XOR-refund on real money — explicitly out of
   scope here, and not a prerequisite.

3. **The billable unit is a per-category template message, not a 24-hour conversation.** ADR 0012's
   guess is superseded. Meta moved WhatsApp Business pricing off conversation-based billing to
   per-message pricing by template category (marketing / utility / authentication), with service
   messages inside the customer-service window unbilled. This maps directly onto the existing
   `totalPriceMinor = units * unitPriceMinor` arithmetic (`effective-pricing.ts:57-119`), so no new
   money arithmetic is needed — only a widened channel/unit vocabulary, with `unit_basis = 'message'`
   and template category as a pricing dimension.

   **This is the one decision here resting on external fact rather than on this codebase.** Meta's
   current published rate card for Ghana and Nigeria must be read before any WhatsApp rate is
   published; if per-category per-message pricing is not what Meta bills us for those markets, this
   clause is what changes, and only the pricing layer moves with it.

4. **Template approval replaces sender-ID registration as the send precondition.** A WhatsApp
   template is a Meta-side object with its own approval lifecycle, so a send can fail on provider-side
   state our DB believes is fine. Template state is therefore treated as a **cache that can be stale**
   and a send failure attributable to it is a first-class, structured error — never a generic failure.

5. **Consent and quiet hours carry over; sender registration does not.** WhatsApp is phone-addressed,
   so the existing opt-out suppression and `subjectForPhone` PII path apply unchanged. Promotional
   quiet hours apply to the marketing category only. `sms-compliance.ts`'s sender-ID gate has no
   WhatsApp analogue and must not be forced into one.

6. **Webhook ingress follows the Paystack precedent, not the Arkesel one.** Meta signs callbacks with
   an HMAC (`X-Hub-Signature-256`) over the exact request bytes. The SMS DLR path reconstructs its body
   with `JSON.stringify` (`services/api/src/sms/sms-dlr.ts:25-31`), which cannot verify a byte-exact
   HMAC; `packages/integrations/src/paystack/provider.ts:178-188` already does this correctly. WhatsApp
   ingress uses `request.rawBody` (already enabled — `services/api/src/main.ts:30-41` creates the app
   with `{ rawBody: true }`) and verifies through the adapter's `verifyWebhook`. Meta's subscription
   handshake (a `GET` echoing `hub.challenge` when `hub.verify_token` matches) is part of this route.

7. **Kill switches: `platform.whatsapp_sending` plus the existing `provider.<slug>` convention
   (`provider.meta-cloud`), and both MUST be seeded in the catalog.** `platform.email_sending` was
   gated in code from the day it shipped but never seeded, so it could not be flipped and always read
   operational — a switch that exists only in the code path is not a switch.

8. **The adapter is a new interface, not a widened `SmsSenderPlugin`.** `WhatsAppSenderPlugin` carries
   capability `"whatsapp"`; `PluginManifest.capability`
   (`packages/integrations/src/plugin.ts:89-97`) widens to include it; a `WHATSAPP_ADAPTERS` registry
   mirrors `SMS_ADAPTERS`; and `PluginResolverService` gains `resolveWhatsapp` alongside
   `resolveSms`/`resolveEmail`/`resolvePayment`. Note `plugin-registry.service.ts:250-269`
   (`markDispatchOutcome`) hardcodes `capability = "sms"` and must be parameterized rather than
   duplicated.

9. **Availability posture per CLAUDE.md: the kill-switch/entitlement reads fail OPEN through the TTL
   cache; the wallet path fails CLOSED.** No reserve, no send. Same asymmetry as SMS.

10. **Phased delivery, and each phase ships its trigger.** A queued job or sweeper that exists only as
    library code plus a unit test is not shipped.

    - **Phase 1 — outbound template send, sandbox only.** Table + migration, contracts, adapter,
      resolver wiring, kill switches (seeded), pricing vocabulary widening, status webhook with real
      HMAC verification, worker path.
    - **Phase 2 — inbound.** Inbound message persistence, the 24-hour customer-service window, and
      free-form service messages, which are only legal inside it.
    - **Phase 3 — template lifecycle.** Sync of Meta template state, staff/customer surfaces.
    - **Phase 4 — commercial.** `COSTABLE_CHANNELS` and the offer-eligibility contract
      (`commercial-offer-cost.ts:18-20`, `commercial-offer-eligibility.ts:37-57`) currently admit only
      SMS and email, so WhatsApp prepaid offers fail `offer_channel_not_costable` until this lands.

## Consequences

- Live WhatsApp traffic stays **off** under CLAUDE.md §7 exactly as live SMS does. Phase 1 is
  provably sandbox-only, and flipping it is a human decision per engagement.
- `docs/MESSAGING-CAPABILITIES.md` currently says WhatsApp must not be presented as shipped. That is
  true today and stays true through Phase 1 — sandbox capability is not a shipped channel. It gets
  revised when a phase actually changes the customer-visible answer, not when code lands.
- Three near-duplicate message tables (`messages`, `email_messages`, `whatsapp_messages`) is a
  deliberate, recorded debt. The moment to generalize is when a fourth channel appears or when a
  cross-channel query becomes a product requirement — whichever comes first.
