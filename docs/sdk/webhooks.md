# Verify Fabric webhooks

Fabric sends `fabric-signature: t=<unix>,v1=<hex>` where `v1` signs `<timestamp>.<raw-body>` with
HMAC-SHA256. `fabric.webhooks.verify` checks syntax, timestamp tolerance, signature in constant time,
and only then parses JSON.

Capture the raw bytes before framework body parsing. A parsed object re-serialized to JSON is not the
signed payload. Return 2xx only after durable acceptance; use event IDs for application-level replay
deduplication. Unknown event types remain parseable so adding a Fabric event does not crash older SDKs.

Never bypass verification on parsing failures. Never log webhook secrets or full payloads.
