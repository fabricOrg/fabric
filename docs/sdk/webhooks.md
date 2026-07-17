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

## Delivery reliability and replay

Fabric creates one durable delivery per event and endpoint. A failure at one endpoint never causes a
successful endpoint to receive another request. Failed deliveries use bounded exponential backoff
and become `dead` after ten attempts; they remain visible in the dashboard and API.

```ts
const dead = await fabric.webhooks.listDeliveries(endpointId, { state: "dead" });
await fabric.webhooks.replayDelivery(endpointId, dead.data[0]!.id);
```

Replay preserves the original event ID and appends to the attempt history. Store processed event IDs
under a unique constraint before applying a side effect: a receiver can accept an event and time out
before Fabric sees the response, so at-least-once delivery can produce a duplicate. Events from
different resources or endpoints can arrive out of order. Current direct-message events do not carry
a resource-version counter; do not regress a terminal status, and use message retrieval as the
canonical recovery path when ordering is uncertain.

Disabling an endpoint stops new claims and converts pending work to visible dead records while
retaining history. A delivery already accepted by the receiver before disable can still have taken
effect, so event-ID deduplication remains mandatory.

Endpoint secrets are shown once. Store them in a secret manager, rotate by registering a replacement
endpoint, and never put them in logs. Fabric accepts HTTPS endpoints that resolve only to public
addresses; redirects, credentials in URLs, private/link-local targets, and unbounded response bodies
are rejected.
