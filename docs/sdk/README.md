# Fabric SDK guides

Start with the package [quickstart](../../packages/sdk/README.md). These guides describe the
production concerns that should not obscure first success.

- [Authentication, environments, and key security](security.md)
- [Sandbox and Virtual Phone](sandbox.md)
- [Retries, idempotency, timeouts, and cancellation](reliability.md)
- [Webhook verification](webhooks.md)
- [Framework and worker examples](examples.md)
- [Errors](errors.md)
- [Versioning, compatibility, and releases](releasing.md)
- [Language-neutral SDK contract](language-contract.md)

## Current API capability matrix

| Capability | SDK | Public API | Notes |
| --- | --- | --- | --- |
| Send SMS | Yes | `POST /v1/sms/messages` | Idempotency supported; `/sms/send` is a compatibility alias |
| Retrieve/list SMS | Yes | `GET /v1/sms/:id`, `GET /v1/messages` | List is not yet paginated |
| Verify OTP | Yes | `POST /v1/verify`, `/check` | Sandbox may return a debug code |
| Sender IDs | Create/list | `POST/GET /v1/senders` | Retrieve-by-ID is not available |
| Webhooks | Create/list/delete + local verification | `/v1/webhooks` | Secret shown once |
| Wallet | Retrieve | `GET /v1/wallet` | Exact minor-unit strings |
| Email | Send/retrieve/list | `/v1/email/messages` | Sandbox simulation; live fails closed pending provider/domain approval |
| SMS batch send | Send/retrieve | `/v1/sms/batches` | Up to 100 items with durable per-item outcomes |

Documentation must be updated with the public API and SDK in the same change whenever this table
changes.
