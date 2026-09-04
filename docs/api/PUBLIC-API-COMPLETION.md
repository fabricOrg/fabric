# Public API completion ledger

**As-built review:** 2026-08-29

This ledger records repository capability separately from deployed-environment evidence. A feature
is implemented when its contract, runtime path, and tests exist; it is release-proven only after the
published SDK exercises the deployed testing endpoint.

| Requirement | Repository evidence | Status |
| --- | --- | --- |
| SDK works without endpoint configuration | The SDK owns the public default URL; custom URLs are restricted to HTTPS or loopback development. | Implemented; deployed smoke required |
| Sandbox SMS | Canonical `POST /v1/sms/messages`, wallet/token backing, durable dispatch intent, fake provider, Virtual Phone, DLR, SDK resource, and integration coverage exist. | Implemented; deployed smoke required |
| Sandbox Email | Contract, persistence, simulated sandbox provider, durable worker/recovery path, public API, SDK resource, reads, and tests exist. | Implemented; deployed smoke required |
| Sandbox WhatsApp | Direct and managed send paths, templates, provider/webhook normalization, inbox, SDK resource, and tests exist. | Implemented; deployed smoke required |
| Application/environment scoping | API keys resolve application and environment IDs; SMS, Email, WhatsApp, managed deliveries, request logs, outbox events, and webhook fan-out persist or filter that context. | Implemented for current messaging surfaces |
| Cross-tenant isolation | Tenant tables use FORCE RLS and the real-Postgres suites exercise denial paths. New tenant tables still require an RLS policy and isolation test in the same change. | Implemented with ongoing gate |
| Idempotent message creation | Persistent claims protect direct SMS, Email, WhatsApp, managed messages, and SMS batches; protected writes can be retried safely. | Implemented |
| Durable asynchronous processing | A dispatch intent is written in the acceptance transaction and maintenance recovery re-enqueues committed intents that Redis did not durably accept. | Implemented |
| Provider normalization | Integration plugins normalize channel-specific provider results into Fabric statuses and errors. | Implemented for configured providers |
| Retrieval and pagination | SMS, Email, WhatsApp, managed-delivery, webhook-delivery, and request-log reads expose bounded or cursor-paginated contracts as applicable. | Implemented |
| Signed outbound webhooks | Transactional outbox, environment-scoped fan-out, HMAC signing, retries, dead state, replay, and SDK verification exist. | Implemented |
| Structured errors and request IDs | API success/error envelopes are runtime-bound to published contracts; SDK errors retain code, status, request ID, retryability, and details. | Implemented |
| Rate limits and sandbox quotas | Per-key/per-tenant rate limiting and per-environment sandbox allowances exist. Availability checks fail open where appropriate; money still fails closed. | Implemented |
| Production prerequisites | Live channel paths enforce environment, kill-switch, pricing/funding, sender/provider readiness, and compliance gates appropriate to the channel. | Implemented; live enablement remains human-gated |
| API-key lifecycle | Keys are environment/application scoped, hashed at rest, shown once, and checked for revoked/expired status and scopes. | Implemented |
| OpenAPI/runtime alignment | Public and internal artifacts are generated from the real Nest route table and checked for drift; runtime interceptors validate bound request/response schemas. | Implemented |
| SDK release integrity | Tests, typecheck, examples, build, pack inspection, OpenAPI drift, and clean-install artifact checks form the release gate. | Implemented |
| Production telemetry | Structured request logs, request IDs, queue/worker logs, CloudWatch infrastructure, and alarms exist. Operational dashboards should continue to cover dispatch recovery and dead-letter lag. | Implemented; operational coverage evolves |
| Secrets and PII | API keys are hashed, secrets are redacted, recipient/content PII uses the vault, and the SDK logger excludes credentials and message bodies. | Implemented with compliance review required for new fields |
| Stable public release | The package remains a prerelease; stable DNS/deployed SDK smoke and release evidence are still required before 1.0. | Not yet 1.0-ready |

## Release proof still required

1. Run the SDK quickstart against the deployed testing edge with a real sandbox application key.
2. Exercise SMS, Email, WhatsApp, batch, managed-message, retrieval, and webhook delivery through
   the published package rather than workspace source.
3. Record request IDs and update `docs/sdk/evidence/` with the tested package and image versions.
4. Keep live SMS and live payments disabled until an explicit human approval authorizes them.

The detailed capability matrix and SDK usage contract live in
[`docs/sdk/README.md`](../sdk/README.md). Update that matrix, the generated OpenAPI artifact, and
this ledger in the same change whenever a public capability changes.
