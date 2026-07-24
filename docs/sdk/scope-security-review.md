# Managed messaging — runtime/management scope security review

> ADR-0005 follow-up ("complete a security review of proposed runtime and management scopes").
> Performed 2026-07-21. Reviewer: assistant, on behalf of the product owner. Scope: the API-key
> scope catalog, the `requireScope` enforcement points, and the runtime-vs-management authority
> separation (ADR-0005 decision #6).

## Scope and method

Audited every `requireScope(...)` call across `services/api/src/**/*.controller.ts`, the closed
`apiKeyScopeValues` catalog in `@app/contracts`, the two credential paths in `ApiKeyGuard`
(sk_* key resolve vs BFF tenant token), and the two gates that separate management authority from
runtime authority:

- `message-definitions.controller.ts` — authoring/publishing/archiving (write authority).
- `definition-catalog.controller.ts` — catalog read (`definitions:read`).
- `managed-messages.controller.ts` — delivery reads (dual authority).

Cross-tenant containment (RLS) was treated as out of scope here — it is covered by the real-Postgres
isolation suites — except to confirm each finding stays within a single tenant.

## Findings

### F1 — Management authority could be bypassed by a runtime key with a null application_id (MEDIUM) — FIXED

**Decision #6** requires that authoring/publishing definitions need a dashboard session or operator,
never a data-plane `sk_*` key. The gate (`resolveManagementTenant`) enforced this by testing
`req.tenant.applicationId === null` — treating a null application id as proof of a session, because a
BFF tenant token leaves it null while a scoped key sets it.

That is a **proxy**, not the real signal. `ApiKeyGuard.resolve()` also produces
`applicationId: null` for any `sk_*` key whose `api_keys.application_id` column is null. That column
is **nullable** (`packages/db/src/schema/api-keys.ts` — added nullable in migration 0047 for the
two-step backfill; the planned NOT-NULL follow-up never shipped, and there is no CHECK). So a
legacy or un-backfilled runtime key with a null application id — **regardless of its scopes** —
satisfied the gate and could author, publish, and archive message definitions for its tenant.

- **Impact:** within-tenant privilege escalation (RLS still confines it to the key's own tenant; the
  handler derives the tenant from the token, never the client). A key intended only to
  send/read could mutate customer-facing content and routing — exactly the least-privilege
  violation the ADR's rejected-alternative "allow runtime keys to publish" calls out.
- **Likelihood:** newly created keys always set application_id (`ApiKeyService.create` resolves an
  environment first), so exposure is limited to legacy/un-backfilled active keys. The deployed
  testing env was backfilled. But the code permits it and the safety rested on an unenforced,
  far-away invariant — defence-in-depth was absent at the gate.
- **Fix:** the guard now carries an explicit `isSessionToken` on `RequestTenant`, set `true` only on
  the BFF tenant-token branch and `false` on the key-resolve branch. `resolveManagementTenant` tests
  that authoritative flag instead of the applicationId proxy, so a null-app key can never be mistaken
  for a session. Regression test: `message-definitions.controller.spec.ts` "rejects a runtime key
  with a NULL application_id (the escalation vector)"; the guard specs now assert the flag's value on
  both paths.

### F2 — Managed-delivery reads use the same applicationId proxy (LOW) — noted, not changed

`managed-messages.controller.ts` (`list`, `readScope`) branches on `request.tenant?.applicationId` to
pick between "scoped key reads its own env" and "tenant token names the env explicitly". A null-app
key falls into the second branch. Unlike F1 this is **scope-backstopped**: the second branch still
requires `sms:read`, so a null-app key gains no management authority — at most it could read
deliveries in a caller-named environment within its own tenant rather than being pinned to its own
env. Read-only, same-tenant, requires a valid scope.

Not changed in this pass: migrating these read paths to `isSessionToken` is correct for consistency
but touches read semantics (the env-selection model) and deserves its own change with its own tests,
rather than being bundled into the authority-escalation fix. Recorded here so it is not lost.

### Scope catalog — no issues found

The closed `apiKeyScopeValues` catalog matches the enforced endpoints. `definitions:read` is
least-privilege and cannot send, publish, or retrieve content — now proven both directions
(`api-key.guard.spec.ts` closed-catalog denial; `definition-catalog.controller.spec.ts` send-only and
unscoped-token rejections). Wildcard `["*"]` is confined to the BFF tenant token, where the BFF has
already enforced the user's membership permissions before minting it.

## Residual / recommended follow-ups

1. **Land the never-shipped NOT-NULL migration on `api_keys.application_id`** (with a preceding audit
   for existing null rows), as defence-in-depth behind F1. The guard fix removes the exploit; the
   constraint removes the anomalous data shape entirely.
2. **Migrate the F2 read paths to `isSessionToken`** for consistency, with tests.
3. Re-run this review when SDK-007/008 add management scopes or a second channel.
