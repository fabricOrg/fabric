# Reliable requests

Every request has a 10-second default timeout and accepts `AbortSignal` plus a per-request timeout.

```ts
const controller = new AbortController();
await fabric.sms.send(payload, {
  idempotencyKey: `invoice-${invoice.id}`,
  signal: controller.signal,
  timeout: 5_000,
});
```

The SDK retries connection failures, HTTP 429, and selected 5xx responses with bounded exponential
backoff and jitter. It respects numeric `Retry-After`. Reads are retryable. Writes are retryable only
when the caller supplies an idempotency key; the same key is reused on every attempt.

Use one stable key per business action, store it with that action, and reuse it after uncertain
outcomes. Never generate a fresh key inside a retry loop. A changed request with a reused key returns
a typed conflict instead of creating a second effect.
