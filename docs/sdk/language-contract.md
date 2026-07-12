# Language-neutral SDK contract

Future SDKs should preserve concepts while using native language idioms.

| Concept | Contract |
| --- | --- |
| Client | One server-side client configured by secret key; environment derived from key |
| Resources | `sms`, `email` when available, `senderIds`, `verify`, `wallet`, `webhooks` |
| Methods | `send`, `retrieve`, `list`, `create`, `remove`, and explicit page iteration |
| Response | Typed data plus request ID, status, and retry count |
| Errors | Stable category/class, code, status, request ID, details, retryability |
| Money | Integer minor units encoded as strings; never floating point |
| Dates | ISO-8601 transport strings |
| Idempotency | Caller-provided stable key retained across retries |
| Retry | Transient failures only; writes require idempotency; jitter and server guidance |
| Cancellation | Native mechanism: `AbortSignal`, context, cancellation token, or equivalent |
| Webhooks | Raw-body verification, bounded timestamp tolerance, constant-time compare, unknown events |
| Versioning | Semantic versions and documented deprecation/migration policy |

TypeScript uses promises and `AbortSignal`; Go should use `context.Context`; Python should follow the
chosen sync/async strategy; Java and .NET should expose native cancellation and builders/request
objects; PHP should follow Composer and PSR conventions. Syntax uniformity is not a goal.
