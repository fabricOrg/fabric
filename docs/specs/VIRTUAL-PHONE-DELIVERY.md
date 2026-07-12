# Virtual Phone Delivery

## Decision

Fabric uses one canonical message pipeline. Trusted tenant configuration resolves each send to
`virtual` or `live`; clients never choose a provider per request. Sandbox tenants are locked to
virtual delivery. Approved live tenants may switch between virtual delivery and Arkesel.

## Invariants

- Validation, consent, quiet hours, segmentation, wallet reservation, message persistence,
  idempotency, delivery events, and reporting run before or around both providers identically.
- A send records its resolved delivery mode and provider permanently.
- Virtual delivery never contacts a carrier and terminates in the tenant-scoped Virtual Phone inbox.
- Live delivery requires an approved sender ID and uses Arkesel.
- Text works in both modes. Virtual media is allowed after media persistence lands; Arkesel SMS
  rejects media before wallet reservation because SMS cannot carry images.
- Campaign execution must create canonical messages through this pipeline, not synthetic counters.

## Configuration

`accounts.settings.messaging.delivery_mode` is `virtual` or `live`.

- Sandbox: forced `virtual`.
- Live: Owner/Admin may toggle.
- Enabling live requires an active carrier sender.
- Changes are audited and do not affect queued or historical sends.

## Initial Acceptance Slice

1. Dashboard and API text sends route to `virtual-phone` in virtual mode.
2. The normal compliance, wallet, message, and DLR lifecycle executes.
3. The customer can inspect the canonical message in a tenant-isolated Virtual Phone inbox.
4. A live-mode send routes to Arkesel without changing the send request.
5. Existing legacy fake-provider tests remain available for deterministic fault injection.

## Follow-on Slices

- Media assets and virtual image messages with explicit Arkesel capability rejection.
- Persisted campaigns executed through canonical sends.
- Multiple virtual devices, read state, and inbox reset controls.
