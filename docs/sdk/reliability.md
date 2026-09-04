# Reliable requests

Every HTTP attempt has a 10-second default timeout and accepts `AbortSignal` plus a per-request
attempt timeout. Automatic retries can make total wall-clock time longer; use `AbortSignal` when the
calling job or request has an overall deadline.

```ts
const controller = new AbortController();
await fabric.sms.send(payload, {
  idempotencyKey: `invoice-${invoice.id}`,
  signal: controller.signal,
  timeout: 5_000,
});
```

The SDK retries connection failures, HTTP 429, and selected 5xx responses with bounded exponential
backoff and jitter. It respects numeric `Retry-After`. Reads are retryable. A write is retryable only
when that endpoint durably implements `Idempotency-Key` and the caller supplies one; the same key is
reused on every attempt. Direct SMS/Email sends and Verify start accept an optional key; batch,
WhatsApp, and managed sends require one. Sender-ID, Verify check, and webhook-management writes do
not implement replay storage and are never retried automatically.

Use one stable key per business action, store it with that action, and reuse it after uncertain
outcomes. Never generate a fresh key inside a retry loop. A changed request with a reused key returns
a typed conflict instead of creating a second effect.
