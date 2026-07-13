# Public API completion ledger

This ledger maps the public API completion objective to authoritative implementation evidence. A
row is **complete** only when the deployed API has been exercised through the published SDK; unit
tests or a controller alone are not sufficient.

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Published SDK works without endpoint configuration | SDK beta.3 owns a default URL and its release gate passes. The generated testing CloudFront hostname currently returns DNS NODATA, so a live SDK call cannot complete. | Blocked by testing edge availability |
| Sandbox key sends SMS | SMS API, wallet reservation, provider simulation, queue worker, Virtual Phone, and integration tests exist. A deployed SDK-key smoke is still required. | Partial |
| Sandbox key sends Email | No Email contract, persistence, provider, API controller, SDK resource, or worker exists. | Missing |
| Requests are application-scoped | API keys resolve application/environment IDs, but messages and outbox events are tenant-only and message reads do not filter by environment. | Missing |
| Cross-tenant access is impossible | FORCE RLS and integration coverage exist for the current tenant tables. New public messaging tables must receive the same policies and denial tests. | Partial |
| Message creation is idempotent | SMS has persistent idempotency claims and replay/conflict tests. Email and batch do not exist. | Partial |
| Processing is asynchronous and durable | BullMQ handles SMS when Redis is configured, but enqueue happens after the database transaction; a crash can strand a reservation until the sweeper. | Missing durable enqueue |
| Provider responses are normalized | SMS plugins normalize fake, Virtual Phone, and Arkesel results. Email has no provider contract. | Partial |
| Status retrieval and listing | SMS retrieve/list exist, but use SMS-specific paths and tenant-wide reads rather than application/environment scoping. | Partial |
| Signed webhooks are reliable | Transactional status outbox, signed delivery, retry cap, and tests exist. Fan-out currently ignores endpoint environment. | Partial |
| Errors map into SDK types | Structured API envelopes and SDK mappings are tested for the current SDK surface. | Partial |
| Rate limits and quotas | Per-key and per-tenant Redis token buckets exist and fail open on store loss. Product quotas and channel/batch limits are not complete. | Partial |
| Production prerequisites cannot be bypassed | Environment routing, live lock, sender approval, provider readiness, consent, wallet, and kill-switch gates exist for SMS. Email prerequisites do not exist. | Partial |
| API keys revoke safely | Hashed keys, revoked/expired checks, scopes, and tests exist. | Implemented; deployed SDK smoke required |
| Sandbox and production share a contract | SMS routes share a contract and route by environment. Email/batch contracts do not exist. | Partial |
| OpenAPI matches implementation | Generated OpenAPI is release-checked for the current SDK surface. Canonical `/v1/sms/messages`, Email, batch, pagination, and app scoping remain absent. | Partial |
| Contract and end-to-end tests pass | Current repository verification passes. Missing capabilities have no tests by definition. | Partial |
| Production logs and metrics | Request logs, request IDs, queue logs, CloudWatch infrastructure, and alarms exist. Dispatch-outbox lag/dead-letter metrics are missing. | Partial |
| No secrets or PII exposed | Keys are hashed, logs redact secrets, SMS recipient PII uses the vault. Queue payloads still contain transient raw recipient/body data. | Partial |
| Versioned and ready for public use | `/v1` exists and npm prereleases are published. Stable DNS and the missing public capabilities block readiness. | Not ready |
| Quick start reaches sandbox success | Playground needs only an API key in source, but deployed endpoint availability and a live SDK-key smoke remain unresolved. | Blocked |

## Next vertical slice

The next slice is the canonical SMS journey:

1. Introduce `POST /v1/sms/messages` while retaining `/v1/sms/send` as a compatibility alias.
2. Persist application/environment context and encrypted dispatch material with the message.
3. Insert a dispatch intent in the same transaction as the message and wallet reservation.
4. Drain dispatch intents asynchronously with retry-safe provider calls.
5. Scope reads and webhook fan-out to the presenting environment.
6. Exercise create, process, webhook, retrieve, and list through the SDK against a real Postgres and Redis.

Email and batch build on that durable, application-scoped messaging spine rather than introducing a
second reliability model.
