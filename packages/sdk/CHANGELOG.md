# Changelog

## 0.1.0-beta.2

- Publish under the `fabric-messaging` package identity with complete registry metadata.
- Bundle a generated OpenAPI 3.1 specification and enforce freshness in the release gate.
- Validate every supported resource response against canonical contracts at runtime and in tests.

## 0.1.0-beta.1

- Initial prerelease client for SMS, message status/listing, Verify, Wallet, Sender IDs, and webhooks.
- Typed errors, finite timeouts, cancellation, safe retries, idempotency, request IDs, and metadata.
- Secure raw-body webhook verification with timestamp validation and constant-time comparison.

Email, batch sending, cursor pagination, and CommonJS are intentionally not included in this beta.
