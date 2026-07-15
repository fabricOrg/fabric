# Fabric Managed Messaging SDK - Final Contract

> Status: final design proposal - 2026-07-15 - Authoritative - Not implemented - ADR ratification
> required before schema or public API work

This third pass tests the SDK design against production failure modes rather than adding more
surface area. It refines [design iteration 2](./sdk-dx-iteration-2.md) with stronger guarantees for
money, idempotency, correlation, webhooks, privacy, contract generation, and long-running Journeys.
The direct SDK implemented today remains unchanged; see the
[current capability matrix](./README.md#current-api-capability-matrix).

The final pass has been consolidated into this document. Future changes to this contract require an
ADR amendment or a new ADR; they should not create another parallel SDK iteration document.

## Verdict

The three-level public model still holds:

```text
fabric.sms.send(...)             explicit channel message
fabric.messages.send(key, ...)   one managed delivery intent
fabric.journeys.start(key, ...)  one durable automation run
```

The third pass keeps that model and adds these production rules:

1. A managed delivery is accepted only after its definition version, route plan, durable
   idempotency record, initial channel attempts, and required initial wallet reservations commit.
2. Managed idempotency is stored with the delivery or Journey run, not only in the existing
   24-hour generic replay cache.
3. `reference` and bounded `metadata` provide business correlation; idempotency keys remain retry
   controls and must not be overloaded as searchable business data.
4. Webhooks become a typed, versioned union with required event IDs, environment, resource version,
   and explicit out-of-order semantics.
5. Published definitions are part of the data-plane read path. Sending never calls a dashboard or
   remote management service.
6. Generated contracts use a versioned manifest and a separately packaged, pinned CLI so generator
   changes cannot silently break the runtime SDK.
7. Raw variable payloads are minimized. Rendering and Journey execution store sensitive data only
   where required, through the PII vault and retention controls.
8. Multi-channel amplification, cost ceilings, and fallback funding are visible SDK semantics.

The acceptance and execution decisions are recorded in
[ADR 0006](../decisions/0006-managed-delivery-acceptance-and-execution.md).
The implementation sequence and complete vertical acceptance specifications are in the
[managed messaging SDK delivery backlog](./managed-messaging-sdk-backlog.md).

## Canonical public vocabulary

The final pass standardizes terms that currently drift across the beta SDK, API contracts, and
internal events:

| Concept | Canonical public value | Migration note |
| --- | --- | --- |
| Customer environment | `sandbox` or `live` | Change beta `fabric.environment === "production"` to `"live"` before 1.0 |
| API key prefix | `sk_test_` or `sk_live_` | Prefixes remain unchanged; `sk_test_` maps to sandbox |
| API-key environment field | `sandbox` or `live` | Public serializers stop exposing the storage-era `test` value |
| Managed operation | delivery | One business intent, potentially several attempts |
| Provider execution | attempt | Exactly one channel execution under a delivery |
| Automation execution | Journey run | May create several managed deliveries |
| Direct-message public events | `message.sent`, `message.delivered`, `message.undelivered`, `message.failed`, `message.inbound` | `sms.delivered` in the beta README is documentation drift |
| Managed public events | `message.delivery.*` | Distinct from direct channel-message events |
| Internal transition event | `message.updated` | Never exposed as the customer webhook contract |

`live` is preferred over `production` because it matches API-key prefixes, dashboard language, and
the application/environment architecture while avoiding confusion with Fabric's own deployment
environments.

All public IDs are opaque strings. SDK types may use aliases such as `MessageDeliveryId`, but
applications must not parse prefixes, infer resource types from an ID, or assume the underlying
database uses UUIDs. Documentation examples use values such as `delivery.id` rather than promising
`dlv_`, `msg_`, or `jrun_` formats.

Message and Journey keys are immutable, case-sensitive application contracts. New keys use lowercase
dot-separated namespaces with optional hyphens inside a segment, for example
`order.delivery-follow-up`. They are 1-100 characters and match:

```text
^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$
```

Keys cannot be renamed after creation. A semantic rename creates a new key and explicitly archives
the old one after callers migrate.

## Final resource contract

The response wrapper remains `FabricResponse<T>`. The managed resource is fully channel-neutral and
uses exact money strings:

```ts
type DeliveryStatus =
  | "accepted"
  | "processing"
  | "delivered"
  | "partially_delivered"
  | "undelivered"
  | "failed";

type DeliveryAttempt = {
  id: string;
  messageId: string;
  channel: "sms" | "email" | "whatsapp" | "voice";
  status:
    | "queued"
    | "sending"
    | "accepted"
    | "sent"
    | "delivered"
    | "undelivered"
    | "failed"
    | "expired";
  reasonCode: string | null;
};

type MessageDelivery = {
  id: string;
  messageKey: string;
  definitionVersion: number;
  environment: "sandbox" | "live";
  resolvedLocale: string;
  policy: "priority" | "fallback" | "broadcast";
  status: DeliveryStatus;
  reasonCode: string | null;
  reference: string | null;
  metadata: Readonly<Record<string, string>>;
  cost: {
    currency: "GHS" | "NGN" | "USD";
    reservedMinor: string;
    committedMinor: string;
    refundedMinor: string;
  };
  attempts: ReadonlyArray<DeliveryAttempt>;
  resourceVersion: number;
  createdAt: string;
  updatedAt: string;
};
```

`messageId` links an attempt to its direct channel-message resource. Callers still treat both IDs as
opaque. `reasonCode` explains a status without expanding the stable status union. Recipient
addresses, rendered content, raw variables, provider identifiers, and idempotency keys are absent
from the ordinary delivery response.

## HTTP and failure boundary

The SDK methods map to explicit v1 resources:

| SDK method | Wire contract | Success |
| --- | --- | --- |
| `messages.send(key, input, options)` | `POST /v1/message-deliveries` | `202 Accepted` |
| `messages.retrieve(id, options?)` | `GET /v1/message-deliveries/{id}` | `200 OK` |
| `messages.preview(key, input, options?)` | `POST /v1/message-definitions/{key}/preview` | `200 OK`, no side effects |
| CLI contract fetch | `GET /v1/message-definitions/catalog` | `200 OK` |

The required `Idempotency-Key` header is populated only from request options. An exact replay returns
the original delivery representation and original success status. A changed request returns `409
idempotency_conflict`; a concurrent in-flight request returns retryable `409
idempotency_in_flight` with `Retry-After`.

Errors split at the acceptance boundary:

- before acceptance, validation, authorization, missing release, route, locale, binding, compliance,
  cost ceiling, rate limit, kill-switch, and initial wallet failures throw structured SDK errors and
  create no delivery;
- after acceptance, provider, attempt-time approval, changed consent, fallback funding, and delivery
  failures update the durable delivery and arrive through retrieval/webhooks; they cannot be thrown
  back through the completed `send` call;
- caller timeout or cancellation can race acceptance and therefore means outcome unknown. Retrying
  with the same idempotency key is the recovery path.

The API writes the response request ID to the standard header and body envelope. The SDK exposes it
once through `FabricResponse.requestId`; it does not duplicate the request ID inside
`MessageDelivery`.

## Contract source of truth and versioning

Public wire DTOs live as Zod schemas in `@app/contracts`. OpenAPI is generated from the public API
contract, and the SDK maps wire `snake_case` into language-idiomatic models such as TypeScript
`camelCase`. The SDK does not import database row types or expose provider responses.

Contract parity tests must prove that API responses parse through the Zod schema and SDK mapper. A
field is not shipped by updating only the API controller, OpenAPI file, SDK interface, or dashboard;
all boundary representations and documentation change together.

The HTTP API remains `/v1`; webhook envelopes carry `apiVersion: "v1"`; generated definition
catalogs carry their own manifest schema version. These versions solve different compatibility
problems and must not be conflated.

Compatibility rules are:

- additive optional response fields and new unknown webhook event types are non-breaking;
- removing, renaming, or changing the meaning of a field/status is breaking;
- aggregate delivery statuses remain closed and stable; provider detail grows through reason codes;
- the SDK ignores safe unknown response fields but fails with `ApiShapeError` when required fields
  are missing or invalid;
- unknown webhook events remain verified and parseable through an explicit unknown-event variant;
- generated catalogs fail closed when their manifest needs a newer CLI/SDK contract version.

## Acceptance gate and attempt-time revalidation

The synchronous acceptance transaction and asynchronous worker have different responsibilities:

| Gate | Before `202 Accepted` | Before every provider attempt |
| --- | --- | --- |
| API key, scope, app/environment | Required | Bound identity reused; no client resubmission |
| Active immutable release | Resolve and pin | Pinned version reused |
| Payload, recipient, locale, route | Validate and snapshot | Snapshot reused |
| Kill-switch | Check before side effect | Recheck current/LKG state |
| Sender/provider binding | Must be known eligible | Recheck revocation and current eligibility |
| Consent, DND, quiet hours | Check current state | Recheck because the recipient may opt out after acceptance |
| Pricing and caller ceiling | Calculate | Recalculate only when a later fallback is created |
| Wallet | Reserve required initial attempts | Reserve later fallback just in time |
| Persistence | Delivery, attempts, ledger, idempotency, outbox commit | Attempt/status/ledger/outbox commit |

A failed attempt-time recheck prevents provider contact, resolves any reservation correctly, records
a stable reason code, and advances fallback only when the published policy permits it.

## Authorization contract

Human dashboard permissions and runtime API-key scopes are separate authorities:

| Actor | Proposed authority |
| --- | --- |
| Owner/admin | Read, draft, publish, promote, bind providers, inspect deliveries and Journeys |
| Member | Read and draft definitions; send/inspect according to existing membership permissions; no publish or live promotion |
| Developer access | Read definitions, generated-contract guidance, keys, logs, and delivery results; no send, draft, publish, or promotion |
| Runtime key with `messages:send` | Preview and execute released managed definitions only |
| Runtime key with `messages:read` | Retrieve managed delivery results only |
| Tooling key with `definitions:read` | Fetch keys/schemas for generation only |
| Future Journey runtime key | Start/read released Journey runs only |

The backend enforces every permission. The dashboard may hide unavailable controls but is never the
authorization boundary. Definition and Journey management BFF routes must resolve application and
environment from the authenticated workspace selection and verify containment server-side. The
current tenant token's null application/environment context cannot authorize a client-supplied ID
without that containment check.

## Third-pass findings

| Finding | Why it matters | Decision |
| --- | --- | --- |
| Generic idempotency expires after 24 hours | A delayed retry could start a second delivery or Journey | Persist a hashed key and canonical request hash on the durable resource |
| Existing idempotency uniqueness is tenant-wide | Two applications can collide on a reasonable key | Scope by tenant, application, environment, operation, and key hash |
| Existing fingerprint uses ordinary `JSON.stringify` | Object key order and omitted defaults can produce unstable comparisons | Hash the normalized, validated request with canonical serialization |
| `accepted` did not promise funding | An accepted broadcast could immediately fail for balance | Reserve required initial funds before acknowledgement |
| Fallback can require money later | Reserving every possible fallback locks funds unnecessarily | Reserve fallback attempts just in time and expose that residual risk |
| Idempotency is not business correlation | It should be opaque, private, and reusable only for retries | Add bounded `reference` and metadata fields |
| Current webhook generic lets callers assert any payload type | Signature verification does not prove a caller-supplied TypeScript type | Return an SDK-owned discriminated union plus an unknown-event fallback |
| Webhooks are at-least-once and may arrive out of order | Processing arrival order can regress customer state | Include per-resource version and make retrieval canonical |
| Code generation can drift from the installed SDK | A newer schema feature can generate types an older SDK cannot use | Version the catalog manifest and fail generation on incompatibility |
| Broadcast and Journeys amplify one API request | Rate and spend controls based only on request count are insufficient | Enforce attempt, step, payload, and cost bounds server-side |

## Final target DX

The common path remains short. Advanced safety fields are optional and do not obscure first use:

```ts
import { Fabric } from "@fabric-messaging/sdk";
import type { FabricCatalog } from "./fabric.generated.js";

const fabric = new Fabric<FabricCatalog>({
  apiKey: process.env.FABRIC_API_KEY!,
});

const result = await fabric.messages.send(
  "order.shipped",
  {
    recipient: {
      phone: "+233201234567",
      email: "ama@example.com",
    },
    data: {
      customerName: "Ama",
      orderReference: "ORD-123",
      eta: "4 PM",
    },
    locale: "en-GH",
    reference: "ORD-123",
    metadata: {
      source: "checkout",
    },
    limits: {
      maxCost: { minor: "150", currency: "GHS" },
    },
  },
  {
    idempotencyKey: "order.shipped:01J2Y8...",
  },
);

console.log(result.data.id, result.data.status, result.requestId);
```

The design keeps `FabricResponse<T>` rather than introducing hidden response metadata on domain
objects. The `.data` access is slightly more verbose, but request ID, retry count, and HTTP status
stay explicit and consistent across every resource and future language SDK.

Before 1.0, split execution options so reads and previews cannot accidentally carry meaningless
idempotency headers:

```ts
interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  headers?: Readonly<Record<string, string>>;
}

interface WriteOptions extends RequestOptions {
  idempotencyKey?: string; // Existing direct beta writes remain backward-compatible.
}

interface IdempotentWriteOptions extends RequestOptions {
  idempotencyKey: string; // Required by managed send and Journey start.
}
```

`messages.send` accepts `IdempotentWriteOptions`; `messages.retrieve` and `messages.preview` accept
`RequestOptions`. The transport continues to block overriding authorization, user-agent, and
idempotency headers through the free-form header map.

Direct messages remain available and do not require definitions or generation:

```ts
await fabric.sms.send(
  {
    to: "+233201234567",
    senderId: "Fabric",
    body: "Your order has shipped.",
  },
  { idempotencyKey: "direct-sms:01J2Y8..." },
);
```

## Input contract

The managed input has distinct responsibilities:

| Field | Responsibility |
| --- | --- |
| `recipient` | Inline address set; stored recipient ID is a future exclusive alternative |
| `data` | Definition variables, validated against a closed schema |
| `channel` | Optional hard constraint; omission delegates to the released policy |
| `locale` | Optional explicit locale; omission uses the definition default |
| `reference` | Optional non-sensitive business correlation value |
| `metadata` | Optional bounded non-sensitive search and webhook context |
| `limits.maxCost` | Optional total reservation ceiling for this delivery |
| request `idempotencyKey` | Required retry identity, never content or search metadata |
| request `signal` and `timeout` | Local waiting controls; cancellation does not undo acceptance |

Fabric never infers locale from a telephone country code or email domain. A definition declares an
explicit default and any allowed fallback chain. The resolved locale is recorded on the delivery.

Initial public bounds should be deliberately small:

- request body: 32 KiB after JSON encoding;
- `reference`: 100 characters;
- metadata: at most 10 string pairs, keys up to 40 characters, values up to 200 characters;
- no nested metadata, reserved `fabric.*` keys, or sensitive values;
- variable objects closed by default and arrays bounded by their stored schema;
- at most four channel attempts for one managed delivery.

These limits reduce accidental PII storage and prevent one request from causing unbounded work. A
future bulk API uses a separate resource and limits rather than increasing this send contract.

## Acceptance and wallet semantics

`accepted` has a precise meaning: Fabric durably committed the delivery, resolved immutable
definition version, route plan, idempotency identity, planned initial attempts, required initial
wallet reservations, and acceptance outbox event. No provider call is required before the API
responds.

The wallet posture depends on policy:

| Policy | Reservation before `accepted` | Later behavior |
| --- | --- | --- |
| One channel / priority | Selected attempt | Worker sends the funded attempt |
| Fallback | First attempt only | Each next attempt reserves just in time before provider contact |
| Broadcast | All planned attempts atomically | No broadcast starts unless all planned attempts are funded |

This is an intentional trade-off. Reserving every possible fallback upfront would guarantee funds
but could lock money for attempts that are never needed, especially across long provider timeouts.
Just-in-time fallback reservation minimizes held funds but means a later fallback can end with
`insufficient_balance`. That failure is recorded on the attempt and aggregate delivery.

`limits.maxCost` protects a caller from an unexpectedly expensive definition or route change. It
caps the delivery's committed amount plus currently held reservations. A refunded, non-billable
attempt releases that capacity for a fallback. If the initial plan exceeds the ceiling, the API
rejects before acceptance. If a later fallback would exceed it, Fabric does not start that attempt
and records `cost_limit_exceeded`.

Every reservation, commit, and refund retains its existing deterministic ledger reference. A
delivery-level cost summary uses exact minor-unit strings:

```ts
interface DeliveryCost {
  currency: "GHS" | "NGN" | "USD";
  reservedMinor: string;
  committedMinor: string;
  refundedMinor: string;
}
```

One delivery uses one billing currency. Cross-currency routing is outside this contract. Preview
returns an estimate; send recalculates and enforces current pricing before reserving.

## Durable idempotency

The current generic API idempotency layer remains valid for existing direct endpoints, including its
documented replay window. New managed deliveries and Journey runs require stronger resource-level
deduplication.

For each managed write, Fabric stores:

- an HMAC or cryptographic hash of the caller's idempotency key, never a loggable raw value;
- tenant, application, environment, and operation scope;
- a canonical hash of the normalized, validated input, including applied defaults;
- the created delivery or Journey run ID;
- creation time and terminal state.

A unique constraint on `(tenant, application, environment, operation, key_hash)` arbitrates
concurrent requests. The durable identity remains for at least as long as the resource's audit
retention, so retry safety does not silently disappear after 24 hours.

Replay behavior is deterministic:

- same scope, key, and normalized request returns the original resource;
- same scope and key with different input returns `idempotency_conflict`;
- a request racing an in-flight transaction returns retryable `idempotency_in_flight` with
  `Retry-After`;
- validation, authorization, release-readiness, or initial funding failures create no delivery and
  may be corrected and retried with the same key;
- after a delivery exists, worker or provider failures never release its idempotency identity.

The SDK may automatically retry `idempotency_in_flight`, connection errors, rate limits, and
selected server errors because the same key is preserved. Timeout or caller cancellation still
means outcome unknown; retry with the same key or retrieve the known resource.

## Business correlation

Idempotency and correlation solve different jobs:

- `idempotencyKey` prevents duplicate side effects and is not returned, searched, or sent in
  webhooks;
- `reference` is an optional opaque customer value displayed in logs and returned in webhooks;
- `metadata` carries a small amount of non-sensitive operational context.

Neither field changes idempotency. References are not globally unique because one order may produce
several legitimate communications. Search is scoped to the API key's application and environment.
Fabric rejects values that violate documented limits and warns customers not to place names, phone
numbers, emails, message bodies, access tokens, or payment details in them.

## Routing and aggregate state

The conservative routing decision from iteration 2 is carried forward:

- priority chooses the first eligible channel during planning;
- fallback advances only after a pre-provider-acceptance submission failure;
- broadcast intentionally starts every eligible channel;
- a later carrier `undelivered` report does not silently trigger another channel.

Retries of one provider attempt reuse its stable channel-message ID so they cannot create a second
attempt. A new fallback channel receives a distinct attempt and channel-message ID under the same
delivery.

Aggregate status is derived, never independently guessed:

| Status | Meaning |
| --- | --- |
| `accepted` | Durable, initially funded, and available for worker execution; no provider outcome is implied |
| `processing` | At least one attempt is active or awaiting a terminal provider outcome |
| `delivered` | Policy satisfied by required delivered attempts |
| `partially_delivered` | Broadcast completed with some, but not all, required attempts delivered |
| `undelivered` | Provider-reached attempts completed without satisfying delivery |
| `failed` | Configuration, platform, compliance, cost, or provider-submission failure prevented completion |

Attempt status and a stable `reasonCode` explain the aggregate. New detailed reason codes are
additive; Fabric avoids expanding the small aggregate status union for every provider condition.

## Typed webhook contract

The current `webhooks.verify<T>()` generic can make an unchecked caller-supplied assertion after
signature verification. Before 1.0, replace that generic result with an SDK-owned discriminated
union while retaining unknown event compatibility:

```ts
const event = fabric.webhooks.verify({
  payload: rawBody,
  signature: request.headers["fabric-signature"],
  secret: process.env.FABRIC_WEBHOOK_SECRET!,
});

switch (event.type) {
  case "message.delivery.delivered":
    console.log(event.data.deliveryId, event.data.messageKey);
    break;
  case "message.delivery.failed":
    console.error(event.data.reasonCode);
    break;
  default:
    // A valid event from a newer Fabric version remains parseable.
    break;
}
```

Every managed event has required envelope fields:

```ts
interface WebhookEnvelope<TType extends string, TData> {
  id: string;
  type: TType;
  createdAt: string;
  environment: "sandbox" | "live";
  apiVersion: "v1";
  resourceVersion: number;
  data: TData;
}
```

Initial managed event types are:

- `message.delivery.accepted`;
- `message.delivery.delivered`;
- `message.delivery.partially_delivered`;
- `message.delivery.undelivered`;
- `message.delivery.failed`.

Events include delivery ID, key, definition version, reference, non-sensitive metadata, status,
cost summary, attempt summaries, and Journey run/step IDs when applicable. They exclude recipient
addresses, rendered content, raw variables, idempotency keys, and provider credentials.

Delivery is at-least-once. Events can be duplicated or arrive out of order across retries and
endpoints. Consumers deduplicate by event ID and apply a delivery event only when
`resourceVersion` exceeds the locally processed version. `messages.retrieve(deliveryId)` remains the
canonical recovery path when event history is incomplete or ordering is uncertain.

Webhook endpoint creation should eventually support event filters, but filter configuration is a
management concern and does not alter event verification.

## Published definitions in the data plane

Managed sending cannot depend on dashboard availability. Publishing writes an immutable definition
version and environment release into the same durable platform data available to the send path.
The API resolves that release inside the delivery transaction; it never calls a separate control
plane or provider template-management API during a request.

An in-process or Redis cache may accelerate immutable version reads. Postgres remains authoritative,
and cache failure falls back to the durable release. Provider approval and sender state may use
short-lived cached last-known-good values, but Fabric never invents approval when no known-good
state exists. Compliance rules use their documented fail-closed posture, and the wallet reservation
always fails closed. Ordinary control-plane cache failure must not stop sends when valid
last-known-good state is available.

A send racing a promotion resolves either the old complete release or the new complete release,
never a mixture. Once accepted, the delivery retains its resolved content version. Operational
safety gates are still evaluated at attempt time: a sender revoked after acceptance must block the
provider call even though content remains pinned.

## Code generation and CLI compatibility

Code generation should ship in a separate CLI package so the server SDK stays small and has no
command-line dependency tree:

```bash
pnpm add -D @fabric-messaging/cli
pnpm exec fabric definitions generate --output src/fabric.generated.ts
pnpm exec fabric definitions check --input src/fabric.generated.ts
```

Teams pin the CLI version in `devDependencies`; CI does not execute an unpinned remote package. The
CLI uses a `definitions:read` key and cannot publish, promote, send, or read message content.

The contract endpoint returns a manifest containing:

- manifest schema version;
- application and environment identity in non-secret display form;
- sorted message and Journey contracts;
- compatibility digest;
- minimum compatible SDK and CLI contract versions.

The generated file contains the manifest version and digest but no generation timestamp. A CLI that
cannot represent the manifest fails with `unsupported_catalog_schema` and upgrade guidance. It must
not emit weakened `any` types as a fallback.

`definitions check` distinguishes:

- local file differs from the environment release;
- release contains a breaking input change;
- installed CLI or SDK contract version is incompatible;
- key lacks definition-read authority.

Generated TypeScript remains optional. Runtime validation rejects unknown keys and fields even when
structural typing, stale output, JavaScript, or another language bypasses compile-time checks.

## Preliminary threat review

| Threat | Protected asset | Required mitigation |
| --- | --- | --- |
| Stolen runtime key changes customer messaging | Content, routing, reputation, spend | Runtime keys cannot draft, publish, promote, bind providers, or expand scopes |
| Cross-tenant or cross-application key use | Customer data and wallet | Possession-scoped key resolution, app/environment binding, FORCE RLS, and containment tests |
| Template or variable injection | Recipient safety and provider credentials | Non-executable renderer, closed schemas, contextual escaping, bounded output, no template-time fetch |
| Broadcast or Journey amplification | Wallet and platform capacity | Cost ceiling, attempt/step/run limits, attempt-aware rate controls, kill-switches |
| Forged or replayed webhook | Customer downstream state | HMAC over raw body and timestamp, bounded tolerance, event-ID dedupe, resource-version ordering |
| Stale sender/provider approval | Compliance and deliverability | Short-lived known-good cache; no approval invented on cache miss; attempt-time recheck |
| Sensitive values in metadata or errors | PII and secrets | Strict flat limits, documented prohibition, server redaction, values omitted from validation errors |
| Delayed retry creates a duplicate | Customer experience and money | Durable scoped idempotency tied to the resource and deterministic internal step keys |

Residual risk remains when customers deliberately place sensitive data in permitted free-form
strings. Documentation, UI guidance, detection for obvious secret patterns, access control, and
retention minimize that risk; Fabric must not claim metadata is a secure secret store.

## Privacy, rendering, and abuse controls

Managed message `data` can contain PII. Fabric should not persist the raw variable object merely for
developer convenience. For a one-step delivery, persist the schema/version reference and encrypted
rendered channel content required for delivery and audit retention. Discard transient variables
after rendering unless a documented feature requires them.

A Journey may need variables after waits. Store the minimum required encrypted payload through the
PII vault, associate it with the Journey retention policy, and delete it independently of the
non-PII run audit trail. Dashboard logs show masked recipient information and do not expose raw
variables by default.

The renderer is deliberately non-executable:

- portable closed variable schema;
- bounded render time, output size, nesting, and collection length;
- context-aware escaping for email HTML and future rich channels;
- explicit SSML rules for voice;
- validated media URLs and no server-side URL fetch during template evaluation;
- no arbitrary JavaScript, remote schema references, includes, or user-defined code;
- field-level errors contain paths and codes, never rejected values.

Broadcast and Journeys enforce amplification limits in addition to API request rate limits. The
first Journey runtime has no loops, one recipient per run, bounded steps, bounded waits, and a
maximum delivery count. A rate-limit decision must account for attempted channel work, not only the
single incoming SDK request.

## Journey implications

The public Journey call remains small:

```ts
const run = await fabric.journeys.start(
  "order.delivery-follow-up",
  {
    recipient: { phone },
    data,
    reference: "ORD-123",
  },
  { idempotencyKey: "journey:order-follow-up:01J2Y8..." },
);
```

The run snapshots the semantic message releases referenced by its published graph. It does not
freeze operational permission, sender approval, consent, wallet balance, kill-switch, or price;
those safety gates are evaluated when each step executes.

Journey idempotency is durable like managed delivery idempotency. A Journey send step derives a
deterministic internal idempotency key from run ID and step execution ID, so worker retries cannot
create another delivery. A legitimate second execution of the same graph node, if loops are ever
introduced, must have a distinct execution ID.

Journey-level cost and delivery limits are defined on the published Journey version and may be
further constrained by the start request in a later iteration. They must exist before loops,
multi-recipient entry, or live execution.

## Compatibility and migration

The current SDK is beta, but migration should still be deliberate:

- direct resources remain source-compatible;
- `messages` is introduced as a new managed resource and does not change `sms.list` semantics;
- the dedicated wire resource remains `/v1/message-deliveries` during migration;
- existing channel webhooks remain valid; managed delivery events are new types;
- the caller-supplied webhook payload generic is deprecated and replaced before 1.0;
- aggregate statuses are intentionally small and stable; provider detail grows through reason codes;
- additive response fields are tolerated by SDK parsers and unknown webhook events remain parseable.

The package name `@fabric-messaging/sdk` does not block this architecture. Whether Fabric adopts a
broader package name before 1.0 is a product/distribution decision and should be resolved before
payments or identity become first-class SDK resources. It is not a reason to delay managed
messaging.

## Prioritized implementation plan

### P0 - Lock semantics before schema work

- accept ADRs 0005 and 0006;
- finalize delivery, attempt, cost, reason-code, webhook, reference, and metadata contracts;
- define canonical request normalization and durable idempotency uniqueness;
- threat-model managed send, preview, generator, and webhook entry points;
- specify aggregate status and fallback state-machine tests.

Exit gate: contracts can represent one channel, fallback, broadcast, and Journey-originated sends
without nullable-field ambiguity or provider identifiers.

### P1 - Managed SMS acceptance spine

- persist application definitions, immutable versions, environment releases, deliveries, and
  attempts under FORCE RLS;
- perform validation, route planning, SMS reservation, delivery creation, and outbox insert in the
  correct transaction boundaries;
- dispatch through the existing SMS engine with deterministic message IDs;
- add retrieve and terminal delivery events;
- expose reference, metadata, exact cost, and request ID in logs.

Exit gate: concurrent same-key requests create one funded delivery; a crash after acceptance is
recoverable by a production worker; every ledger movement reconciles.

### P2 - Preview and generated contracts

- share schema validation, rendering, eligibility, and pricing with send without side effects;
- ship the versioned contract manifest and separately packaged CLI;
- add generated client typing and CI drift checks;
- add SDK-owned webhook unions and unknown-event handling.

Exit gate: preview cannot reserve/send; stale and widened clients fail safely at runtime; older SDKs
do not crash on a valid unknown event.

### P3 - Multi-channel and Journey proof

- add a second managed channel after its real provider and approval path exists;
- prove just-in-time fallback funding, atomic broadcast funding, cost ceilings, and aggregate status;
- let the first sandbox Journey send node create a managed delivery with deterministic step
  idempotency;
- add run-to-delivery observability and out-of-order event recovery tests.

Exit gate: one unchanged `messages.send` call works across two channels, and one retried Journey step
cannot duplicate a message or ledger movement.

## Release-blocking acceptance criteria

The managed SDK must not ship live until all of these are true:

- acceptance means durable, recoverable, and initially funded;
- durable idempotency survives beyond the generic HTTP replay cache and is concurrency-tested;
- wallet, sender, environment, compliance, and kill-switch failure postures are tested explicitly;
- webhook duplicates and out-of-order delivery cannot regress customer state;
- raw variables, recipient addresses, content, and idempotency keys do not leak into ordinary logs,
  generated files, metadata, errors, or webhook payloads;
- cost ceilings and amplification bounds prevent a definition or Journey from creating unbounded
  spend or work;
- sandbox is unable to select a live binding or provider;
- runtime keys cannot publish, promote, bind providers, or expand their own authority;
- direct SMS remains usable without templates, catalogs, Journeys, or new scopes;
- SDK, API, dashboard, CLI, contracts, migrations, worker trigger, and real-Postgres tests ship as
  coordinated vertical slices rather than disconnected capability code.

## Non-goals retained

- synchronous delivery guarantees or `sendAndWait` in the first SDK;
- automatic fallback after a late `undelivered` report;
- arbitrary workflow execution, loops, or client-side Journey evaluation;
- bulk recipients hidden inside `messages.send`;
- provider template IDs in ordinary application code;
- raw data retention for debugging convenience;
- CLI publication using a runtime send key;
- hiding an incompatible generated schema behind `any`.
