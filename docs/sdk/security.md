# Authentication, environments, and key security

The SDK uses application secret keys for server-to-server authentication. It never uses WorkOS;
WorkOS authenticates people in Fabric Dashboard.

- Load `FABRIC_API_KEY` from a secret manager or local uncommitted environment file.
- Never hard-code, commit, print, forward, or place a secret key in browser code.
- Rotate a key by deploying the replacement, verifying traffic, then revoking the old key.
- Treat `AuthenticationError` with `invalid_api_key`, expired, or revoked codes as a rotation signal.
- The SDK derives `sandbox`/`live` from `sk_test_`/`sk_live_`; it has no conflicting environment flag.
- Base URL overrides require HTTPS, except loopback HTTP for local tests.

The SDK rejects obvious browser execution. Bundlers can still inspect imports before runtime, so keep
all SDK imports in server-only modules and route handlers.
