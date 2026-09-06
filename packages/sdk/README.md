# Fabric TypeScript SDK

The official server-side TypeScript client for sending and inspecting messages with Fabric.

> Public prerelease: `0.1.0-beta.9`. Every release moves the `latest` tag, so a plain install gets
> the newest build — the `beta` tag is frozen at an older prerelease and should not be used.
> The package is ESM-only by design — Node.js 22.12+ (the supported floor) can `require()` it
> natively, so there is no separate CommonJS build.

## Install

```bash
pnpm add @fabric-messaging/sdk
```

Requires Node.js 22 or newer and a Fabric secret key. Create a sandbox key in Dashboard →
Applications → API keys, then store it outside source control:

```dotenv
FABRIC_API_KEY=sk_test_...
```

## Send your first SMS

```ts
import { Fabric } from "@fabric-messaging/sdk";

const fabric = new Fabric({ apiKey: process.env.FABRIC_API_KEY! });

const result = await fabric.sms.send(
  {
    to: "+233545227189",
    senderId: "SANDBOX",
    body: "Your first Fabric message",
  },
  { idempotencyKey: "quickstart-first-message" },
);

console.log(result.data.id, result.data.status, result.requestId);
```

Use a unique, stable idempotency key for the business action. Retrying the same action with the same
key prevents a duplicate charge/message. View the returned message ID in Dashboard → Logs.

## Retrieve and list messages

```ts
const message = await fabric.sms.retrieve("msg_...");

const page = await fabric.sms.list({ limit: 50 });
console.log(page.data.items.length, page.data.nextCursor);

// Or walk the whole log — the iterator follows next_cursor until it is null.
for await (const summary of fabric.sms.iterate({ limit: 100 })) {
  console.log(summary.id, summary.status);
}
```

Message, email, and webhook-delivery lists are cursor-paginated (`limit` 1–100, default 50). Treat
`nextCursor` as opaque: pass it back exactly as returned. `email.iterate`,
`messages.iterateDeliveries`, and `webhooks.iterateDeliveries` follow the same pattern.

## Send a sandbox Email

```ts
const email = await fabric.email.send(
  {
    to: "recipient@example.com",
    from: "hello@merchant.example",
    subject: "Welcome",
    text: "Your Fabric sandbox Email works.",
  },
  { idempotencyKey: "welcome-email-1" },
);
```

Sandbox Email is simulated inside Fabric and never contacts an external provider. Live keys fail
closed until an approved sending domain and production Email provider are configured.

## Verify webhooks

Always pass the untouched raw request body—not parsed/re-serialized JSON:

```ts
const event = fabric.webhooks.verify({
  payload: rawBody,
  signature: request.headers["fabric-signature"],
  secret: process.env.FABRIC_WEBHOOK_SECRET!,
});

if (event.type === "message.delivered") {
  console.log(event.data);
}

if (event.type === "unknown") {
  console.log("Upgrade the SDK to handle", event.originalType);
}
```

Verification uses HMAC-SHA256, constant-time comparison, and a five-minute timestamp tolerance by
default. Invalid, malformed, or stale events throw `WebhookVerificationError`. Known direct-message
events are `message.accepted`, `message.sent`, `message.delivered`, `message.undelivered`,
`message.failed`, and `message.inbound`; a correctly signed newer event returns the explicit
`unknown` variant.

Inspect and replay a dead endpoint-specific delivery without changing its event ID:

```ts
const dead = await fabric.webhooks.listDeliveries(endpointId, { state: "dead" });
const first = dead.data.items[0];
if (first) {
  await fabric.webhooks.replayDelivery(endpointId, first.id);
}
```

Webhook delivery is at least once. Persist event IDs under a unique constraint before applying side
effects; timeout-after-accept and manual replay can legitimately deliver the same event again.
The verified event always contains `id` and `createdAt`; missing envelope identity is rejected even
when the signature itself is valid.

## Handle errors

```ts
import { AuthenticationError, FabricError, RateLimitError } from "@fabric-messaging/sdk";

try {
  await fabric.sms.list();
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error("Retry later", error.retryAfter, error.requestId);
  } else if (error instanceof AuthenticationError) {
    console.error("Rotate or replace the API key", error.requestId);
  } else if (error instanceof FabricError) {
    console.error(error.code, error.message, error.requestId);
  }
}
```

Errors never include the API key, authorization header, or message body. Optional logger callbacks
receive only method/path/status/retry/request metadata.

## Sandbox and live environments

`sk_test_...` keys set `fabric.environment` to `sandbox`; `sk_live_...` keys set it to `live`.
No separate environment setting can conflict with the key. Moving to live delivery changes only
`FABRIC_API_KEY`, but requires an approved sender ID, billing, provider configuration, and applicable
Ghana/Nigeria compliance approval.

Sandbox sends appear on the workspace’s two-way Virtual Phone and never contact a carrier. The
sandbox guide on the Fabric docs site (`/docs/get-started/sandbox-and-keys`) covers the stable
virtual number, STOP/START replies, and deterministic test recipients.

This package is for trusted server runtimes only. Never import it into browser code or expose secret
keys in client bundles, logs, commits, screenshots, or support tickets.

## Supported resources

- `fabric.messages.send`, `preview`, `retrieveDelivery`, `listDeliveries`, `iterateDeliveries`,
  `listDeliveryWebhooks` (managed, template-key messages)
- `fabric.sms.send`, `retrieve`, `list`, `iterate`
- `fabric.sms.sendBatch`, `retrieveBatch`
- `fabric.email.send`, `retrieve`, `list`, `iterate`
- `fabric.whatsapp.send`, `retrieve`, `list`, `iterate`
- `fabric.senderIds.create`, `list` (bounded — sender IDs are few; not paginated)
- `fabric.verify.start`, `check`
- `fabric.wallet.retrieve`
- `fabric.webhooks.create`, `list`, `remove`/`disable`, `listDeliveries`, `iterateDeliveries`, `replayDelivery`, `verify`

`webhooks.remove` and `webhooks.disable` are the same call: the API soft-deletes, marking the
endpoint `disabled` while retaining its delivery history.

See the Fabric docs site (`/docs/sdks-tools/node`) and the bundled [OpenAPI reference](./openapi.json)
for retries, security, framework patterns, versioning, and the public wire contract. Report SDK issues through the repository issue tracker and
include the request ID—but never credentials or message content.

Maintainers validate a release candidate with `pnpm --filter @fabric-messaging/sdk release:check`; this builds,
tests, inspects, installs, and imports the packed artifact from a clean temporary project.
