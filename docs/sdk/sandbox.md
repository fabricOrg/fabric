# Sandbox and Virtual Phone

An `sk_test_…` key always routes SMS to Fabric’s Virtual Phone. It runs the same validation,
consent, wallet reservation, message persistence, delivery-event, webhook, and reporting paths as
live delivery, but it never contacts a carrier.

Every workspace receives a stable, non-routable `+999…` virtual number. Open Dashboard → Virtual
phone to inspect conversations, reply as the handset, send `STOP`, `START`, or `HELP`, page older
history, search an exact E.164 recipient, or clear the inbox. Message bodies and phone numbers remain
in the PII vault and are removed after 30 days by the scheduled retention job.

Successful virtual sends reserve funds to exercise the real insufficient-balance path, then refund
at terminal delivery so their net cost is zero. These reserved test recipients produce deterministic
outcomes:

| Recipient suffix | Result | Billing behavior |
| --- | --- | --- |
| `0000` | `undelivered` carrier rejection | committed, matching a carrier-accepted rejection |
| `0001` | `failed` platform fault | refunded |
| `0002` | delayed `delivered` DLR | refunded |
| `0003` | `delivered`, then inbound `STOP` | refunded; future promotional sends are suppressed |

Use valid E.164 numbers ending in the suffix, such as `+233500000001`. These rules apply only to
virtual delivery; Fabric never interprets them specially in live mode.
