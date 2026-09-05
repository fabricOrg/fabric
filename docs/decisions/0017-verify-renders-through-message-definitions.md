# ADR-0017 — Verify renders through message definitions

_Status: accepted, 2026-09-05. Supersedes nothing; extends ADR-0002 (Verify as the golden path) and
ADR-0005 (managed message definitions)._

## Context

`POST /v1/verify` takes two inputs — `to` and an optional `sender_id` — and hardcodes everything
else in `verify.service.ts`:

| thing | value | line |
| --- | --- | --- |
| body | `` `Your Fabric verification code is ${code}. It expires in 5 minutes.` `` | `:78` |
| code | 6 digits | `:53` |
| TTL | `CODE_TTL_SECONDS = 300` | `:16` |
| sender | `FABRIC` | `:18` |
| channel | SMS only | contract |

Three problems follow, in descending order of how much they cost us.

**The message names our product to someone else's users.** A customer integrating Verify sends
*their* end users an SMS that says "Fabric". `sender_id` changes the from-header, not the text.
Anyone white-labelling — which is precisely the integration shape in CONVERT-INTEGRATION-PLAN.md —
cannot ship this. It is not a preference; it is a blocker on the product we lead with.

**The TTL is duplicated as prose.** The body asserts "5 minutes" as a string while the TTL is a
constant. Changing `CODE_TTL_SECONDS` makes the SMS lie, silently. That is a defect today, before
anything here is built.

**There is no localisation.** One English string for a Ghana/Nigeria product.

Meanwhile the platform already has a managed content system — definitions with versions, per-locale
variants, a portable variable schema, a shared `{{ token }}` renderer, per-environment releases, and
sender bindings (ADR-0005). Verify does not use any of it; it builds a string and calls `SmsService`.

## Decision

**Verify renders through message definitions.** No new template system, and not `sms-templates`,
which is the older and narrower of the two and has no locale or variable-schema support.

Four decisions carry the weight.

### 1. The caller selects the template per request, and supplies variables

`POST /v1/verify` gains `template` (a stable key), `variables` (a map) and `locale`. A per
application-environment default covers the set-once case, so a caller who never sends `template`
keeps working.

An earlier draft of this ADR made selection configuration-only, reasoning that a caller free to name
any definition could name a promotional-class one and have its OTPs filtered by carriers. That
reasoning was wrong about where the guard belongs, and the integrator review that caught it is
recorded here because the correction generalises: **the constraint belongs on which definitions may
EXIST as verify-eligible, not on who may choose between them.** Once eligibility is enforced at
publish time (§3), every definition a caller can name is already safe, and per-request selection
costs nothing to allow.

It also has to be allowed, because the platform case demands it. A reseller sends differently
branded codes on behalf of many merchants under one workspace, and configuration at workspace grain
cannot express that. Applications do not rescue it either: merchants arrive faster than
application-environments should be minted for them, and the merchant model is a separate decision
(see Follow-on).

### 1a. Fabric generates the code, and the caller can never supply it

`code`, `expires_minutes` and `expires_seconds` are RESERVED. They are injected after the caller's
variables and a caller-supplied key of any of those names is **refused**, not overwritten silently —
a merge would make the difference between a rejected request and a caller-chosen OTP a matter of key
ordering.

This is the property the primitive is for. The integrator states it as a hard constraint from their
side: their own architecture forbids a verification code existing in their database at all. It is
equally ours — the plaintext code exists in the SMS body and, for sandbox tenants only, in
`debug_code`. Templates choose the wording; they never own the secret.

### 2. The platform default lives in the reserved namespace

`stable_key` already refuses anything beginning with `fabric.` for customer-authored definitions.
That reservation exists and is unused; the built-in default becomes `fabric.verify.otp`, seeded per
environment. A tenant with no binding renders it and behaves exactly as today.

This is why the change is not breaking: absent configuration is a valid, defaulted state.

### 3. Two invariants, enforced at PUBLISH time

A definition is **verify-eligible** when both hold. Eligibility is derived, not a separate flag, and
it is what `template` may name:

- **Every locale variant contains `{{code}}`.** A definition without it renders a perfectly valid
  SMS containing no verification code. The send succeeds, the wallet is charged, and the user waits
  forever for a code that was never in the message. A silent total failure of the headline feature
  is the worst outcome available here. Checked across **every** locale, not just the default —
  a template that works in English and drops the code in French is the same bug, discovered later.
- **The class is `transactional`.** Promotional traffic is filtered by carriers and billed as a
  different class; an OTP that is quietly promotional is both a deliverability and a billing defect.

