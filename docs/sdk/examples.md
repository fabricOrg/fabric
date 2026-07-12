# Framework and worker patterns

All examples load credentials from `FABRIC_API_KEY` and execute only on the server.

## Plain Node.js or background job

```ts
import { Fabric } from "@fabric-messaging/sdk";

const fabric = new Fabric({ apiKey: process.env.FABRIC_API_KEY! });
const job = { id: "job_123", phone: "+233545227189" };

await fabric.sms.send(
  { to: job.phone, senderId: "Fabric", body: "Your order is ready." },
  { idempotencyKey: `job-${job.id}` },
);
```

Persist the job ID and idempotency key. Queue delivery may repeat, so the handler must be replay-safe.

## Express

```ts
app.post("/fabric/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  const event = fabric.webhooks.verify({
    payload: req.body,
    signature: req.header("fabric-signature"),
    secret: process.env.FABRIC_WEBHOOK_SECRET!,
  });
  enqueue(event);
  res.sendStatus(202);
});
```

Register the raw parser before any JSON parser for this route.

## Fastify

Configure a content-type parser that preserves the raw buffer for the webhook route, then pass that
buffer to `verify`. Do not pass `request.body` after JSON parsing.

## NestJS

Enable raw-body capture in the Nest Fastify adapter. A controller should verify `request.rawBody`,
enqueue the typed event, and return quickly; business processing belongs in a service/worker.

## Next.js route handler

```ts
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const event = fabric.webhooks.verify({
    payload: rawBody,
    signature: request.headers.get("fabric-signature") ?? undefined,
    secret: process.env.FABRIC_WEBHOOK_SECRET!,
  });
  await enqueue(event);
  return new Response(null, { status: 202 });
}
```

## Pagination and cancellation

`sms.list()` currently returns the API's bounded, non-paginated result. Do not build an unbounded
polling loop. Cancellation works on every network method through `RequestOptions.signal`.
