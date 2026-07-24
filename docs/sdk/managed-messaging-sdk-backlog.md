# Managed Messaging SDK Delivery Backlog

> Status: proposed delivery backlog - 2026-07-15 - Based on the
> [final SDK contract](./sdk-dx-iteration-3.md) - No item is complete until its complete vertical
> capability is functional, triggered, observable, documented, and tested

## Four-pass refinement record

This backlog has been refined through four explicit quality passes. The pass records are part of
the specification: later ticket decomposition must preserve the decisions and gates recorded here.

| Pass | Lens | Defects found | Changes incorporated |
| --- | --- | --- | --- |
| 1 | Product value and actionability | Outcome evidence was implicit; parallel sequencing was unclear; future channels promised Journey integration without depending on Journeys | Added measurable outcome evidence, release increments, dependency corrections, and an implementation-work-package rule |
| 2 | Architecture, data, security, and operations | Cross-cutting invariants were repeated unevenly; availability and data lifecycle ownership needed explicit gates | Added invariant, data-lifecycle, threat-model, operational-readiness, and failure-posture requirements |
| 3 | SDK developer experience | Public-surface completeness and compatibility evidence were spread across several documents | Added a public-surface matrix, copy-paste journey gate, error/diagnostic contract, compatibility matrix, and package-release requirements |
| 4 | Quality and release evidence | Acceptance bullets lacked stable evidence identifiers; broad test lists could pass without proving each outcome | Added traceability rules, risk-based test suites, release-candidate evidence requirements, and a no-waiver completion audit |

## Backlog hierarchy and completion semantics

- `SDK-001` through `SDK-013` are **release backlog items**, not single sprint-sized stories.
- Each release item must be decomposed into implementation work packages for contract, database,
  API, worker, SDK/CLI, dashboard, observability, documentation, and verification as applicable.
- A work package may merge independently only when it is unreachable from public product surfaces
  and cannot imply that the release item is available.
- Only the release item may change the capability matrix to `supported`, expose navigation, publish
  public SDK types, or be announced to customers.
- Every child work package carries its parent ID, acceptance-criterion IDs, dependencies, owner,
  migration/rollback notes, verification commands, and produced evidence.
- Closing all child work packages does not automatically close the release item. The release owner
  must perform the completion audit and attach the integrated release evidence.

## Delivery policy

This backlog does not treat schemas, APIs, workers, SDK methods, dashboard screens, or documentation
as independently delivered product features. Each item is a vertical capability. Its internal work
may be divided among engineers, but the backlog item remains **not done** until every required layer
and acceptance criterion is complete.

The following ticket patterns are prohibited:

- build an endpoint now and add authorization, UI, SDK, or tests later;
- add a queue/cron library without a production caller and recovery test;
- expose a disabled or mock-backed control for a future capability;
- publish an SDK method that calls an unimplemented or fake-success endpoint;
- add a channel, Journey node, key scope, generated type, or documentation claim before its real
  execution path exists;
- merge localStorage/mock persistence for a surface described as saved or published;
- mark a money path done with unit mocks but no real-Postgres reconciliation tests;
- call a feature complete while its error, loading, empty, permissions, audit, or operational states
  are missing.

Feature flags and kill-switches may protect rollout, but a flagged capability must be internally
complete and testable. When a capability is not ready, it remains absent from navigation, public
contracts, generated catalogs, API-key scopes, and the capability matrix.

No acceptance criterion may be deferred with a waiver, follow-up ticket, known-issue note, or
"beta" label. If a criterion is not applicable, the release owner must record why the underlying
risk does not exist and obtain the named reviewer for that risk; inconvenience is not evidence of
non-applicability.

## Global definition of ready

An item may start only when:

- its dependencies below are complete;
- public contract names, permissions, errors, and state transitions are agreed;
- required provider, sender, domain, wallet, or compliance prerequisites are available in the
  target environment;
- the migration and rollback approach is reviewed;
- test data, provider fake behavior, and required real-Postgres environment are identified;
- any live external write has separate explicit human authorization.

Ready status also requires a named product owner, technical owner, QA owner, operational owner, and
security/data reviewer where those risks apply. External approvals must have evidence and expiry or
revalidation rules; a plan to obtain them is not readiness.

## Global definition of done

Every item must provide applicable evidence for all of these:

- Zod boundary contracts in `@app/contracts` and generated/updated OpenAPI;
- additive Drizzle schema plus journaled RLS/grant migrations and drift-safe snapshots;
- FORCE RLS and application/environment containment through the real runtime role;
- NestJS API behavior with structured errors, scopes, rate limits, and audit events;
- BFF routes that resolve refreshed sessions, enforce membership permissions, and never trust a
  client-supplied tenant/application/environment without containment validation;
- SDK/CLI behavior with strict public types, runtime response validation, cancellation, retry, and
  request-ID exposure;
- dashboard workflow with accessible loading, error, empty, permission-denied, success, and
  destructive-confirmation states;
- durable worker/cron trigger for every asynchronous path, including restart recovery;
- wallet, provider, compliance, kill-switch, outbox, and idempotency invariants where applicable;
- structured logs, metrics, audit trail, customer-visible status, and operator diagnostics;
- unit, API, contract, real-Postgres integration, async failure/retry, and focused E2E/UAT evidence;
- updated capability matrix, SDK docs, examples, changelog, migration notes, and runbook;
- formatting, lint, typecheck, tests, build, architecture guards, SDK `release:check`, and package
  install/import verification;
- no mock data, stale TODO, lying comment, unused compatibility path, or untriggered capability.

"Applicable" is decided during readiness, not at completion. Every global Done line must be mapped
to evidence or to a reviewed non-applicability rationale before implementation starts.

## Cross-cutting architecture and security gates

These gates apply to every release item that introduces the corresponding risk. A child ticket may
implement part of a gate, but the release item cannot pass on inferred or mocked evidence.

