# Verify Fabric webhooks

Fabric sends `fabric-signature: t=<unix>,v1=<hex>` where `v1` signs `<timestamp>.<raw-body>` with
HMAC-SHA256. `fabric.webhooks.verify` checks syntax, timestamp tolerance, signature in constant time,
and only then parses JSON.

Capture the raw bytes before framework body parsing. A parsed object re-serialized to JSON is not the
signed payload. Return 2xx only after durable acceptance; use event IDs for application-level replay
deduplication. Unknown event types remain parseable so adding a Fabric event does not crash older SDKs.

The SDK returns a discriminated union. Direct-message event types are `message.sent`,
`message.delivered`, `message.undelivered`, `message.failed`, and `message.inbound`. A correctly
signed newer event has `type: "unknown"` and preserves its wire name in `originalType`; callers cannot
assert an unchecked generic payload type through `verify`.

Never bypass verification on parsing failures. Never log webhook secrets or full payloads.
