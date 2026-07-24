# Changelog

## Unreleased

- Added `InsufficientFundsError` — a 402 now surfaces as a dedicated typed error instead of the
  base `ApiError`, matching the documented `insufficient_funds` failure.
- Documented that `webhooks.remove`/`webhooks.disable` are the same soft-delete call (the API
  marks the endpoint `disabled` and keeps delivery history).
- Added test coverage for email send/list, sender ID create, webhook create/remove, SMS detail
  retrieval, and the browser/base-URL/config guards.
- Added a lint step to `release:check`.

## 0.1.0-beta.5

- Normalized public environments to `sandbox | live` while retaining `sk_test_` and `sk_live_` key
  prefixes.
- Split read options from optional and required idempotent write options.
- Replaced unchecked generic webhook parsing with canonical direct-message events and an explicit
  signed unknown-event variant.
- Added the already-enforced Email permissions to the closed API-key scope catalog.

## 0.1.0-beta.4

- Added sandbox Email send, retrieve, and list through an application-scoped durable API.
- Moved SDK SMS sends to canonical `POST /v1/sms/messages`; the previous route remains compatible.
- Persisted encrypted dispatch material and atomic recovery intents for asynchronous SMS delivery.

## 0.1.0-beta.3

- Made the deployed Fabric API endpoint an SDK-owned default so consumers only need an API key.
- Kept `baseUrl` as an optional override for loopback development and private test deployments.

## 0.1.0-beta.2

- Documented the two-way sandbox Virtual Phone and deterministic test recipients.
- Added a complete server-side SDK playground covering every published resource.
- Kept the public SDK API compatible with beta.1.

## 0.1.0-beta.1

- First organization-scoped release as `@fabric-messaging/sdk`.
- Typed SMS, Verify, Wallet, Sender ID, and webhook resources with secure transport defaults.
- Bundled OpenAPI 3.1 specification, runnable examples, and artifact-level release validation.
- Secure raw-body webhook verification with timestamp validation and constant-time comparison.

## Legacy unscoped prereleases

`fabric-messaging@0.1.0-beta.1` and `0.1.0-beta.2` are deprecated. Install
`@fabric-messaging/sdk@beta` instead.

Cursor pagination and CommonJS are intentionally not included in this beta. (Email and batch
sending shipped in beta.4/beta.5 — earlier copies of this note predate them.)
