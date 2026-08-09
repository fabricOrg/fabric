# ADR 0015: WhatsApp inbound, and who an inbound message belongs to

Status: **accepted 2026-08-09** — inbound ingestion + the service window are implemented under this
decision. The free-form send that the window unlocks is explicitly NOT implemented here (see §6).

Extends [ADR 0014](./0014-whatsapp-channel.md) (WhatsApp channel). Shares its root problem with the
parked SMS MO work: on a shared sender identity, an inbound message does not say whose it is.

## Context

Outbound is easy to attribute: the tenant asked us to send it. Inbound is not. Meta delivers an
inbound message to the **WABA**, and Fabric runs the aggregator model ADR 0014 §5 chose — one master
Meta account whose WABA is shared across tenants, with our own wallet doing per-tenant billing. So
the webhook payload identifies the WABA phone number and the consumer's number, and nothing else.
`tenantsForWaba()` returns *every tenant that has ever sent live traffic*, which is the right answer
for broadcasting a template-cache update and a useless one for delivering a customer's reply.

This is not a plumbing gap. It is the same question SMS MO is parked on, and it has no answer that is
correct in every case:

- **Per-tenant phone numbers** would make attribution exact and are what Meta expects at scale, but
  they are a commercial and onboarding change (a number per workspace, each separately registered and
  verified), not an engineering one. Not available now.
- **Ask the consumer to identify themselves** (a keyword prefix) is technically exact and a product
  non-starter: nobody prefixes their reply with a workspace code.
- **Attribute by conversation** — the tenant that last spoke to this consumer — is what every
  aggregator on a shared identity actually does. It is right almost always and wrong in a specific,
  nameable case.

## Decision

**1. An inbound message is attributed to the tenant of the most recent OUTBOUND message to that
consumer, within the service window.** If no tenant messaged that number in the window, the message
is unattributable and is recorded as such — never guessed at, never silently assigned to the first
tenant on the WABA.

The window is not an arbitrary lookback: it is the same 24 hours Meta itself uses to decide whether
a business may reply at all. Outside it, there is no conversation for the message to belong to.

**2. State the failure mode rather than hide it.** Two tenants messaging the same consumer inside one
24-hour window will cross-attribute: the second tenant's outbound captures the conversation, and a
reply meant for the first is delivered to the second. Both tenants are legitimate senders to that
consumer, so no rule available to us distinguishes them. This is a **known limitation of the shared
WABA**, and the fix is per-tenant numbers, not a cleverer heuristic. It is recorded here so that the
next person to see a mis-delivered reply reads a decision rather than suspecting a bug.

**3. Attribution probes are READ-ONLY.** The vault's phone→subject mapping is tenant-scoped, so the
same number is a different `subject_id` per tenant. Attribution therefore resolves the consumer's
number against each candidate tenant — but with `findSubjectForPhone`, which looks up, not
`subjectForPhone`, which creates. Probing must not leave a data-subject row in every tenant on the
WABA; that would manufacture the appearance of a relationship that does not exist, and would expand
the blast radius of any later leak.

**4. The inbound row keeps no plaintext.** Same rule as `whatsapp_messages` and `email_messages`: the
sender's number is a `subject_id` surrogate and the body lives in `pii_vault`. A plaintext copy would
survive erasure — `pii-erasure.service.ts` clears the vault, and a column it does not know about
keeps the number after the customer asked us to forget it.

**5. Ingestion is idempotent on Meta's `wamid`.** Meta retries a webhook it believes failed, and a
retry must not produce a second inbound row, a second outbox event, or a second window extension.

**6. The service window is STORED, not derived.** It could be computed from the newest inbound row,
and storing it is still right: the window is what the send path must consult before allowing a
free-form message, and that check belongs on the hot path as one indexed read rather than an
aggregate over a growing table. It also gives the window a place to record WHY it is open once Meta's
categories (service / marketing / utility / authentication) start to differ.

## What this does not decide

**Free-form sends inside the window are not implemented here.** The window makes them legal; it does
not make them priced. A free-form reply is a *service conversation* in Meta's billing, a category
Fabric has no sell rate or margin floor for — and ADR 0014 §3 deliberately priced only the template
message. Shipping the send before the price would mean either charging the template rate for
something with a different cost, or serving a send we cannot cost, which ADR 0012's costability rule
forbids. It belongs with the WhatsApp commercial-offer work, not here.

That leaves the window doing something useful on its own: it is what attributes inbound, and it is
the state a support surface needs in order to show whether a customer can still be replied to.

## Consequences

- Inbound is only as good as the outbound that preceded it. A workspace that has never sent will
  never receive — correct under this rule, and worth saying out loud in the docs.
- Unattributable messages accumulate. They are recorded without a tenant so the volume is visible;
  a steady rate of them is evidence for the per-number migration, not noise to suppress.
- The moment per-tenant numbers exist, attribution becomes exact and this rule becomes a fallback for
  legacy shared traffic. Nothing here needs to be unwound to get there.