| Risk | Required design | Evidence required before release |
| --- | --- | --- |
| Tenant and environment isolation | Tenant-owned rows use FORCE RLS; application/environment containment uses composite keys or transactionally validated ownership; customer runtime uses `withTenant`; provisioning access remains separate | Real-Postgres tests through `app_runtime` prove same-tenant access and cross-tenant/cross-application denial for read, write, worker claim, replay, and callback correlation |
| Authorization | Management permissions, API-key scopes, BFF role gates, and worker authority are separate closed catalogs; browser input never supplies trusted tenant identity | Generated parity test plus negative API/BFF tests for every role and scope |
| Durable idempotency | Scope, operation, environment, key, normalized-request hash, result resource, and retention are persisted; replay and conflict behavior survive restart and generic cache expiry | Concurrent and crash-recovery integration tests prove one logical effect and deterministic conflict |
| Transactions and events | Acceptance, wallet reservation, state transition, and outbox event share the transaction where their invariant requires it; consumers are at-least-once and version-aware | Failure injection before and after every commit/provider boundary plus ledger/outbox reconciliation |
| Worker safety | Claims are durable and leased or recoverable; concurrency uses database locking; retries are bounded; poison work becomes visible; every worker has a deployed caller | Real trigger test, duplicate-worker test, restart recovery, oldest-work metric, dead-work alert, and runbook exercise |
| Privacy and retention | Recipient/content/variables are minimized, encrypted where retained, masked in ordinary surfaces, excluded from logs/metrics, and governed by documented retention/deletion/legal-hold behavior | Data-flow/threat-model review, redaction tests, retention job trigger test, deletion/export UAT, and operator access audit |
| External callbacks and webhooks | Signatures use raw bytes, timestamp tolerance, replay protection, secret rotation, bounded bodies, rate limits, and correlation that cannot cross tenants/environments | Signature/replay/rotation/fuzz tests and cross-tenant callback denial |
| Outbound endpoint security | Customer webhook URLs use an SSRF-resistant policy, safe DNS/IP validation on every connection, redirect restrictions, egress controls, bounded timeouts/body reads, and secret-safe diagnostics | DNS rebinding, redirect, private/link-local IP, oversized response, TLS, timeout, and redaction tests |
| Money | Amounts use `MinorUnits`; reservations and settlements are double-entry, balanced, idempotent, and reconcilable; wallet uncertainty fails closed | Real-Postgres ledger invariant tests, reconciliation report, insufficient-funds races, and crash recovery |
| Abuse and amplification | Per-tenant/application/key/recipient limits bound requests, attempts, broadcasts, Journey steps, retries, payload size, and spend | Boundary/load tests, rate-limit metrics, and operator override audit |
| Schema and rollout | Migrations are additive and compatible with the running prior version; backfills are bounded/resumable; destructive cleanup waits for proven cutover | Prior-version compatibility test, migration on production-shaped data, rollback/disable rehearsal, and schema drift check |

### Availability posture

| Check or dependency | Required posture |
| --- | --- |
| Wallet reservation, ledger settlement, tenant containment, authorization, consent/DND, recipient allowlist, live provider credentials | Fail closed before the external effect |
| Cached control-plane entitlement, non-money rate policy, or kill-switch store | Serve last-known-good or fail open according to the existing data-plane policy; never synchronously depend on control-plane availability |
| Provider response after possible acceptance | Mark the attempt indeterminate, reconcile by stable provider/client reference, and never blindly create a second provider effect |
| Webhook consumer endpoint | Keep the message result committed; retry only that endpoint and expose dead state |
| Dashboard, catalog generation, or analytics outage | Sending continues through the data plane; management/read surfaces report unavailability honestly |

Each item must name its bounded context owner, database tables, contract schemas, API/BFF routes,
worker entry points, outbox events, dashboard surfaces, SDK symbols, metrics, and runbooks before it is
Ready. New top-level modules, public resources, or state machines require an accepted ADR or an
amendment to ADR 0005/0006.

## Public SDK and API experience gate

The authoritative behavior is the Zod contract in `@app/contracts`. OpenAPI, NestJS parsing, BFF
parsing, `@fabric-messaging/sdk`, generated catalogs, examples, and webhook payloads are projections
of that contract and must pass parity tests. Hand-maintained parallel request/response types are not
allowed.

Every public operation introduced or changed by an item must specify and test:

- method name, HTTP method/path, required scope, request schema, response schema, and status code;
- idempotency requirement and replay/conflict semantics;
- timeout, cancellation, automatic-retry eligibility, and caller retry guidance;
- pagination/filtering/sorting and stable ordering for collection operations;
- structured error code, message, parameter path, request ID, retryability, and safe diagnostic data;
- environment behavior, rate/size limits, eventual-consistency boundary, and terminal states;
- minimum compatible SDK/CLI/catalog versions and the upgrade failure shown on incompatibility.

### Public-surface completion matrix

| Release item | SDK/CLI surface that must be real at release | Required end-to-end copy-paste journey |
| --- | --- | --- |
| SDK-001 | Existing `sms`, `email`, `verify`, `senders`, `wallet`, and `webhooks` resources with normalized shared types | Install packed SDK, construct sandbox client, perform each documented direct quickstart, and verify a signed event |
| SDK-002 | Endpoint delivery status/replay APIs where customer access is public; typed canonical events in `webhooks.verify` | Register two endpoints, cause one failure, observe independent status, replay it, and deduplicate the same event ID |
| SDK-003 | `messages.preview` plus read-only definition discovery needed by the Use in code panel | Publish a sandbox SMS definition, copy the generated preview example, and receive the same rendered plan shown in dashboard |
| SDK-004 | `@fabric-messaging/cli definitions generate/check` and `Fabric<Catalog>` | Install packed CLI/SDK into a clean app, generate types, compile a valid call, reject an invalid call, and pass CI drift check |
| SDK-005 | `messages.send/retrieve/preview` for managed SMS | Copy the dashboard example, send once with idempotency, retrieve it, and consume its terminal webhook |
| SDK-006 | Same SDK surface as SDK-005 with a live key | Run the unchanged packed example for an allowed recipient and reconcile provider, wallet, dashboard, and webhook evidence |
| SDK-007-009 | Email variants and routing through the same `messages` resource | Compile a channel-constrained call, preview its route, execute deterministic sandbox policies, then repeat authorized live UAT unchanged |
| SDK-010-011 | `journeys.start/retrieve/preview` plus generated Journey start types | Generate catalog, start one sandbox Journey, observe waits/branches/deliveries, then run the unchanged authorized live example |
| SDK-012 | Direct `whatsapp.send` and managed WhatsApp support | Complete direct, managed, routed, and Journey examples in sandbox and authorized live mode |
| SDK-013 | Direct `voice.call` and managed Voice support | Complete direct, managed, routed, and Journey examples in sandbox and authorized live mode |

### SDK behavior rules

- The client accepts a caller-provided `AbortSignal`; timeout aborts the request and returns the same
  typed transport-error shape on every resource.
- Automatic retries are limited to safe reads and explicitly idempotent writes. The SDK honors
  `Retry-After`, applies bounded jitter, and never retries validation, authorization, conflict, or
  insufficient-funds failures.
- Every success exposes the Fabric request ID through a stable response metadata mechanism, and every
  error exposes it directly without requiring access to raw internals.
- Runtime response validation fails with a distinct `invalid_api_response` SDK error containing no
  response body or secret. Public callers never receive an unchecked cast.
- Unknown webhook event types verify their signature and parse to a bounded `unknown` variant;
  invalid signatures never yield an event object.
- Examples use stable keys and realistic typed data, contain no provider IDs or secrets, and run in
  CI against sandbox fakes from a clean packed-package installation.
