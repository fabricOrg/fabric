# Managed messaging SDK DX — first iteration

> Status: historical proposal · Product direction agreed 2026-07-15 · Refined by
> [SDK DX design iteration 2](./sdk-dx-iteration-2.md) · Not yet implemented

This document defines the first product and developer-experience contract for sending reusable,
multi-channel messages through Fabric. It is a target contract, not a description of the current
SDK. Today, the SDK supports direct SMS through `fabric.sms.send`; see the
[SDK capability matrix](./README.md#current-api-capability-matrix).
For sequencing and architecture diagrams, see the
[Managed messaging and Journeys architecture plan](./managed-messaging-architecture-plan.md).

## Outcome

Fabric should let a business user manage message content in the dashboard while giving a developer
a stable, compile-time-safe contract in code. An application sends a business intention such as
`order.shipped`; Fabric renders the published definition, applies its delivery policy, and records
which version and channel were used.

The intended division of responsibility is:

- business teams own wording, channel variants, translations, and draft publication;
- developers own stable message keys, payload data, recipients, and idempotency;
- Fabric owns validation, rendering, channel eligibility, delivery, retries, and observability.

This is **intent-aware messaging and automation**, not a general-purpose workflow engine. A managed
message handles one reusable delivery intent. A Journey handles a bounded messaging automation that
can call one or more managed messages over time.

## Progressive SDK experience

The SDK must support three levels without making the first successful send depend on templates or
code generation.

| Level | Contract | Use case |
| --- | --- | --- |
| Direct | `fabric.sms.send(...)` | One-off, migrated, or fully dynamic SMS |
| Managed | `fabric.messages.send("order.shipped", ...)` | Reusable, versioned application messages |
| Routed | The same `messages.send` call with a delivery policy | Priority, fallback, or broadcast across channels |
| Automated | `fabric.journeys.start("order.delivery", ...)` | Dashboard-authored multi-step messaging automation |

Direct channel APIs remain public. Managed messaging is additive and must not force existing SMS
integrations to migrate.

## Message definition

A **message definition** is an application-scoped, environment-scoped contract with:

- an immutable stable key, for example `order.shipped`;
- a human-readable name and description;
- a variable schema with required fields, types, descriptions, and optional example values;
- one or more channel variants: initially SMS, later WhatsApp, email, and voice;
- optional locale variants with an explicit default locale;
- an immutable published version and a mutable draft;
- an optional delivery policy limited to priority, fallback, or broadcast;
- channel configuration such as sender identity, subject, or voice profile.

The stable key is the integration contract. Database IDs and provider template IDs are internal and
must not appear in normal application code. A published version is immutable; editing creates a new
draft. Sending resolves only a published version from the API key's application and environment.

The current `sms_templates` resource is an SMS content primitive. It should evolve behind this
channel-neutral model rather than become the public multi-channel SDK abstraction.

## Journey definition

A **Journey** is an application-scoped, environment-scoped automation definition. It is authored in
the dashboard Journeys canvas and executed by Fabric. The SDK never downloads the graph and never
runs journey logic client-side.

A Journey has:

- an immutable stable key, for example `order.delivery_followup`;
- a trigger contract, initially an explicit SDK start or a named API event;
- a variable schema shared by every step in the graph;
- nodes for sends, waits, replies, delivery-result branches, conditions, goals, and terminal states;
- send nodes that reference managed message definitions or inline draft content during authoring;
- immutable published versions and mutable drafts;
- an execution policy for idempotency, timeout, retry, and failure handling;
- run logs that record every step, selected message version, selected channel, and delivery result.

This gives the hidden Journeys page a clear product role: it is the visual authoring surface for
Fabric-owned messaging automations. It should graduate from localStorage preview into persisted
draft/publish/run state only when the backend execution engine exists.

The first execution model should be intentionally narrow:

- explicit SDK/API start only; no broad event ingestion platform;
- SMS send, wait, branch-on-delivery, and end nodes only;
- sandbox execution first, with live execution behind the same wallet, sender, compliance, and
  kill-switch gates as direct sends;
- one recipient per Journey run in the first slice;
- durable server-side scheduling and retries before any live publish action is enabled.

WhatsApp, voice, email, inbound-message triggers, contact-list entry triggers, loops, and complex
conditions can remain visible in the mock canvas as future design exploration, but they should not
be published or executable until their channel/runtime primitives are real.

## TypeScript target contract

The developer generates a local catalog from the definitions published for an application and
environment:

```bash
pnpm fabric messages generate
```

The generated file represents message keys and payload schemas:

```ts
export interface FabricMessages {
  "order.shipped": {
    customerName: string;
    orderReference: string;
    eta: string;
  };

  "payment.received": {
    customerName: string;
    amountMinor: string;
    reference: string;
  };
}
```

Application code supplies that catalog to the client:

```ts
import { Fabric } from "@fabric-messaging/sdk";
import type { FabricMessages } from "./fabric.generated";

const fabric = new Fabric<FabricMessages>({
  apiKey: process.env.FABRIC_API_KEY!,
});

const result = await fabric.messages.send("order.shipped", {
  to: {
    phone: "+233201234567",
    email: "ama@example.com",
  },
  data: {
    customerName: "Ama",
    orderReference: "ORD-123",
    eta: "4 PM",
  },
  idempotencyKey: `order.shipped:${order.id}`,
});
```

The generic `send` method must autocomplete known keys and their payloads. TypeScript must reject a
missing required variable, an unknown variable, or an invalid variable type. Fabric must also
validate the payload at runtime because generated clients can be stale and other languages may not
provide compile-time checks.

Do not generate one SDK method per message definition. A typed generic keyed by the generated
catalog keeps the SDK stable while tenant-defined contracts change independently.

## Automation target contract

Journey SDK calls follow the same generated-catalog pattern as managed messages. A generated catalog
contains both message definitions and journey definitions:

```ts
export interface FabricJourneys {
  "order.delivery_followup": {
    customerName: string;
    orderReference: string;
    eta: string;
  };
}
```

Application code starts a published Journey by stable key:

```ts
const run = await fabric.journeys.start("order.delivery_followup", {
  recipient: {
    phone: "+233201234567",
    email: "ama@example.com",
  },
  data: {
    customerName: "Ama",
    orderReference: "ORD-123",
    eta: "4 PM",
  },
  idempotencyKey: `order.delivery_followup:${order.id}`,
});
```

The response should identify the run rather than a single message:

```ts
{
  id: "jrun_...",
  requestId: "req_...",
  journeyKey: "order.delivery_followup",
  journeyVersion: 3,
  status: "accepted"
}
```

Developers should also be able to inspect a run:

```ts
const run = await fabric.journeys.retrieve("jrun_...");
```

Preview remains no-send and no-charge. For a Journey, preview validates the trigger payload and
returns the planned path for deterministic steps plus channel previews for send nodes. It must mark
runtime-only decisions, such as delivery-result branches or wait-for-reply paths, as unresolved.

```ts
const preview = await fabric.journeys.preview("order.delivery_followup", {
  recipient: { phone: "+233201234567" },
  data,
});
```

Journey start is not a replacement for direct sends. It exists for business-owned automations where
the dashboard needs to own timing, branching, content, and observability.

## Recipients and channel selection

`to` describes an addressable recipient, not an SMS-only phone number. The first contract may accept
inline channel addresses; a later user-profile resource can allow a stable recipient ID.

When the caller omits `channel`, Fabric applies the published delivery policy. A caller may constrain
delivery when the business operation requires one channel:

```ts
await fabric.messages.send("order.shipped", {
  to: { phone: "+233201234567" },
  data,
  channel: "sms",
  idempotencyKey,
});
```

Fabric must never silently invent a destination or use a channel that the definition, environment,
recipient, or compliance state makes ineligible. Routing decisions must be visible in the response
and message logs.

## Preview before delivery

Developers need a no-send, no-charge path using the same renderer and validation rules as delivery:

```ts
const preview = await fabric.messages.preview("order.shipped", {
  channel: "sms",
  locale: "en-GH",
  to: { phone: "+233201234567" },
  data: {
    customerName: "Ama",
    orderReference: "ORD-123",
    eta: "4 PM",
  },
});
```

For SMS, preview should return the rendered content, encoding, segment count, estimated cost,
selected sender ID, sender approval state, and deliverability blockers. Other channels add their own
typed preview details. Preview never contacts a provider and never reserves wallet funds.

## Responses and errors

A successful managed send should identify the exact decision Fabric made:

```ts
{
  id: "msg_...",
  requestId: "req_...",
  messageKey: "order.shipped",
  definitionVersion: 4,
  selectedChannel: "sms",
  status: "accepted"
}
```

Failures use the existing structured SDK error hierarchy and stable public codes. The first
iteration needs actionable distinctions for:

- unknown message key;
- no published version in this environment;
- payload validation failure, including field-level issues;
- requested channel unavailable or recipient address missing;
- sender approval or compliance block;
- insufficient wallet balance;
- idempotency conflict.

Every API error includes a request ID and must not expose credentials or message content.

## Dashboard and CLI contract

Every message-definition page should expose a **Use in code** panel containing its stable key,
environment, published version, variables, and copyable SDK examples. Draft preview and sandbox test
send should be available on the same surface.

The planned CLI surface is:

```text
fabric messages generate
fabric messages diff
fabric messages preview <key>
fabric messages test <key>
fabric messages publish <key>
fabric journeys generate
fabric journeys diff
fabric journeys preview <key>
fabric journeys test <key>
fabric journeys publish <key>
```

`generate` writes deterministic output suitable for source control. `diff` and CI detect when the
checked-in catalog is stale. Publishing must flag a newly required variable, removed variable, or
type change as a breaking contract change. Content-only edits remain non-breaking.

## Environment and production safety

- The API key determines workspace, application, and environment; the SDK must not accept a second
  setting that can contradict it.
- Sandbox definitions and sends cannot reach live providers.
- Live delivery requires the existing sender, compliance, wallet, and kill-switch gates.
- Idempotency is first-class and retained across SDK retries. Documentation should treat a stable
  key as required for production business actions even if the initial API remains backward-compatible.
- Rendering happens server-side from an immutable published version. Clients do not download and
  render templates before sending.
- The send record and webhook events carry the message key, definition version, selected channel,
  and attempt history for reconciliation.

## First implementation slice

The first vertical slice proves the contract with **managed SMS only** while preserving the
channel-neutral boundary:

1. Introduce application/environment-scoped message definitions, typed variable schemas, drafts,
   and immutable published versions.
2. Add public retrieve/list, preview, and send-by-key API contracts; validate all boundary payloads
   with Zod and render on the server.
3. Add `fabric.messages.send` and `fabric.messages.preview` to the TypeScript SDK.
4. Add deterministic TypeScript catalog generation and a CI drift check.
5. Add the dashboard definition editor, publish action, preview, sandbox test, and Use-in-code panel.
6. Record key, version, rendered SMS metadata, cost, and delivery result in existing message logs.
7. Test tenant and environment isolation, incompatible payload rejection, publication immutability,
   idempotent sends, and sandbox non-delivery against real Postgres.

The first Journey slice should follow after managed SMS is real:

1. Promote the current Journeys canvas schema into `@app/contracts` as a discriminated union, but
   expose only executable node kinds in persisted/published versions.
2. Persist Journey drafts and immutable published versions under tenant, application, and
   environment RLS.
3. Add `fabric.journeys.start`, `fabric.journeys.preview`, and `fabric.journeys.retrieve` for
   explicit SDK-started runs.
4. Execute a narrow graph: trigger -> managed SMS -> wait -> delivery-result branch -> managed SMS
   or end.
5. Store durable run/step state, idempotency, scheduled wakeups, and retry decisions in Postgres,
   with a production worker/cron trigger.
6. Show run status and step logs from the dashboard Journey page and message logs.
7. Keep Publish disabled for live environments until the execution worker, wallet reservation path,
   sender/compliance gates, and failure recovery tests are all present.

WhatsApp, email, voice, recipient profiles, localization automation, inbound triggers, contact
triggers, loops, and cross-channel fallback are follow-on implementations. Their future needs shape
the contracts now, but they do not expand the first executable slices.

## Non-goals

- A generic event bus or arbitrary workflow/automation engine.
- Client-side Journey execution or SDK-side graph interpretation.
- Client-side template rendering.
- Provider template identifiers as the developer-facing contract.
- Opaque UUIDs or untyped `Record<string, string>` payloads in normal SDK usage.
- Requiring code generation for direct first-send success.
- Adding a channel before its public API and real delivery path exist.
- Enabling live Journey publishing before durable scheduling, idempotency, wallet safety, and
  compliance gates are implemented.

## Acceptance criteria for the DX

The managed-message first iteration is successful when:

- a developer can send a direct sandbox SMS without creating a definition;
- a developer can select a dashboard-created message key through IDE autocomplete;
- invalid variables fail at compile time in TypeScript and at runtime in every client;
- preview reports the same rendered SMS and segmentation used by send without charging or delivering;
- a content editor can change and publish wording without requiring an application deployment;
- a breaking variable-schema change is clearly identified before publication and in CI;
- logs and responses explain which definition version and channel produced every delivery;
- the abstraction can add WhatsApp, email, and voice without changing the application-level message
  key or introducing a second sending model.

A later Journey iteration is successful when:

- a developer can start a published sandbox Journey by stable key and inspect the resulting run;
- the Journeys page can preview and publish only node kinds that have a real backend execution path;
- every Journey run records the published version, step outcomes, scheduled waits, and messages it
  created.

## Design influences

This direction combines established ideas rather than copying one provider's abstraction:

- [Resend template variables](https://resend.com/docs/dashboard/templates/template-variables) —
  typed variables, fallbacks, tests, and explicit publication;
- [Courier sending overview](https://www.courier.com/docs/platform/sending/sending-overview) — one
  send surface across templates, routing, retries, and logs;
- [Novu workflow concepts](https://docs.novu.co/platform/concepts/workflows) — stable identifiers
  and environment-aware definitions;
- [Knock template variables](https://docs.knock.app/template-editor/variables) — managed variables
  and controlled content evolution.

Fabric's intended differentiation is the combination: dashboard-authored content, generated
compile-time contracts, channel-neutral delivery, and reliability/compliance visibility suited to
West African messaging.
