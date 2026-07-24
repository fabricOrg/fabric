# Send SMS controlled-send audit

**Status:** accepted for implementation

**Reviewed:** 2026-07-15

**Surface:** Dashboard `/send`, its BFF route, and the public single-message API

## User job

An authorized customer operator needs to send one controlled message, understand whether it uses
the virtual phone or a real carrier, see the wallet impact, and open the resulting delivery record.
Bulk delivery belongs to Campaigns or a future batch API with durable per-recipient results.

## Confirmed findings

| Risk | Confirmed behavior | Decision |
| --- | --- | --- |
| Sender approval | The page invented `Fabric`, listed pending/rejected senders, and treated missing approval as a warning although the live API blocks it. | Live mode lists only active sender IDs for the destination. Virtual mode may use a sandbox sender. Missing approval is a blocking state with a link to Sender IDs. |
| Traffic classification | The page hard-coded transactional and the BFF discarded `class`. | Require an explicit transactional/promotional choice, validate it at the BFF boundary, and forward it unchanged. |
| Partial sends | The browser looped over recipients. A later failure hid earlier sends and a retry could duplicate charges. | `/send` accepts one recipient. Bulk work remains out of this page until a batch contract supplies idempotent per-recipient outcomes. |
| Retry safety | The dashboard did not send an `Idempotency-Key`. | Generate one stable key per unchanged submission and forward it to the API. Reuse it for a retry of the same payload. |
| Money display | Success repeated a client estimate instead of the API-returned charge. | Label the pre-send amount as an estimate and display the API-returned cost after success. A server quote remains the source-of-truth follow-up. |
| Dependency failures | Sender and consent failures were swallowed, leaving misleading controls. | Treat wallet, sender, consent, and delivery-mode data as required context with loading, error, retry, and empty states. |
| Live mode | The page ignored the settings `locked` and `reason` fields. | Show an explicit virtual/live banner and the platform-provided reason. Map controlled-live-recipient rejection to actionable UI copy. |
| Carrier coverage | A country-wide `active` status cannot express Arkesel non-MTN availability while MTN remains pending. | Do not claim carrier-wide approval. The first live drill uses an owner-approved number with known coverage. Carrier-level approval is a production follow-up. |
| Template state | The picker forced an empty value, so the chosen template never appeared and there was no explicit return to a normal message. Saved templates lived only in one browser. | Persist templates under tenant RLS, add a Templates management page, make the picker controlled, and provide an explicit `Custom message` option. Editing applied content detaches it from the selected template. |

## Acceptance criteria

- Exactly one valid E.164 recipient is accepted.
- Live mode exposes only active sender IDs for the recipient country; no sender is fabricated.
- Virtual mode is visibly non-carrier delivery and can use the sandbox sender.
- Message classification is explicit and reaches `/v1/sms/send` unchanged.
- Every dashboard send carries a non-empty idempotency key; an unchanged retry reuses it.
- The send action stays disabled with an explanation while required context is loading, failed, or incomplete.
- Pre-send money is labelled as an estimate. Success uses the cost returned by the API.
- Structured sender, allowlist, balance, compliance-window, and provider errors remain recoverable.
- SMS templates are tenant-persisted, manageable from a dedicated page, visible when selected, and
  reversible to a custom message without losing the current body.
- Automated tests cover classification forwarding, idempotency forwarding, single-recipient parsing,
  live sender blocking, and virtual-mode behavior.

## Residual follow-ups

1. Ship the F5.5 server-side quote endpoint before reseller-specific or carrier-specific pricing
   diverges from the shared default rate table.
2. Model provider/carrier approval coverage before general Ghana production delivery; do not infer a
   subscriber's current carrier from number prefixes because mobile number portability exists.
3. Build bulk send as a durable server-side workflow with stable batch and recipient idempotency,
   partial-result reporting, and reconciliation.
