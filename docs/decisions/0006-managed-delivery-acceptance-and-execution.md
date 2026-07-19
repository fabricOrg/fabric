# ADR 0006: Managed delivery acceptance and execution semantics

Status: **accepted 2026-07-19** (product owner), alongside
[ADR 0005](./0005-managed-messaging-sdk-resource-model.md) — the two were ratified together because
0005's resource model is unimplementable without the acceptance, money, and idempotency semantics
defined here. Ratified **retrospectively**: the semantics shipped across SDK-005 under an explicit
per-slice go. As-built evidence: `docs/sdk/evidence/sdk-005.md`.

Superseded status line: _proposed 2026-07-15 (requires product, security, wallet, and platform
review)._ Acceptance records the product owner's decision; it does **not** assert that separate
security, wallet, or platform reviews were performed. The scope security review carried on 0005
remains open and applies here too.

## Context

ADR 0005 defines a managed delivery aggregate with channel attempts. A production contract also
needs to define when that aggregate is accepted, how its money and idempotency guarantees survive
retries, how customers correlate it, and how asynchronous events are applied safely.

The existing direct API has a generic 24-hour idempotency replay table and synchronously reserves
SMS cost before queueing provider work. Reusing that model without refinement would make a delayed
managed retry capable of duplicating a delivery, allow cross-application key collisions, and leave
the meaning of `accepted` unclear for fallback and broadcast.

## Decision

1. A managed delivery reaches `accepted` only after Fabric durably records the resolved immutable
   definition version, route plan, delivery, planned initial attempts, resource-level idempotency,
   required initial wallet reservations, and acceptance outbox event. Provider contact remains
   asynchronous.
2. Priority reserves its selected attempt before acceptance. Broadcast reserves every planned
   attempt atomically. Fallback reserves its first attempt before acceptance and any later attempt
   just in time. A later fallback may fail for insufficient balance or a caller cost ceiling.
3. Managed deliveries and Journey runs store a hashed idempotency key and canonical normalized
   request hash under a unique tenant/application/environment/operation scope for the resource's
   audit retention. They do not depend solely on the generic HTTP idempotency TTL.
4. Idempotency is retry identity only. Managed inputs add bounded, non-sensitive `reference` and
   flat string `metadata` for customer correlation. Neither affects deduplication.
5. Managed webhooks are typed SDK-owned event unions with required event ID, environment, API
   version, resource version, and non-sensitive resource data. Events are at-least-once and may be
   out of order; retrieval is canonical.
6. Published definition releases are data-plane-readable durable state. Sending does not call the
   dashboard, a remote control-plane service, or a provider management API.
7. Variable data, rendered content, metadata, and generated contracts follow separate privacy
   classes. Generated output and webhook payloads never contain raw variables, rendered content,
   recipient addresses, idempotency keys, or provider secrets.
8. One managed delivery has bounded channel amplification and one billing currency. Optional
   `limits.maxCost` caps committed cost plus currently held reservations for that delivery.
9. `POST /v1/message-deliveries` returns `202 Accepted`. Errors before durable acceptance throw
   synchronously and create no delivery; failures after acceptance are durable resource state and
   webhook outcomes.
10. Acceptance-time eligibility is rechecked immediately before provider contact. Revoked sender,
    changed consent, kill-switch, compliance, and later fallback funding can block an accepted
    attempt safely without changing the pinned content version.
11. Webhook fan-out records delivery independently for every event/endpoint pair. Successful
    endpoints are not resent solely because another endpoint failed; dead deliveries remain visible
    and user-authorized replay is audited.
12. The public environment vocabulary is `sandbox | live`, resource IDs are opaque strings, and
    internal `message.updated` events are translated into documented public event types.
13. Dashboard management authority and runtime API-key scopes remain separate. Runtime keys cannot
    draft, publish, promote, bind providers, or expand their own scopes.

## Alternatives rejected

- **Acknowledge before reservation:** lower request latency, but `accepted` would not prove the
  wallet gate and could immediately become an avoidable funding failure.
- **Reserve every possible fallback upfront:** guarantees future balance but locks funds for
  attempts that are normally never used.
- **Use only the generic 24-hour replay cache:** simpler, but retry safety expires independently of
  the durable business resource.
- **Use idempotency keys as customer references:** fewer fields, but encourages PII in keys and
  couples searchable business context to retry behavior.
- **Trust webhook arrival order:** no consumer bookkeeping, but retries and endpoint failures can
  regress customer state.
- **Persist all raw variables for debugging:** easier support, but materially increases PII exposure
  and retention risk.
- **Run definition resolution through the control plane:** centralizes management logic, but places
  dashboard availability in the message data path.
- **Retry one outbox event against every endpoint as a unit:** fewer rows, but repeatedly calls
  healthy endpoints and cannot represent endpoint-specific dead-letter or replay state.

## Consequences

- Managed creation needs domain-specific idempotency columns or a durable resource mapping in
  addition to the existing generic replay table.
- Route planning and initial reservation occur before the API response; provider I/O remains in a
  recoverable worker so request latency stays bounded.
- Broadcast is all-or-nothing for initial funding but can still become partially delivered because
  providers and recipients behave independently.
- Fallback exposes a documented residual funding risk instead of holding worst-case funds.
- Consumers need event-ID deduplication and resource-version ordering, with retrieve as recovery.
- Per-endpoint webhook delivery state adds storage and worker complexity but makes retries,
  dead-letter visibility, and replay correct and explainable.
- SDK and contract work must define strict input limits, reason codes, and event unions before the
  database and worker implementation harden accidental shapes.

## Follow-up

- Complete the threat model and wallet review before accepting this ADR.
- Define the canonical server-side serialization algorithm and fixtures for semantically equivalent
  validated JSON inputs.
- Define managed webhook schemas and event subscription migration.
- Confirm retention periods for delivery audit, PII vault content, and durable idempotency mapping.
- Implement the prioritized plan in
  [the final managed messaging SDK contract](../sdk/sdk-dx-iteration-3.md#prioritized-implementation-plan).
