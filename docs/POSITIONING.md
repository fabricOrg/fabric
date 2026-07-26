# Fabric - Positioning & Why Customers Choose Us (v3)

> **Date:** 2026-07-26 · **Owner:** Product · **Status:** current strategy
> Supersedes v2 (2026-07-10, verification-led) and v1 (2026-07-05, payments-seam).
> Product truth comes from the shipped contracts, SDK, API, and dashboard. Historical PI proposals
> remain decision context, not current positioning.

## One line

**Fabric is the messaging layer for products operating in Ghana and Nigeria:** direct SMS, direct
email, and managed messaging through one developer platform, with sandbox-to-live environments,
delivery evidence, regional controls, and billing that can be reconciled.

## The product

Fabric supports three co-equal ways to send:

1. **Direct SMS.** Send one message or a batch, retrieve the result, inspect delivery state, and
   receive terminal delivery events.
2. **Direct email.** Send transactional text or HTML email, retrieve and list messages, and move
   from a fake sandbox provider to a verified live sending domain.
3. **Managed messaging.** Author immutable, versioned SMS or email definitions with typed variables
   and locale variants. Release per environment, preview through the same render and pricing path as
   send, then deliver by stable key.

Verify/OTP is a supported product resource and an important use case. It is not the organizing
position for the platform.

## The problem we remove

Product teams commonly assemble communication from separate providers, template systems, delivery
logs, webhook implementations, and prepaid balances. That creates four recurring problems:

- application code owns content that should be versioned and changed independently;
- SMS and email have different integration, retry, and observability models;
- an accepted request is mistaken for a delivered message;
- finance cannot connect a charge or refund to the message that caused it.

Fabric gives both direct and managed sends the same application/environment model, authentication,
idempotency, delivery vocabulary, webhook scheme, and wallet controls.

## Who we serve first

The primary customer is a developer-led Ghana or Nigeria business that sends product communication:
fintech, lending, e-commerce, logistics, marketplaces, SaaS, and operational platforms.

The first buyer is usually an engineering lead or senior developer. Product and operations benefit
from managed definitions and delivery visibility; finance benefits from local-currency pricing and
ledgered billing.

This is not limited to OTP or financial messages. Relevant workloads include:

- verification and account security;
- transaction and account alerts;
- order, delivery, and service notifications;
- receipts and transactional email;
- scheduled or batched operational messaging;
- localized, versioned product communication managed outside application releases.

## Why Fabric

### One platform contract

SMS, email, and managed messages share scoped API keys, sandbox/live environments, idempotent writes,
delivery states, signed webhooks, and wallet accounting. A team learns one operational model.

### Managed messaging is a first-class product

Definitions are not a thin template helper. They have stable keys, immutable versions, typed variable
schemas, locale variants, environment releases, channel-aware recipient validation, preview/send
parity, optional maximum-cost guards, and generated SDK catalogs that can fail CI on drift.

### Regional depth

Fabric treats Ghana and Nigeria sender-ID registration, recipient consent, DND, and promotional
quiet hours as product controls. Pricing is expressed in GHS and NGN rather than translated from a
US-first product.

### Delivery and billing evidence

The terminal delivery event, delivery resource, caller reference, and wallet movement form one
traceable record. The platform reserves before a live send, charges a delivered message, and refunds
failed or expired delivery according to the wallet contract.

### A safe path from evaluation to production

Every application has isolated sandbox and live environments. Sandbox exercises rendering, pricing,
delivery states, webhooks, and wallet behavior through virtual providers without contacting a
carrier or inbox. Live activation remains a deliberate compliance and funding gate.

## Current product truth

Implemented and documented:

- workspace -> application -> sandbox/live environment hierarchy;
- direct SMS send, batch, retrieval, listing, delivery reports, and insights;
- direct email send, retrieval, and listing;
- SMS and email message-definition authoring, immutable versions, release, archive, and preview;
- managed send by stable key with locale, reference, metadata, idempotency, and cost ceiling;
- typed Node.js SDK and generated definition catalog;
- sender-ID registration, consent/DND, and quiet-hours controls;
- signed, retried, replayable webhooks;
- prepaid multi-currency wallet and double-entry ledger;
- self-service sandbox onboarding and dashboard management surfaces.

Operational enablement is separate from implementation. Live SMS, email, payments, and production
deployment remain subject to the engagement redlines, environment gates, provider configuration, and
human approval.

## Product narrative

The shortest complete Fabric story is:

> Create an application -> use its sandbox key -> send direct SMS/email or publish a managed
> definition -> preview and send -> follow the terminal delivery -> reconcile the wallet movement
> -> activate live resources when sender, domain, compliance, and funding are ready.

The landing page and demos should show this platform loop. OTP can appear as one example alongside
receipts, order updates, alerts, and email.

## What we do not claim

- WhatsApp, push, voice, USSD, and live inbound carrier messaging are not current headline channels.
- Sandbox validates the integration and platform behavior; it does not prove carrier or inbox
  deliverability.
- An accepted request is not a delivered message.
- Fabric does not replace a customer's legal and data-protection obligations.
- Payments and identity may expand the platform later, but they do not define the current messaging
  proposition.

## Success measures

Track the platform journey rather than a single OTP funnel:

1. visitor -> sandbox workspace conversion;
2. time to first successful direct or managed sandbox send;
3. percentage of new workspaces that retrieve a delivery or process a webhook;
4. definition created -> released -> previewed -> sent conversion;
5. direct SMS, direct email, and managed-message adoption by workspace;
6. sandbox -> live activation conversion;
7. delivery success, webhook health, and billing reconciliation exceptions.

## Copy rules

- Lead with **SMS, email, and managed messaging**, not Verify alone.
- Name the real user action: send directly, publish a definition, preview, follow delivery, reconcile.
- Distinguish sandbox behavior from live delivery.
- Distinguish implemented capability from enabled production routing.
- Prefer evidence over absolutes. Do not say "always arrives," "exactly like live," or "never fails."
- Keep future channels explicitly labeled as roadmap.