- The support matrix covers Node 22 ESM first. Any added runtime/module target requires packed
  install, import, type-resolution, fetch/crypto, cancellation, and webhook verification tests.
- A beta breaking change requires migration notes and compile fixtures for before/after usage. A
  stable breaking change requires a major version and accepted migration plan.

## Delivery sequence

```text
SDK-001 Contract normalization
    -> SDK-002 Webhook reliability
    -> SDK-003 Definition authoring + sandbox preview
    -> SDK-004 Typed catalog CLI
    -> SDK-005 Managed SMS sandbox
       |-> SDK-006 Managed SMS live
       |-> SDK-007 Managed Email sandbox -> SDK-008 Two-channel routing sandbox
       |                                  -> SDK-009 Managed Email + routing live
       `-> SDK-010 Journeys sandbox -> SDK-011 Journeys live

SDK-012 WhatsApp and SDK-013 Voice begin only after the shared live routing and Journey foundations
they promise are complete. They remain absent from every product surface until their entire channel
vertical is operational.
```

SDK-010 may begin after SDK-005 and SDK-004; it does not depend on Email or two-channel routing.
SDK-008 may proceed in parallel with Journey work after SDK-007.

The first customer-usable increment is SDK-001 through SDK-005: a coherent beta SDK plus complete
managed SMS in sandbox. SDK-006 is the first revenue-enabling live increment. SDK-007 through
SDK-009 add Email and routing. SDK-010 and SDK-011 add automation without making Journeys a hidden
dependency of ordinary sends.

---

## SDK-001 - Normalize the beta public contract

**Priority:** P0

**Stakeholder value:** Developers receive one coherent vocabulary and type system before managed
resources make existing inconsistencies expensive to change.

**Outcome evidence:** All shipped quickstarts compile against one beta release; the public contract
parity check reports zero vocabulary, scope, or event-name drift.

**Dependencies:** ADR 0005/0006 review; no provider dependency.

### Functional scope

- Standardize public environment values to `sandbox | live` across SDK models, API serializers,
  webhook endpoints, examples, and dashboard labels. Keep `sk_test_` and `sk_live_` prefixes.
- Split SDK execution options into `RequestOptions`, `WriteOptions`, and required
  `IdempotentWriteOptions` without breaking existing direct write behavior unexpectedly.
- Standardize direct public webhook types to `message.sent`, `message.delivered`,
  `message.undelivered`, `message.failed`, and `message.inbound`.
- Translate internal `message.updated` outbox transitions into public events; never expose the
  internal event name.
- Replace documentation promises about `sms.delivered`, `production`, and ID prefixes.
- Make resource IDs explicitly opaque in types and docs.
- Correct the closed API-key scope catalog so it matches every currently enforced direct endpoint,
  including Email, before adding managed scopes.
- Publish one beta migration release with changelog and before/after examples.

### Acceptance criteria

- Given `sk_test_...`, when a client is constructed, then `fabric.environment === "sandbox"`.
- Given `sk_live_...`, when a client is constructed, then `fabric.environment === "live"` and no
  public SDK type accepts `"production"`.
- Given a direct terminal message transition, when a webhook is delivered, then its public type is
  canonical and never `message.updated` or `sms.delivered`.
- Given a valid future event type, when `webhooks.verify` processes it, then signature verification
  succeeds and an explicit unknown-event variant is returned without an unsafe caller generic.
- Given every implemented API-key-protected endpoint, when its required scope is compared with the
  contract catalog and dashboard selector, then they match exactly.
- Existing direct SMS, Email, sender, Verify, wallet, and webhook quickstarts compile and pass their
  sandbox tests after migration.

### Required verification

- SDK compile-time migration fixtures and clean ESM package install;
- API/SDK webhook contract tests for all canonical types plus unknown event;
- API-key permission parity test generated from the closed scope catalog;
- regression tests for protected headers, retries, errors, and request IDs;
- documentation quickstart execution with sandbox keys only.

### Release gate

Do not start managed public contracts until this vocabulary release is published and consumers have
migration guidance. Storage enums may remain legacy internally only when serializers hide them.

---

## SDK-002 - Deliver webhooks independently per endpoint

**Priority:** P0

**Stakeholder value:** Developers receive reliable, explainable events without healthy endpoints
being repeatedly called because another endpoint failed.

**Outcome evidence:** The webhook reliability UAT proves independent retry and replay across two
endpoints, and the release dashboard exposes zero unaccounted terminal deliveries.

**Dependencies:** SDK-001.

### Functional scope

- Add tenant-scoped `webhook_deliveries` with unique event/endpoint ownership, pending/delivered/dead
  state, attempts, next attempt, last safe error category, and timestamps.
- Materialize endpoint delivery rows from transactional outbox events.
- Deliver and retry each endpoint independently with bounded exponential backoff, jitter, timeout,
  and a production worker/cron trigger.
- Enforce an SSRF-resistant webhook URL policy at registration and delivery time, including DNS
  rebinding/redirect defense, egress restrictions, TLS validation, bounded bodies, and safe errors.
- Preserve at-least-once semantics and signature verification.
- Add dashboard endpoint health, pending/dead event visibility, and an audited replay action.
- Add operator metrics and alerts for oldest pending age, retry volume, dead deliveries, and worker
  failure.
- Document deduplication, resource-version ordering, replay, endpoint removal, and secret handling.

### Acceptance criteria

- Given two endpoints where one returns 2xx and one returns 500, when retries run, then only the
  failed endpoint is called again.
- Given an endpoint accepts a request but Fabric times out, when the event is retried, then it keeps
  the same event ID and the consumer can deduplicate it.
- Given maximum attempts are exhausted, when the delivery becomes dead, then it remains visible and
  produces an operator signal rather than being marked silently successful.
- Given an authorized owner/admin replays a dead delivery, then the action is audited, the historical
  failure is preserved, and only the selected endpoint is retried.
- Given a user from another tenant, when they attempt to read or replay a webhook delivery, then RLS
  and API authorization deny access.
- Given the worker restarts after claiming work, then pending rows remain recoverable and eventually
  reach delivered or dead state.

### Required verification

- real-Postgres RLS, uniqueness, concurrency, and worker-claim integration tests;
- deterministic HTTP fake tests for 2xx, 4xx, 5xx, timeout, connection reset, and slow response;
- duplicate/out-of-order consumer fixture using SDK verification;
- BFF permission and refresh-fallback tests;
- focused dashboard E2E for health, dead state, and replay;
- production-trigger test that invokes the actual scheduled caller.

### Release gate

Managed delivery event types cannot ship until endpoint-specific delivery and recovery are active.

---

## SDK-003 - Author, version, release, and preview managed SMS definitions

**Priority:** P0

**Stakeholder value:** A business user can manage reusable SMS content safely while a developer gets
a stable application contract, without sending or charging during authoring.

**Outcome evidence:** A business user publishes and previews a sandbox definition without engineering
or provider contact, and a developer copies its stable-key example successfully.

**Dependencies:** SDK-001; application/environment selection and containment available in dashboard.

### Functional scope

- Add application-scoped definitions, immutable versions, environment releases, variable schemas,
  SMS variants, locale/default-locale rules, and environment sender bindings.
- Enforce stable key grammar and compatibility analysis.
- Define compatibility rules explicitly: adding an optional variable or locale is compatible;
  removing/renaming a variable, tightening its validation, changing its type, removing a released
  locale/channel, or changing requiredness is breaking and requires a new stable key.
- Implement dashboard list/create/edit/validate/publish-to-sandbox/archive workflows with explicit
  permissions and audit events.
- Implement public released-definition preview through the same schema validator, renderer,
  segmentation, pricing, sender, compliance, and eligibility code used by send.
- Return structured blockers/warnings, rendered SMS, encoding, segments, estimated exact-currency
  cost, resolved locale, sender status, and version.
- Provide a functional Use in code panel with the stable key, schema, environment, and untyped SDK
  example.
- Offer explicit conversion from an existing SMS template into a reviewed draft; never silently
  migrate or cross-application share it.
- Keep live promotion absent and keep unsupported channels/Journey references absent.

### Acceptance criteria

- Given an owner/admin, when they create and publish a valid sandbox definition, then an immutable
  version and sandbox release are persisted and audited.
- Given a member, when they draft content, then they can save and preview but cannot publish or
  promote; developer access is read-only.
- Given a published version, when anyone edits content, then a new draft/version is created and the
  published row cannot be updated by the runtime role.
- Given invalid, missing, extra, oversized, or wrong-type variables, when preview runs, then it
  returns bounded field-path errors and persists no PII, delivery, reservation, or outbox event.
- Given a valid preview, then its rendered content, encoding, segments, and calculated cost match a
  subsequent managed SMS send using the same release and pricing state.
- Given a forged application/environment ID through the browser, then the BFF/API rejects it and no
  cross-application definition is read or written.
- Given a template conversion, then the user reviews key, schema, sender, locale, and content before
  a draft is created; the original template remains unchanged.

### Required verification

- Zod schema/compatibility unit tests and renderer security/limit tests;
- real-Postgres RLS, composite FK, uniqueness, immutability, and publish-race tests;
- preview no-side-effect integration tests covering wallet, provider, outbox, and PII vault;
- role/scope/BFF containment tests;
- accessible dashboard component/E2E tests for all states;
- audit event assertions and API/OpenAPI contract parity.

### Release gate

The feature is visible only when create, edit, publish-to-sandbox, preview, permissions, and audit are
all functional. No live button or unsupported channel selector is shown.

---

## SDK-004 - Generate and verify typed definition catalogs

**Priority:** P0

**Stakeholder value:** Developers get compile-time key, payload, channel, and locale safety without
making code generation a prerequisite for direct messaging.

**Outcome evidence:** A clean sample application generates a deterministic catalog, catches an
invalid payload at compile time, and passes `definitions check` in CI.

**Dependencies:** SDK-003.

### Functional scope

- Create the separately packaged, version-pinned `@fabric-messaging/cli` with a `fabric` binary.
- Add a least-privilege `definitions:read` API-key scope and read-only catalog endpoint.
- Return a versioned manifest with application/environment identity, sorted contracts,
  compatibility digest, and minimum supported SDK/CLI contract versions.
- Generate deterministic TypeScript types with no timestamp, content, PII, secrets, or provider IDs.
- Implement `definitions generate` and `definitions check` with actionable drift, auth, environment,
  breaking-change, and version-incompatibility errors.
- Add the `Fabric<Catalog>` generic and typed managed-message resource without weakening the
  ungenerated default to `any`.
- Add dashboard copyable install/generate/check commands for the selected application/environment.

### Acceptance criteria

- Given a valid definitions-read sandbox key, when generation runs twice without a contract change,
  then the files are byte-identical.
- Given a message key, when a typed developer calls `messages.send`, then key, required data,
  inline extra fields, channel, and locale are checked at compile time.
- Given data widened through JavaScript or structural typing, when the API receives it, then the same
  invalid fields are rejected at runtime.
- Given a catalog produced by a newer unsupported manifest schema, when an older CLI runs, then it
  fails with upgrade guidance and never emits `any`.
- Given a send-only key, when it calls the catalog endpoint, then access is denied; a definitions-read
  key cannot send, publish, or retrieve content.
- Given sandbox/live catalog mismatch, then `definitions check` identifies the selected environment
  and exits non-zero without exposing secret material.

### Required verification

- compile fixtures with `@ts-expect-error` and clean JavaScript/TypeScript consumer projects;
- deterministic snapshot/golden-file tests;
- packed CLI install and binary execution on Node 22 ESM;
- manifest/API/SDK compatibility matrix tests;
- secret-redaction tests for stdout, stderr, logs, and generated output;
- dashboard command accuracy check against the packed CLI.

### Release gate

SDK and CLI betas publish from the same contract revision, with provenance, changelog, migration
notes, and `release:check` evidence.

---

## SDK-005 - Send and observe managed SMS in sandbox

**Priority:** P0

**Stakeholder value:** A developer can send a dashboard-managed, type-safe SMS by business key and
reliably observe its funded execution without duplicate sends or charges.

**Outcome evidence:** The packed SDK example completes the sandbox send-to-webhook workflow, and
delivery, attempt, wallet, dashboard, and webhook records reconcile to one logical message.

**Dependencies:** SDK-002, SDK-003, SDK-004.

### Functional scope

- Add delivery, attempt, durable idempotency, exact cost, reference, metadata, resource-version, and
  PII-vault relationships under FORCE RLS.
- Implement the approved content/recipient/idempotency/audit retention schedule, a triggered purge
  job, legal-hold behavior, tenant export/deletion handling, and proof that ledger/audit records
  retain required integrity without retaining unnecessary message content.
- Implement `POST /v1/message-deliveries` (`202`), retrieve, structured errors, required managed
  idempotency, request normalization, and caller `maxCost`.
- Atomically resolve release, validate, plan SMS, reserve sandbox funds, create delivery/attempt,
  persist encrypted rendered content, and insert acceptance outbox event.
- Add a recoverable production worker trigger that dispatches through the existing Virtual Phone,
  updates attempt/aggregate status, resolves wallet funds, and emits canonical events.
- Implement `fabric.messages.send`, `retrieve`, and `preview` with generated and ungenerated typing.
- Add dashboard delivery logs/details linking key, version, attempt, exact cost, reference, masked
  recipient, timeline, request ID, and webhook status.
- Add kill-switch, rate-limit, sender, compliance, consent, quiet-hour, and attempt-time rechecks.
- Update SDK/API docs, runnable example, errors, sandbox deterministic outcomes, and capability matrix.

### Acceptance criteria

- Given a valid released SMS definition and funded sandbox wallet, when `messages.send` is called,
  then it returns `202` only after one durable funded delivery and recoverable attempt exist.
- Given concurrent identical requests with one scoped idempotency key, then one delivery, one channel
  message, one reservation, and one acceptance event exist; every caller receives that delivery.
- Given the same key with changed normalized input, then the API returns `idempotency_conflict` and
  creates no second effect, even after the generic 24-hour cache window.
- Given a crash after acceptance or worker claim, then the production recovery trigger completes or
  safely fails the original attempt without duplicating provider contact or ledger movement.
- Given STOP/DND, quiet hours, revoked sender, kill-switch, insufficient balance, cost ceiling, or
  invalid payload before acceptance, then a structured error is returned and no delivery exists.
- Given consent/sender/kill-switch changes after acceptance but before provider contact, then the
  worker blocks safely, refunds as required, records a reason, and emits the terminal event.
- Given deterministic sandbox recipients, then delivered/undelivered/failed/delayed outcomes,
  wallet treatment, dashboard timeline, retrieval, and typed webhooks agree.
- Direct `sms.send` remains functional without definitions or generated catalogs.

### Required verification

- real-Postgres concurrency, RLS, durable-idempotency, outbox, and ledger integration tests;
- crash-injection tests at every transaction/provider boundary;
- fake-provider/Virtual Phone end-to-end tests for all deterministic outcomes;
- API negative/auth/rate/size/error contract tests;
- SDK HTTP/retry/cancellation/timeout/response-shape and compile tests;
- dashboard E2E from definition selection to delivery log;
- ledger invariant and webhook duplicate/out-of-order recovery evidence;
- sandbox UAT using the packed SDK example verbatim.

### Release gate

No live provider route is enabled. The sandbox capability is nevertheless complete: real persistence,
wallet path, worker, Virtual Phone, webhook, logs, SDK, CLI, dashboard, and recovery all operate.

---

## SDK-006 - Send managed SMS live through an approved provider

**Priority:** P1

**Stakeholder value:** An approved customer can move the unchanged managed-SMS integration from
sandbox to live delivery by changing only the API key.

**Outcome evidence:** One explicitly authorized recipient receives the message from the packed
sandbox-tested example with one provider submission, one reconciled charge, and one terminal event.

**Dependencies:** SDK-005; active live environment; funded wallet; Arkesel/reseller credentials;
approved sender; explicit human live authorization.

### Functional scope

- Add live definition promotion of the exact sandbox-tested version with compatibility,
  sender/provider readiness, wallet, compliance, and maker-checker authorization gates.
- Bind live sender/provider state without exposing provider IDs in application code.
- Route `sk_live_` managed SMS through the real provider using the same delivery/attempt contract,
  DLR reconciliation, cost accounting, webhooks, logs, and SDK call.
- Enforce a server-side owner-approved recipient allowlist for controlled live testing; changes are
  audited and cannot be supplied by the client.
- Add operational dashboards/alerts for provider errors, stuck attempts, DLR age, reservation age,
  webhook failures, and ledger reconciliation.
- Add disable/rollback runbook using kill-switches without deleting delivery history.

### Acceptance criteria

- Given a sandbox-tested version, when an owner/admin promotes it, then live points to the exact
  immutable version; no content copy or silent schema change occurs.
- Given incomplete sender approval, provider configuration, wallet, allowlist, or environment gate,
  then promotion/send fails closed with an actionable code before provider contact.
- Given an allowed recipient and explicit live authorization, when the packed SDK example sends,
  then one provider submission, DLR-correlated attempt, exact ledger resolution, customer webhook,
  and dashboard timeline exist.
- Given a recipient outside the server allowlist during controlled rollout, then the request is
  blocked regardless of client payload or API key scope.
- Given a provider timeout after possible acceptance, then retry uses the same stable message ID and
  reconciliation does not double-send or double-charge.
- Given the managed kill-switch is disabled after acceptance, then pending work stops safely and
  reservations resolve according to the runbook.

### Required verification

- provider contract tests against recorded/sandbox responses without live writes;
- real-Postgres live-mode routing, sender, allowlist, DLR, ledger, and RLS tests using fakes;
- failure injection for timeout, malformed response, duplicate/out-of-order DLR, and provider outage;
- security review of credentials, callback ingress, allowlist, scopes, and log redaction;
- operator runbook exercise and monitoring evidence;
- one explicitly authorized minimal live smoke with captured request, delivery, provider, ledger,
  and webhook IDs but no secret values.

### Release gate

This item is not Done after provider code merges. It is Done only after the human-gated live smoke,
reconciliation, monitoring, and rollback evidence pass. Removing the controlled recipient allowlist
is a separate explicit product/security decision, not an automatic follow-up.

---

## SDK-007 - Send managed Email in sandbox

**Priority:** P1

**Stakeholder value:** Developers reuse the same business key and delivery resource for Email while
business users manage channel-appropriate subject/text/HTML safely.

**Outcome evidence:** The same managed-message API completes an Email sandbox send and the sandbox
inbox, wallet, dashboard, retrieval response, and webhook agree on the result.

**Dependencies:** SDK-005; existing direct sandbox Email path operational.

**Inherited criterion (from SDK-004-AC02, deferred 2026-07-21):** SDK-004's compile-time *channel*
constraint was recorded as non-applicable while SMS was the only selectable managed channel (see
`docs/sdk/evidence/sdk-004.md`). Email is the first second channel, so this item **cannot close**
unless it lands the `channel` narrowing in the generated catalog types plus a `@ts-expect-error`
fixture proving a channel-unsupported call fails to compile.

### Functional scope

- Add Email definition variants, subject/text/HTML rendering, locale preview, sending-domain binding
  state, contextual escaping, size limits, and safe content storage.
- Extend managed route planning, delivery attempts, exact sandbox pricing, typed SDK catalogs,
  dashboard editor/preview/logs, and canonical webhooks for Email.
- Dispatch through the real existing sandbox Email worker and provider fake; do not create a second
  managed execution engine.
- Keep live Email unavailable and absent unless SDK-009 is complete.

### Acceptance criteria

- Given a released Email variant, when preview runs, then subject/text/HTML, locale, binding status,
  blockers, and price are produced with no send or reservation.
- Given valid Email input, when the unchanged `messages.send` call constrains `channel: "email"`,
  then one funded delivery/Email attempt completes through the sandbox provider and is observable.
- Given unsafe HTML variables, missing content, invalid recipient, oversized output, or unavailable
  domain binding, then contextual validation blocks delivery without leaking rejected values.
- Given generated contracts, then the message key permits Email only when the released definition
  includes it.
- Given a sandbox key, then no live Email provider or sending domain can be selected.

### Required verification

- renderer escaping/injection/size tests;
- real-Postgres delivery/Email/wallet/RLS integration tests;
- worker restart and provider-failure tests;
- SDK compile/runtime contract tests;
- dashboard Email variant preview/send/log E2E;
- typed webhook and sandbox inbox UAT.

### Release gate

Email appears as a managed channel only after definition, preview, send, worker, logs, webhooks,
pricing, generated types, and tests work in sandbox.

---

## SDK-008 - Route across SMS and Email in sandbox

**Priority:** P1

**Stakeholder value:** A business can configure priority, conservative fallback, or intentional
broadcast without changing application code, while developers retain cost and channel controls.

**Outcome evidence:** UAT demonstrates all three policies with deterministic channel failures and
proves that route choice, costs, attempts, and final status are explainable without log access.

**Dependencies:** SDK-007.

### Functional scope

- Add publish-time policy authoring for ordered priority, pre-provider-acceptance fallback, and
  broadcast across SMS/Email.
- Add recipient/address eligibility, caller channel constraint, route-plan preview, unresolved
  runtime decisions, per-attempt status, aggregate status, and exact cost ceiling enforcement.
- Implement atomic broadcast reservation and just-in-time fallback reservation.
- Add attempt-aware rate/amplification limits, logs, webhooks, and policy audit history.
- Keep fallback-after-late-undelivered absent from UI/contracts.

### Acceptance criteria

- Given priority SMS then Email and an ineligible SMS address/sender, when planning runs, then Email
  is selected before acceptance and the reason is visible.
- Given fallback and SMS submission fails before provider acceptance, then its reservation is
  refunded, Email reserves just in time, and one aggregate delivery links both attempts.
- Given SMS is provider-accepted and later undelivered, then Email is not started automatically.
- Given broadcast and insufficient funds for the complete plan, then no attempt is accepted or sent.
- Given broadcast has sufficient funds, then all planned reservations commit atomically and final
  status becomes delivered, partially delivered, undelivered, or failed from deterministic rules.
- Given `limits.maxCost` or channel constraint, then no attempt can exceed or bypass it after a
  business-owned policy change.
- Preview, actual route, attempt costs, dashboard timeline, retrieval, and webhook resource versions
  remain explainable for every outcome.

### Required verification

- pure state-machine/property tests for policy and aggregate status;
- real-Postgres concurrent reservation/reconciliation tests;
- deterministic provider matrix across both channels;
- rate/amplification and cost-bound tests;
- SDK typing for channel/locale and untyped runtime rejection;
- dashboard policy authoring/preview/log E2E;
- webhook duplicate/out-of-order tests across multiple attempts.

### Release gate

Do not expose routing policy controls when only one managed channel is executable.

---

## SDK-009 - Send managed Email and multi-channel routes live

**Priority:** P2

**Stakeholder value:** Approved customers can promote the exact sandbox-tested Email and routing
configuration to real delivery with the same SDK call.

**Outcome evidence:** The packed sandbox-tested integration completes authorized live Email,
fallback, and broadcast scenarios with provider, ledger, event, and dashboard reconciliation.

**Dependencies:** SDK-006, SDK-008; approved production Email provider/domain; explicit human go.

### Functional scope

- Implement production Email provider integration, domain verification/binding, callbacks, pricing,
  suppression/compliance, sender identity, retries, and reconciliation.
- Add live promotion readiness for Email variants and multi-channel policies.
- Exercise live priority/fallback/broadcast using current safety, wallet, allowlist, kill-switch,
  observability, and rollback controls.
- Keep unsupported live routes unpublishable rather than silently skipping them.

### Acceptance criteria

- Given an unverified/revoked domain or missing provider, then live promotion and send fail closed.
- Given an approved domain and authorized test recipient, then managed Email produces one correlated
  provider attempt, terminal event, exact cost, and dashboard record.
- Given a live fallback/broadcast policy, then every attempted channel is approved, funded,
  compliant, bounded, and independently observable.
- Given a provider or callback outage, then recovery and reconciliation preserve one attempt and
  correct wallet outcome.
- The application code used in SDK-008 runs unchanged except for the live API key.

### Required verification

- provider contract and callback tests;
- real-Postgres live-mode routing/ledger/outbox integration tests with fakes;
- domain/suppression/security review;
- load and failure tests for multi-channel workers;
- monitoring/rollback exercise;
- explicitly authorized minimal live Email and routing UAT with reconciliation evidence.

### Release gate

No live Email or multi-channel capability claim until provider/domain approval, live smoke,
monitoring, and rollback evidence are complete.

---

## SDK-010 - Author, run, and observe SMS Journeys in sandbox

**Priority:** P1

**Stakeholder value:** A business user can publish a bounded multi-step messaging automation and a
developer can start and inspect it by typed key without operating a workflow engine.

**Outcome evidence:** A business user publishes a Journey and a developer starts it from the
generated example; every wait, branch, delivery, and terminal state is visible and recoverable.

**Dependencies:** SDK-004, SDK-005, SDK-002.

### Functional scope

- Replace the localStorage/mock Journey schema with Zod discriminated contracts and real
  application/environment persistence under FORCE RLS.
- Support only executable nodes: explicit SDK start, managed SMS send, bounded wait, delivery-result
  branch, and end.
- Add graph validation, immutable versions, sandbox release, preview, publish, and Use in code.
- Implement durable run/step/wakeup state, deterministic step idempotency, production worker/cron
  trigger, restart recovery, run limits, and transactional outbox events.
- Add typed catalog generation and `journeys.start`, `preview`, and `retrieve`.
- Add dashboard authoring, validation, publish, run list/detail, step timeline, linked deliveries,
  errors, retry/recovery visibility, and audit events.
- Define cancel, pause, resume, expiry, and manual-retry semantics before exposing those controls;
  this first release includes only controls whose effects on waits, in-flight sends, reservations,
  and terminal state are fully implemented and audited.
- Remove unsupported palette nodes and never show live publish.

### Acceptance criteria

- Given a valid graph, when an owner/admin publishes to sandbox, then an immutable version is
  released and its typed start contract appears in the generated catalog.
- Given unsupported node, cycle, unreachable node, missing start/end, invalid variable reference, or
  unbounded wait, then publish is blocked with node-specific errors.
- Given a developer starts a released Journey with one idempotency key, then one durable run is
  created and repeated/concurrent starts return it.
- Given a send step retries after worker restart, then it creates one managed delivery using a
  deterministic run/step-execution key.
- Given a wait, then a persisted wakeup and production trigger resume the correct run after restart
  without relying on in-memory timers.
- Given a delivery branch, then out-of-order/duplicate events cannot execute two branches or regress
  the step resource version.
- Given invalid payload, limit, wallet, consent, or kill-switch state, then the run/step reaches an
  explicit observable result with correct delivery and ledger behavior.
- The Journeys page contains no mock/localStorage save path and every visible action is functional.

### Required verification

- graph/state-machine unit and property tests;
- real-Postgres RLS, version, run-idempotency, step-locking, wakeup, and recovery tests;
- crash injection before/after every durable step transition;
- actual cron/worker trigger tests;
- SDK catalog/compile/runtime tests;
- dashboard authoring-to-run E2E with fake SMS outcomes;
- webhook duplicate/order and run-to-delivery audit assertions;
- sandbox UAT from generated example through completed run.

### Release gate

Journeys remain hidden until authoring, persistence, publish, SDK start, durable execution, waits,
branching, logs, workers, and tests all work. A canvas alone is not a released Journey feature.

---

## SDK-011 - Execute bounded Journeys live

**Priority:** P2

**Stakeholder value:** Approved customers can promote a sandbox-tested automation to live execution
without changing application integration code.

**Outcome evidence:** One authorized live Journey completes from the unchanged packed example with
version snapshots, steps, deliveries, costs, and events fully reconciled.

**Dependencies:** SDK-006, SDK-010; explicit live authorization.

### Functional scope

- Promote the exact sandbox-tested Journey version and snapshot referenced managed-message releases.
- Recheck sender, provider, consent, DND, quiet hours, wallet, pricing, kill-switch, and environment
  at every live step.
- Add run-level maximum deliveries, maximum duration, maximum cost, concurrency, stuck-run detection,
  alerts, pause/disable controls, and safe recovery.
- Add controlled-recipient live entry gate, operator runbook, reconciliation report, and audited
  promotion/disable actions.

### Acceptance criteria

- Given incomplete message release, sender, wallet, worker, limit, or monitoring readiness, then live
  Journey promotion is unavailable and explains every blocker.
- Given one authorized live start, then the published version, referenced message versions, steps,
  deliveries, costs, events, and final run state are fully correlated.
- Given a content release changes while a run waits, then the existing run uses its snapshot and a
  new run uses the newly promoted release.
- Given a safety gate changes while waiting, then the next step rechecks it and blocks/continues
  according to current policy rather than the old snapshot.
- Given a worker outage or duplicate wakeup/event, then one logical step execution occurs and the run
  recovers without duplicate delivery or charge.
- Given pause/kill-switch activation, then new work stops safely, existing reservations reconcile,
  and operators can identify every affected run.

### Required verification

- live-mode real-Postgres state/ledger/recovery tests with providers faked;
- long-wait clock-controlled tests and load tests for run/step limits;
- security/compliance/wallet/platform review;
- monitoring and incident-runbook exercise;
- explicitly authorized minimal live Journey UAT and reconciliation evidence.

### Release gate

Live publishing remains absent until the complete runtime and operational evidence exist. Enabling a
flag without an exercised worker and runbook does not complete this item.

---

## SDK-012 - Add WhatsApp as a complete channel vertical

**Priority:** Dependency-gated

**Stakeholder value:** Customers can send approved WhatsApp content directly or through the same
managed key, delivery, routing, and Journey model.

**Outcome evidence:** Direct, managed, routed, and Journey-triggered WhatsApp scenarios pass in
sandbox and an explicitly authorized live smoke reconciles approval, provider, wallet, and events.

**Dependencies:** SDK-009, SDK-011; selected provider; WhatsApp Business onboarding; template
approval API or documented operational synchronization; explicit live approval.

### Functional scope

- Implement real sandbox/fake and live outbound WhatsApp provider paths, status callbacks, pricing,
  wallet lifecycle, retries, idempotency, and reconciliation.
- Add sender/account binding and provider-template approval lifecycle tied to definition version,
  locale, and environment.
- Add direct `fabric.whatsapp.send` and managed WhatsApp variants without exposing provider IDs in
  normal application code.
- Add dashboard composition/preview/approval/readiness/logs, generated contracts, canonical
  webhooks, routing eligibility, and Journey send-node support.
- Support only provider capabilities actually implemented and tested; inbound/session messaging,
  buttons, media, or replies remain absent unless included in this same completed item.

### Acceptance criteria

- Given an unapproved or content-mismatched provider template, then live promotion/send is blocked.
- Given approved content, then direct and managed sandbox/live sends create one reconciled attempt
  with terminal callback, exact cost, logs, and typed webhook.
- Given provider approval changes, then current known state is visible and attempt-time eligibility
  never invents approval.
- Given multi-channel routing or a Journey node, then WhatsApp follows the same cost, consent,
  idempotency, snapshot, and observability rules as other channels.
- No WhatsApp SDK type, selector, node, or capability claim exists before the complete path passes.

### Required verification

- provider/approval/callback contract tests;
- rendering and provider-rule validation tests by locale/template type;
- real-Postgres RLS/wallet/delivery integration tests;
- SDK/dashboard/routing/Journey E2E in sandbox;
- failure/load/security tests and explicitly authorized live smoke with reconciliation.

### Release gate

Provider onboarding and template approval are entry criteria, not TODOs hidden behind a visible
WhatsApp option.

---

## SDK-013 - Add Voice as a complete channel vertical

**Priority:** Dependency-gated

**Stakeholder value:** Customers can place bounded transactional voice messages directly or through
managed definitions and Journeys with the same safety and observability model.

**Outcome evidence:** Direct, managed, routed, and Journey-triggered Voice scenarios pass in sandbox
and one authorized live call reconciles duration, provider callbacks, wallet, and events.

**Dependencies:** SDK-009, SDK-011; selected voice provider; pricing/compliance model; explicit live
approval.

### Functional scope

- Implement sandbox/fake and live outbound voice provider paths, call status callbacks, duration
  pricing, wallet reservation/reconciliation, retries, idempotency, and recovery.
- Add direct `fabric.voice.call`, managed voice script/SSML variants, voice/sender binding,
  locale/voice selection, preview, and strict SSML/output limits.
- Add dashboard authoring/readiness/logs, generated contracts, canonical webhooks, routing, and
  bounded Journey voice-send node.
- Define terminal call outcomes and billing basis without forcing them into SMS-specific statuses;
  map only stable common outcomes into delivery aggregate status.

### Acceptance criteria

- Given invalid/unsafe SSML, unsupported locale/voice, missing consent, unapproved caller identity,
  insufficient balance, or exceeded maximum duration/cost, then the call is blocked before provider
  contact.
- Given a valid call, then direct and managed paths create one attempt, reconcile actual duration
  cost, process duplicate/out-of-order callbacks, and expose logs/webhooks without audio/PII leakage.
- Given routing or a Journey node, then voice respects caller cost ceilings, attempt limits,
  snapshots, current safety gates, and deterministic step idempotency.
- Given provider timeout or worker restart, then recovery cannot create an uncontrolled second call.
- No Voice SDK method, definition variant, selector, node, or documentation claim exists before the
  complete path passes.

### Required verification

- SSML/parser/security/size tests;
- provider/callback/duration-billing contract tests;
- real-Postgres wallet/RLS/delivery/recovery integration tests;
- SDK/dashboard/routing/Journey sandbox E2E;
- load, timeout, duplicate-call prevention, monitoring, runbook, and authorized live evidence.

### Release gate

Voice remains entirely absent until provider, billing, compliance, callback, worker, SDK, dashboard,
and test evidence are complete.

---

## Verification and traceability model

Acceptance criteria are normative and have stable IDs derived from their item and current order. For
example, the third criterion under SDK-005 is `SDK-005-AC03`. Once implementation work for an item
starts, its criterion order must not change; new criteria append at the end. Child work packages,
tests, UAT records, defects, and release evidence cite these IDs.

Before an item enters implementation, its owner creates a traceability table with one row for every:

- item acceptance criterion;
- applicable Global Definition of Done line;
- applicable cross-cutting architecture/security gate;
- public SDK/API operation and copy-paste journey;
- migration, worker trigger, alert, runbook, rollback, and live-human gate.

Each traceability row names the automated test or manual UAT case, environment, fixture/setup,
expected evidence, evidence location, and responsible reviewer. One test may prove several rows only
when its assertions and captured evidence explicitly prove each row.

### Mandatory test suites

| Suite | Purpose | Execution gate |
| --- | --- | --- |
| Unit and property | Schema boundaries, rendering, compatibility, state machines, cost/routing math, retry policy, and graph invariants | Required on every affected PR; deterministic seeds are printed on failure |
| Contract and compile | Zod/OpenAPI/API/BFF/SDK/webhook/catalog parity plus positive and negative TypeScript fixtures | Required on every affected PR and SDK release |
| Real-Postgres integration | RLS, constraints, transactions, idempotency, outbox, ledger, concurrency, migration, and worker claims through the correct database roles | Required before merge for affected modules; no in-memory database substitute |
| API and security | Validation, authentication, scopes, roles, containment, rate/size limits, signatures, replay, SSRF, redaction, and structured errors | Required before merge; fuzz/property cases run in the release suite where runtime is material |
| Async resilience | Crash points, duplicate/out-of-order events, timeouts after possible acceptance, retry exhaustion, poison work, restart, and reconciliation | Required before item release using the real worker entry point and deterministic provider doubles |
| SDK/CLI package | Packed installation, ESM import, types, runtime validation, cancellation, retry, diagnostics, binary execution, and generated-output determinism | Required before every SDK/CLI publication from a clean consumer project |
| Dashboard component/E2E | Loading, empty, denied, error, success, stale/concurrent mutation, accessibility, copy-paste example, and recovery workflow | Critical paths required before merge; integrated item workflow required before release |
| Performance and amplification | Defined API/worker latency and throughput budgets, queue age, rate limiting, fan-out, broadcast, and Journey bounds | Baseline required in sandbox before live work; thresholds and alerts required before live release |
| Operational exercise | Deployed trigger, metrics, alert routing, dead-work recovery, reconciliation, disable/rollback, and runbook accuracy | Required in a production-like environment before release; live exercise additionally requires explicit authorization |
| Stakeholder UAT | The Outcome evidence and end-to-end business/developer job for the item | Required for release-item closure with named accept/adjust/defer/reject disposition |

Tests that require unavailable provider behavior use deterministic provider doubles for normal CI,
but a live item still requires its explicitly authorized provider smoke. Recorded fixtures must be
redacted, schema-validated, versioned, and supplemented by callback/request contract tests so they do
not conceal provider drift.

Flaky, skipped, quarantined, `todo`, or expected-failure tests do not satisfy a traceability row. A
failed release test blocks release; it cannot be replaced by a screenshot or a narrower unit test.

### Release-item completion audit

The release owner and QA owner jointly close an item only after inspecting authoritative current
state and recording all of the following:

1. Every acceptance criterion and outcome-evidence statement has direct passing evidence.
2. Every applicable Done/gate row has passing evidence; reviewed non-applicability decisions remain
   valid against the implemented design.
3. Database migrations, RLS/grants, deployed triggers, secrets/configuration, alerts, dashboard,
   API/BFF, SDK/CLI, generated contracts, docs, and runbooks exist in the release artifact and target
   environment—not only on a branch or developer machine.
4. The capability is absent when its environment/provider prerequisites are not met and fully usable
   when they are met; there is no fake-success, dead control, hidden manual database step, or
   undocumented operator action.
5. Money, events, attempts, audit records, and customer-visible status reconcile for success,
   rejection, indeterminate provider acceptance, retry, cancellation where supported, and terminal
   failure.
6. The prior compatible release can coexist during deployment, rollback/disable has been exercised,
   and destructive cleanup has not occurred before cutover evidence.
7. The packed public example—not workspace source imports—completes the item journey, and the
   capability matrix, changelog, migration guide, API reference, and SDK docs match observed behavior.
8. Open critical/high defects are zero. Lower-severity defects may remain only when they do not
   contradict an acceptance criterion or Done gate and have an owner plus documented customer impact.

The audit outcome and evidence links are committed with the release documentation. An item whose
target deployment is intentionally deferred may be `implementation complete`, but it is not
`shipped` and cannot be marked Done under this backlog.

---

## Cross-item UAT evidence pack

Each release candidate includes a reproducible evidence pack containing:

- commit/tree and packed SDK/CLI versions;
- workspace, application, and environment used, without secret values;
- user role and API-key scope matrix;
- definition/Journey key and immutable versions;
- request, delivery/run, attempt, channel-message, ledger, outbox, and webhook identifiers;
- expected versus actual state and exact minor-unit reconciliation;
- screenshots of dashboard success/error/recovery states where applicable;
- logs/metrics proving worker execution and no secret/content leakage;
- rollback/disable result;
- stakeholder disposition: accept, adjust, defer, or reject.

## Residual decisions with named owners

These are entry decisions, not placeholder implementation tickets:

| Decision | Owner | Due before |
| --- | --- | --- |
| Accept/amend ADR 0005 and 0006 | Product + architecture + security + wallet | SDK-003 schema work |
| Delivery audit, PII, and durable-idempotency retention periods | Compliance + security + data owner | SDK-005 migration |
| Broader npm package name before 1.0 | Product + developer experience | Stable SDK release |
| Live provider/domain/channel selection and contracts | Product + platform + security | Corresponding live/channel item |
| Controlled recipient allowlist removal | Product + security + compliance | Any wider live rollout |
| SLOs and alert thresholds after sandbox baseline | Platform + product | Corresponding live item |

An unresolved entry decision blocks its dependent item. It does not authorize a mock, default guess,
or partially exposed feature.
