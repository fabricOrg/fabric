# Plugin Registry + Lighthouse Saga — Build Plan

> **Date:** 2026-07-05 · **Owner:** fifi · **Epics:** E16 (flow) + integrations · Builds on [`../INTEGRATIONS-PLUGIN-ARCHITECTURE.md`](../INTEGRATIONS-PLUGIN-ARCHITECTURE.md) (design v1) and [`LIGHTHOUSE-FLOW.md`](./LIGHTHOUSE-FLOW.md).
> Turns the mock `/plugins` toggles + the mock `/flows` saga into real backend. Sandbox/FakeProvider only until a human takes a provider live.

## Scope (the three asks)
1. **Real plugin registry + routing** in `services/api`.
2. **Lighthouse saga** composing real primitives, resolving providers via the registry.
3. **Go-live machinery** (mode = sandbox|live) — built + **gated**; never executed here (redline: real money/SMS/invite).

## 1. Registry — schema (local migration only)
New tables in `@app/db` (drizzle), migration generated + applied **LOCAL docker only** (shared/prod runs via CI/deploy, human-gated):
- `plugin_instances` — `id, tenant_id (nullable = platform), capability (sms|payment|identity|whatsapp), vendor, label, enabled, mode (sandbox|live), status (connected|available|error), priority (int; 0 = primary, ascending = fallback chain), credentials_ref (Vault key, never raw), created/updated`. Unique-ish: one `priority=0` per `(tenant, capability)` = the default; the ordered list = the fallback chain.
- (Later) `plugin_health` for circuit-breaking; MVP derives status from last call.

## 2. Registry — framework (the shared mechanism, per §0 of the arch doc)
- `PluginRegistryService`: `listInstances(tenant, capability?)`, `enable/disable(id)`, `setPrimary(id)` (re-orders priority), `configure(id, creds)` (writes Vault ref).
- `resolve(capability, tenant, context)` → ordered list of enabled instances (primary first) — the **selection/failover** machinery, identical across capabilities (the legit shared core). Callers try primary → next on failure.
- **Adapters** map canonical ↔ vendor (anti-corruption): `SmsAdapter` (FakeProvider [real, exists], Africa's Talking [sandbox]), `PaymentAdapter` (Paystack sandbox). Core never sees vendor shapes.
- Endpoints (BffToken-guarded): `GET /internal/plugins`, `POST /internal/plugins/:id/{enable,disable,primary,configure}`. Wire the `/plugins` UI to these (env-gated; mock fallback stays).

## 3. Lighthouse saga (real, in the api)
`POST /v1/flows/verify-charge-notify` (idempotent on `correlationId`):
1. **Verify** → resolve `sms`/`whatsapp` instance → send OTP (FakeProvider sandbox) → confirm.
2. **Charge** → resolve `payment` instance → collect (Paystack **sandbox** `sk_test_`) → post the **balanced double-entry** to the E3 ledger.
3. **Notify** → resolve `sms`/`whatsapp` → send confirmation.
- One `flow_runs` record + immutable audit; forward-only after charge; retryable notify.
- MVP: real ledger + FakeProvider send + OTP (no external money/SMS). Paystack-sandbox charge is the first *external-but-safe* add.

## Go-live gate (#3 — built, not executed)
- Every instance has `mode`. `live` requires: (a) real creds in Vault, (b) an explicit human `activate-live` action, (c) staging-verified. **No code path auto-flips to live; I never run a live charge/send/invite.**
- Live SMS / real payments / invite emails remain redlines — sandbox-first, monitored, human-approved.

## Slices (verifiable, incremental)
1. **Schema + `PluginRegistryService` + read/enable endpoints + contracts** → wire `/plugins` UI. (local migration; compile + unit-testable)
2. **`resolve()` + SmsAdapter(FakeProvider) + the saga endpoint** → wire `/flows` UI (real ledger + FakeProvider). No external providers yet.
3. **Paystack sandbox PaymentAdapter** + AT sandbox SmsAdapter (external, test-mode).
4. **Go-live machinery + gate** (mode flip, Vault live creds) — human-run, staging.

## Redlines (restated)
Schema migrations: **local docker only** (authored here; shared/prod via CI + human). External writes (Paystack, AT, invite emails), live mode, production deploy: **human-gated, never auto-run.**
