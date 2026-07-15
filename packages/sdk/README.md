# Fabric TypeScript SDK

The official server-side TypeScript client for sending and inspecting messages with Fabric.

> Public prerelease: `0.1.0-beta.4`. Batch messaging remains unavailable until its public contract
> ships. Install the explicit `beta` channel until 1.0 is ready.

## Install

```bash
pnpm add @fabric-messaging/sdk@beta
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
const messages = await fabric.sms.list();
```

The current API returns a bounded message list without pagination. The SDK will add explicit pages
and async iteration when the public API supports cursors; it does not pretend to paginate today.

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

if (event.type === "sms.delivered") {
  console.log(event.data);
}
```

Verification uses HMAC-SHA256, constant-time comparison, and a five-minute timestamp tolerance by
default. Invalid, malformed, or stale events throw `WebhookVerificationError`.

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

## Environments and production

`sk_test_...` keys set `fabric.environment` to `sandbox`; `sk_live_...` keys set it to `production`.
No separate environment setting can conflict with the key. Moving to production changes only
`FABRIC_API_KEY`, but requires an approved sender ID, billing, provider configuration, and applicable
Ghana/Nigeria compliance approval.

Sandbox sends appear on the workspace’s two-way Virtual Phone and never contact a carrier. See the
[sandbox guide](../../docs/sdk/sandbox.md) for the stable virtual number, STOP/START replies, and
deterministic test recipients.

This package is for trusted server runtimes only. Never import it into browser code or expose secret
keys in client bundles, logs, commits, screenshots, or support tickets.

## Supported resources

- `fabric.sms.send`, `retrieve`, `list`
- `fabric.sms.sendBatch`, `retrieveBatch`
- `fabric.email.send`, `retrieve`, `list`
- `fabric.senderIds.create`, `list`
- `fabric.verify.start`, `check`
- `fabric.wallet.retrieve`
- `fabric.webhooks.create`, `list`, `remove`, `verify`

See [the SDK guides](../../docs/sdk/README.md) and bundled [OpenAPI reference](./openapi.json)
for retries, security, framework patterns, versioning, and the public wire contract. Report SDK issues through the repository issue tracker and
include the request ID—but never credentials or message content.

Maintainers validate a release candidate with `pnpm --filter @fabric-messaging/sdk release:check`; this builds,
tests, inspects, installs, and imports the packed artifact from a clean temporary project.
