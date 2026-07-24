# ADR 0005: Managed messaging SDK resource model

Status: **accepted 2026-07-19** (product owner). Ratified **retrospectively**: the resource model was
implemented across SDK-003/004/005 under an explicit per-slice go while this ADR still read
`proposed`, so acceptance confirms the built system matches the decision rather than authorising work
not yet started. The as-built evidence is `docs/sdk/evidence/sdk-003.md`, `sdk-004.md`, `sdk-005.md`.

Superseded status line: _proposed 2026-07-15 (requires product and security review before
implementation)._ The security review of runtime and management scopes is **still open** — see
Follow-up; acceptance of the model does not stand in for it.

The delivery acceptance, wallet, durable-idempotency, correlation, webhook, and privacy semantics
are refined in [ADR 0006](./0006-managed-delivery-acceptance-and-execution.md).

## Context

Fabric currently exposes direct channel resources such as `fabric.sms.send` and
`fabric.email.send`. The proposed managed layer adds stable business keys, dashboard-owned content,
generated payload types, multi-channel routing, and later Journey send nodes.

The first DX proposal modeled a managed send like one channel message. That becomes inaccurate when
a policy performs fallback or broadcast, because one intent can create several channel attempts.
The original environment model also risked treating sandbox and live definitions as unrelated
copies, which weakens promotion, auditability, and generated contracts.

## Decision

1. `fabric.messages.send` creates and returns a **message delivery** aggregate. A delivery captures
   one business intent and owns zero or more channel attempts. Direct channel APIs continue to
   return their native single-channel message resources.
2. A message definition and its stable key belong to an **application**. Immutable definition
   versions are application-owned. Each environment has a release pointer to one immutable version.
   Promoting to live moves the exact tested version rather than copying editable content.
3. Environment/provider bindings are separate from definition content. Sender identities, email
   domains, provider routes, and version-specific WhatsApp approvals remain environment-scoped and
   gate release or delivery.
4. New managed writes require caller-provided idempotency in SDK request options. Version resolution,
   request fingerprinting, and delivery creation are atomic; a replay returns the originally pinned
   version even after a later release.
5. Generated catalogs are optional, deterministic contract artifacts. The API remains the runtime
   trust boundary and validates all inputs. Catalogs contain keys, schemas, channels, locales, and a
   digest, but no content, PII, credentials, or provider identifiers.
6. Runtime and management authority are separate. Runtime scopes may send or inspect published
   definitions. Drafting, publishing, provider binding, and live promotion require a dashboard
   session role or a future purpose-built management credential.
7. A Journey run is distinct from a delivery. Journey send nodes create managed deliveries. The
   internal workflow runtime and worker dispatch records are not public SDK resources.

## Alternatives rejected

- **Return one channel message:** simpler for managed SMS but cannot represent fallback, broadcast,
  or an asynchronous route decision without a breaking response change.
- **Make every send a one-step Journey:** unifies execution internally but burdens ordinary sending
  with automation concepts and operational state.
- **Pass provider template IDs:** avoids Fabric definitions but couples applications to providers,
  leaks approval mechanics, and prevents portable multi-channel keys.
- **Duplicate definitions per environment:** easy storage model but permits key/schema drift and
  makes "promote the tested version" impossible to prove.
- **Allow runtime keys to publish:** convenient automation but violates least privilege and lets a
  compromised application change customer-facing content and routing.

## Consequences

- The first managed SMS slice creates an aggregate that initially has one attempt. This is extra
  modeling work paid once to avoid a multi-channel breaking change.
- Storage needs definitions, immutable versions, environment releases, managed deliveries, and
  attempts in addition to existing channel message and worker-dispatch tables.
- The SDK needs a new generic catalog parameter but must keep an ungenerated default and preserve
  direct resource compatibility.
- Public statuses distinguish durable acceptance from end-user delivery. Applications use retrieval
  or signed, at-least-once webhooks for terminal outcomes.
- Scope additions require a coordinated contract, dashboard, API-guard, security-test, and
  documentation change. Existing scopes are not silently reinterpreted.
- Journey runs can snapshot referenced message releases at start, making long-running execution
  reproducible after content promotion.

## Follow-up

Status at acceptance (2026-07-19): three of four satisfied.

- ~~Specify the portable variable-schema subset and compatibility algorithm.~~ Done —
  `docs/sdk/sdk-003-slice0-design.md` locks the closed JSON-Schema subset; `@app/domain`
  `analyzeCompatibility` implements the verdict table.
- ~~Complete a security review of proposed runtime and management scopes.~~ **Done 2026-07-21** —
  `docs/sdk/scope-security-review.md`. It found and fixed a MEDIUM: the management gate (decision 6)
  separated authority by the proxy `applicationId === null`, which a legacy runtime key with a null
  application_id could satisfy — a within-tenant escalation to author/publish definitions. The guard
  now carries an explicit `isSessionToken` signal and the gate tests that. One LOW (the managed-read
  paths use the same proxy but are scope-backstopped) is recorded for a follow-up, plus a
  defence-in-depth recommendation to land the never-shipped NOT-NULL on `api_keys.application_id`.
- ~~Define managed-delivery and attempt webhook schemas with compatibility guarantees.~~ Done —
  typed canonical events in SDK-002/005, `webhook-event-contract.spec`.
- ~~Implement the authoritative vertical increments and gates.~~ Done — SDK-003/004/005. SDK-004's
  AC02 channel clause was recorded a **reviewed non-applicability** (2026-07-21, `docs/sdk/evidence/sdk-004.md`)
  while SMS was the only managed channel, and is **implemented** by SDK-007 (Amendment A1 §5) — the
  first item that makes a second channel selectable.

## Amendment A1 — second managed channel: Email (accepted 2026-07-21, product owner)

Records the implementation decisions for extending the managed layer to Email in sandbox (SDK-007).
Amends, does not supersede, the Decision above. Design source: `docs/sdk/sdk-007-slice0-design.md`.

1. A managed definition **version is single-channel**; content is polymorphic on `channel` (SMS `body`;
   Email `subject`/`text`/`html`, ≥1 of text/html). `variableSchema` is channel-agnostic and shared.
   Multi-channel-per-intent remains routing (SDK-008, which carries its own ADR).
2. The managed engine **dispatches by channel** onto per-channel runtimes; Email reuses the existing
   direct-Email sandbox provider path (`FakeEmailProvider`) as its runtime. No second engine, delivery
   table, idempotency store, or wallet.
3. Delivery/attempt rows are **channel-tagged** (`channel` column; CHECK `IN ('sms','email')`); the
   delivery aggregate (Decision 1) is unchanged — it already owns zero-or-more channel attempts.
4. **Pricing is per-channel and pure:** SMS by `rateSegments`, Email by `rateEmailBySize` (size-tiered,
   rendered-byte bands with a hard-ceiling blocker). Preview and send price through the same function.
5. The generated catalog carries `channel` and **compile-time constrains `messages.send`** by it,
   closing this ADR's AC02 follow-up.
6. Execution/acceptance/idempotency/webhook/privacy semantics are unchanged — ADR-0006 governs them and
   applies to the Email runtime as-is.

**Scope guard:** no live Email path, provider, domain selector, capability-matrix entry, or catalog
channel ships until its real execution path exists and is tested. Live Email is SDK-009, behind the live
redline. Sandbox Email stays absent from all public surfaces until the SDK-007 release gate.
