# ADR-0011 — External providers are control-plane plugins, not environment variables

**Status:** Proposed · **Date:** 2026-07-27 · Supersedes the env-var provider selection in
`sms-providers.ts`. Builds on [PI-5/PLUGIN-REGISTRY.md](../PI-5/PLUGIN-REGISTRY.md) (design v1),
which specified this and was only partly built.

## Context

Every external service — SMS carriers, payment processors, email senders — is a **plugin**. Adding
one, swapping one, or taking one live must be a control-plane action, not a redeploy.

Today it is the opposite. Provider selection is `SMS_PROVIDER`, credentials are `ARKESEL_API_KEY`,
and mode is `ARKESEL_SANDBOX`. `SmsRuntimeService` reads them **once at construction**, so changing
any of it requires an env edit plus a restart. Meanwhile `plugin_instances` exists, the admin
console renders it, and `PluginRegistryService.resolve()` is implemented — but nothing in
`services/api/src/sms/` imports it. The registry is decorative: toggling Arkesel on the Plugins page
changes nothing.

That is worse than having no page at all. A staff surface that appears to configure providers and
doesn't is precisely the "mock that masks reality" CLAUDE.md forbids.

### What already exists (do not rebuild)

- `plugin_instances` with `capability, vendor, label, enabled, is_default, mode, status, priority,
  credentials_ref` — the shape is right.
- `PluginRegistryService.list/resolve/apply` — `resolve()` already returns the enabled instances for
  a capability ordered by priority. It is the intended selection/failover mechanism.
- Envelope-encryption primitives in `@app/db` (`newDek`, `wrapDek`, `unwrapDek`, `encryptPii`,
  `decryptPii`) — AES-GCM, generic despite the PII naming.
- `SmsSenderPlugin.configSchema` — each adapter already declares its credential shape.
- Maker-checker proposals + audit — reusable for the go-live gate.

### What is missing

1. Nothing calls `resolve()` from a send path.
2. `credentials_ref` is never written or read. There is no `configure()`, and no credential store.
3. `unique(capability, vendor)` forbids two instances of one vendor — so sandbox and live cannot
   coexist, and a second account is impossible.
4. No `tenant_id`, so a per-tenant provider override cannot be expressed.
5. No go-live machinery: `mode` is a column nothing enforces.
6. `apply('enable')` sets `status: 'connected'` **without calling the provider**. The status is a
   guess presented as fact.

## Decision

### 1. Credentials live in the control plane, encrypted at rest

New `plugin_credentials`: `id, plugin_instance_id, dek_wrapped, ciphertext, iv, tag, fingerprint,
created_at, rotated_at`. `plugin_instances.credentials_ref` points at the active row.

Reuse the existing envelope helpers. **Exactly one secret stays in the environment** — the root key
(`PLUGIN_MASTER_KEY`). That is unavoidable: a system that decrypts anything must hold one root
secret. Everything else becomes data a staff user can manage.

Credentials are **never** returned by any read API. Reads expose a `fingerprint` only (last 4 plus
length) so staff can confirm *which* key is installed without being able to read it. Rotation writes
a new row and repoints `credentials_ref`, so the previous value stays recoverable until pruned.

`configure(id, creds)` validates against the adapter's own `configSchema` before writing — an
Arkesel instance cannot be saved without an `apiKey`.

### 2. Instance identity widens

Replace `unique(capability, vendor)` with `unique(tenant_id, capability, vendor, mode)` and add a
nullable `tenant_id` (null = platform-wide). This admits the cases the current constraint forbids:
sandbox and live side by side, two accounts with one vendor, and a per-tenant override later without
another migration.

### 3. A vendor→adapter registry

One map in `@app/integrations`: `vendor` string → factory returning the `SmsSenderPlugin`. The
registry stays the only place that knows vendor names. Adding a carrier becomes: implement the
adapter, add one map entry, insert a catalog row — no change to the send path.

### 4. Resolution is cached, and fails closed

`deps()` becomes async and resolves through a `PluginResolver`:

- short-TTL cache (~30s) keyed `(capability, tenant, mode)`, so the control plane is **not** in the
  hot path (Principle #7);
- on a store failure, serve last-known-good;
- with no last-known-good, **fail closed** for a live send.

It must never fall back to the fake provider. Falling back would report success for a message that
was never sent — the exact failure mode that made the first live test look like it had worked.
Sandbox may fall back to the fake provider, because that is what sandbox means.

### 5. Go-live is gated, and mode is enforced

Flipping an instance sandbox→live requires all of: validated credentials present, an explicit
`activate-live` action, maker-checker approval, and an audit record. A `live` environment resolves
only `live`-mode instances; a `sandbox` environment only sandbox. Mode stops being decorative.

### 6. Status must be earned

`status` derives from a real `healthCheck()` or the outcome of the last dispatch — never from the
enable toggle. `connected` means we have actually talked to the vendor. Until then, `available`.

### 7. Env vars become a seed, then die

A one-time migration reads today's `ARKESEL_API_KEY` / `SMS_PROVIDER` / `ARKESEL_SANDBOX` and writes
the equivalent instance plus credential. After that the env path is deleted, not left as a fallback
— two sources of truth for provider selection is how this drifted in the first place.

## Consequences

**Good.** Adding or swapping a carrier is a staff action, not a deploy. Credentials rotate without a
restart. Failover is real, because `resolve()` returns an ordered chain the dispatcher can walk.
Per-tenant providers become expressible. The Plugins page stops lying.

**Costs.** A DB read enters the send path — mitigated by the TTL cache, and it is the same trade
already accepted for kill-switches and pricing. `PLUGIN_MASTER_KEY` becomes a rotation
responsibility. `deps()` turning async touches every caller.

**Risk.** Credentials move from a platform secret store into our database. Mitigated by envelope
encryption, never returning plaintext, and fingerprint-only reads — but it does mean the database
becomes a higher-value target, and `PLUGIN_MASTER_KEY` must not live beside it.

## Slices

1. `plugin_credentials` + envelope wrapper + `configure()` + fingerprint reads. No routing change.
2. Vendor→adapter registry + `PluginResolver` with cache and fail-closed. `deps()` reads it, env
   still seeds it.
3. Widen the unique constraint; add `tenant_id`; sandbox and live instances coexist.
4. Go-live gate through maker-checker + real `healthCheck()`-derived status.
5. Seed migration from env, then delete the env path.

Slices 1–2 are enough to configure Arkesel from the admin console. 4 is required before any hosted
live send.
