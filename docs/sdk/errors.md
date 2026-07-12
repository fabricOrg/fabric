# Error reference

All SDK errors extend `FabricError` and expose `code`, `message`, `statusCode`, `requestId`, `details`,
and `retryable`. Specialized classes are `AuthenticationError`, `AuthorizationError`,
`ValidationError`, `RateLimitError`, `ConflictError`, `NotFoundError`, `TimeoutError`,
`ConnectionError`, `UserAbortedError`, and `WebhookVerificationError`.

Use the class for broad recovery and stable `code` for a specific workflow. Show safe messages to an
operator and retain `requestId` for support. Do not branch on message prose.

## SMS encoding limits

| Encoding | Single segment | Multipart segment |
| --- | ---: | ---: |
| GSM-7 | 160 septets | 153 septets |
| UCS-2 | 70 characters | 67 characters |

Fabric computes encoding, segments, and cost server-side. Client estimates are advisory; emoji and
non-GSM characters can switch a message to UCS-2.