Publish time, not send time, and not bind time. Send-time-only turns a configuration mistake into an
outage of the caller's signup flow. Bind-time-only was the earlier draft's answer and does not
survive §1: with per-request selection there is no single bind to check, so the guard has to sit
where a definition becomes usable at all. Naming an ineligible or unknown key is a 400 with a stable
code, which is a caller error at integration time rather than a silent wrong send.

Archiving or unpublishing a definition that is some environment's default is refused for the same
reason.

### 4. TTL and code length become configuration, and the prose becomes a variable

They move into the binding, and the body gains `{{expires_minutes}}`. This is not scope creep: a
configurable TTL with hardcoded prose is a message that lies, so shipping the first without the
second would introduce the defect we already have, permanently.

Variables Verify supplies, and reserves: `code`, `expires_minutes`, `expires_seconds`. Everything
else in the template is the caller's, validated against the definition's existing variable schema —
so `{{platform}}`, today hardcoded to "Fabric", becomes the caller's own merchant name.

## Rejected

**Configuration-only selection (no `template` parameter).** Held briefly and reversed — see §1. It
put the guard on the chooser instead of on the choosable set, and it cannot express a reseller
sending under many merchant brands.

**Merging caller variables over the reserved ones.** Convenient, and it makes OTP integrity depend on
key ordering. Refused loudly instead — see §1a.

**Extending `sms-templates` instead.** It would need locales, a variable schema and a renderer —
i.e. it would need to become message definitions. Two content systems where one will do is the
standing debt this repo already names (nine `StatusBadge`s, ~30 date formats).

**Send-time validation only.** Simpler, and it converts every configuration mistake into a
production outage of the customer's signup flow.

**Silent fallback to the platform default when a binding resolves to nothing.** Rejected as the
default posture: it sends Fabric-branded SMS to a customer's users without telling anyone. It
survives only as the last-resort arm below, where it is logged and observable.

## Consequences

- The wallet/reserve/commit path, kill-switches, sandbox provider pinning and `debug_code` are
  unchanged — Verify still sends through the normal SMS pipeline. Only body resolution moves.
- `verify.integration.spec.ts` asserts the literal body today and must assert a rendered one.
- Rendering adds a definition read to the Verify hot path. It is cached per
  `(application, environment, locale)` behind a short TTL, and on cache-store failure serves
  last-known-good — availability posture, not money posture.
- If a binding somehow resolves to nothing at send time despite §3, Verify renders
  `fabric.verify.otp`, logs an error and emits an outbox event. That path should be unreachable;
  it exists so a bug in our validation cannot take down a customer's signups.
- The `debug_code` sandbox affordance is unaffected and still never set on live tenants.

## Slices

1. **Render the current body through the renderer, unchanged.** Seed `fabric.verify.otp` with the
   existing wording plus `{{code}}` and `{{expires_minutes}}`; make Verify resolve and render it.
   No new API surface. Behaviour identical, prose no longer able to contradict the TTL.
2. **The binding.** `verify_settings` per `(tenant, application, environment)` — definition key,
   TTL, code length, default locale — with the §3 invariants and the archive/unpublish guard.
3. **`locale` on `POST /v1/verify`**, falling back to the binding's default.
4. **Surfaces.** Dashboard configuration UI, SDK `locale`, and the docs.

Slice 1 is the one that removes the defect that exists today, so it ships first and alone.

## Follow-on, raised by the integrator and NOT in this ADR

Recorded so they are not lost, and separated because each is its own decision:

- **Sub-accounts (merchants) under a platform account** — their words, "the big one". A merchant
  wants its own sender id, usage, consent/DND state and spend line, so a reseller's metering maps
  one-to-one onto our invoice instead of being reconstructed from message tags. This is the same
  shape as ADR-0016's per-tenant WABAs and should extend it rather than invent a parallel model.
- **Delivery webhook carrying the actual charge.** `MessageWebhookData` carries status and no cost,
  so a reseller billing on delivered can only estimate. Needs a decision on what price we assert
  (charged vs list) and when.
- **Sender-id status-change webhook.** Registration already exists over the API; there is no
  `sender.*` event, so a caller must poll to learn a carrier outcome.
- **Per-request channel and voice failover.** `voice` exists today only as an analytics enum, with
  no send path — the caller-chooses-fallback question is worth having, but the channel is unbuilt.
- **Number lookup** (validity and network before spending a message).
- **Published live p95 for Ghanaian delivery.** We cannot answer this honestly yet: live SMS is
  gated off, so we hold no live latency data and any figure would be sandbox timings relabelled.
  Saying so is the correct answer until real traffic exists.
