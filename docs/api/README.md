# Fabric public API reference

The generated [OpenAPI 3.1 document](openapi.json) describes the stable server-to-server endpoints
currently exposed by `@fabric-messaging/sdk`: SMS send/status/list, Verify, Wallet, Sender IDs, and webhook
endpoint management.

Regenerate it after changing a public controller or wire contract:

```bash
pnpm --filter @fabric-messaging/sdk openapi:generate
```

`pnpm --filter @fabric-messaging/sdk release:check` fails when the committed artifact is stale. The Zod
schemas under `packages/contracts` remain the canonical application DTO definitions; the OpenAPI
generator explicitly models public wire differences such as `sender_id` and `currency` on SMS send.

## Authentication

Send application credentials as `Authorization: Bearer sk_test_...` or `sk_live_...`. These keys are
for trusted servers only and are unrelated to WorkOS dashboard sessions.

## Compatibility

The API is path-versioned under `/v1`. Additive fields are compatible. Removing or renaming a field,
changing its meaning, or tightening accepted input requires a migration plan and a new compatible
surface rather than silently breaking v1.

Email, batch sending, sender retrieval by ID, and cursor pagination are omitted because those public
endpoints are not implemented. The reference must never imply a capability the platform cannot run.
