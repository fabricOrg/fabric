# PI-1 Test Strategy & CI Gates

**Status:** RATIFIED design (owner sign-off 2026-07-01) → build. Author: qa-engineers/adams (QA).
Code reviewer / verification partner: product-managers/fifi. Bound to contract **`ledger-double-entry`
v1.0.0** and `team/backend-engineer/PROPOSAL-ledger-double-entry.md`.

**Scope locked:** PI-1 = **API-only skeleton** (API keys via API/CLI; dev-portal → PI-2), frontend
**seam-now/full-defer**, **FakeProvider-first**. Redline: migrations apply to **LOCAL docker only**,
never a shared/prod DB.

---

## 1. Test tiers (map to `pnpm verify` = guard → lint → typecheck → **test** → build)

| Tier | Runner | Needs Postgres? | Turbo task | When |
|---|---|---|---|---|
| **Unit** — pure `@app/domain` fns | Vitest | no | `test` | every push (fast) |
| **Integration** — RLS, ledger, concurrency | Vitest + real `pg` (docker-compose) | **yes** | `test:integration` (new) | CI + pre-push |
| **E2E** — 9-step walking-skeleton script | script + FakeProvider + sandbox `sk_test_*` | yes | `test:e2e` (new) | CI (main + release) |

**B3 approach:** Vitest + a **real pooled `pg` client**, not pgTAP — pgTAP can't model app-side
transaction pooling (PgBouncer/RDS Proxy), which is the actual leak surface. Optional thin pgTAP
check for policy presence only.

## 2. FakeProvider — first-class test fixture (enabler for B2/B6/DLR/sweeper/load)

Deterministic, on-demand simulation of: **accept** · **DLR delivered** · **DLR failed** · **no DLR**
(sweeper/TTL path) · **reject at submit** (immediate refund) · **crash-after-accept-before-ref-persist**
(B2 double-send injection). Pulled into **Iter-2** so the crown-jewel concurrent-load gate is reachable
before real vendors (pascal #5).

## 3. Gates — full matrix

### B3 — RLS interleaved-pool leak (★ highest blast radius) — 3-case fail-closed matrix
1. **GUC unset** → query returns **0 rows** (not an error).
2. **empty/invalid `app.tenant_id`** → tx wrapper **rejects before `SET LOCAL`** (validate a real uuid).
   `''::uuid` raising a 500 is a footgun, not a safe fail (newton F6).
3. **valid uuid** → correctly scoped; a **second tenant interleaved on the same pooled connection**
   sees **zero** rows of tenant A. `SET LOCAL` (never plain `SET`) asserted.

### B4 — owner-bypass
- `app_runtime` has **no `BYPASSRLS`** (`rolbypassrls = false`).
- `FORCE ROW LEVEL SECURITY` on every tenant table (`pg_class.relforcerowsecurity`).

### "Security-layer-applied" assertion (closes the RLS-not-wired gap)
CI fails if migrations don't produce `app_runtime` (no BYPASSRLS) + FORCE RLS + `tenant_isolation`
policy on **all** tenant tables (identity, privacy, ledger_accounts, ledger_transactions, ledger_entries).
Query `pg_policies` + `pg_class`.

### Migration-drift guard
CI fails if a hand-written `packages/db/sql/*.sql` is not reflected in the drizzle journal
(`migrations/meta/_journal.json`). Prevents the inert-RLS state recurring (newton is wiring 0001+0002).

### B5 — idempotency fingerprint (pure, `@app/domain`)
- byte-identical retry (same key + same raw body) → **must NOT conflict**.
- same key + **different** raw body → **must conflict**.
- fingerprint on **raw inbound bytes before tokenization**; excluded headers/fields fixed.

### B6 — DLR-vs-sweeper double-resolution (★ money correctness)
1. **Unit:** DLR-handler and sweeper derive **byte-identical** deterministic keys (`commit:{msgId}` /
   `refund:{msgId}`) — catches drift the instant one path is edited.
2. **Integration — two guards, two failure modes:**
   - *Deterministic key + `UNIQUE(tenant_id, idempotency_key)`* (Iter-2, no message row needed): two
     resolvers of the **same** outcome collide → no **double-commit / double-refund**. Testable now.
   - *Message-row terminal state machine* (`reserved → committed | refunded`, `SELECT … FOR UPDATE` +
     compare-and-set in both DLR handler and sweeper): prevents **commit AND refund** on one message.
     Lands with the SMS engine; the deterministic key alone does **not** cover this.
3. **Schema assertion (REQUIRED, not optional — pascal AC-fit):**
   `UNIQUE(tenant_id, reference_id) WHERE reason IN ('sms_commit','sms_refund')` on `ledger_entries`.
   This is the **only DB-level backstop** against commit+refund *both* landing per message. It must not
   fall through the **ledger↔engine lane seam**: either the engine's message-row terminal SM owns the
   guard *or* this index does — **one owner must be explicitly assigned** (see risk in session log).
   **Commit-XOR-refund test** (engine spec, Iter-3): concurrent DLR-commit + sweeper-refund on one
   msgId → at most one terminal resolution; `reserved_clearing` never goes negative; invariant intact.

### B8 — top-up double-credit
- Concurrent **callback + webhook** with the same `topup_id` → wallet credited **exactly once**.
- **webhook-only-credit:** the callback path posts **no** credit leg (asserted).
- **NOT-NULL fix (ratified):** a `topup` txn with a NULL `idempotency_key` is rejected — newton adds the
  `idempotency_key NOT NULL` CHECK; test asserts rejection.

### B9 — OTP attempt-limit race
- **N parallel guesses** all reading `attempts = cap-1` → only the allowed number succeed; the cap
  **holds** (atomic `FOR UPDATE` / Redis `INCR`). Constant-time compare.

### B7 — crypto-shred during in-flight send
- erasure while subject has a **non-terminal** send → assert the decided policy (defer OR fail+refund);
  `erasure_log` row present. DEK-cache invalidation **cluster-wide** (Redis pub/sub), bounded residual.

### F4 — retention regression (ratified)
- tenant **hard-delete is BLOCKED** (`ON DELETE RESTRICT` on ledger/erasure_log/audit FKs).
- ledger + `erasure_log` **survive** account soft-close (`status = 'closed'`).

## 4. Ledger invariant CI job — PINNED to the trial-balance model (ratified)

Bound to `ledger-double-entry` v1.0.0 (system accounts `customer` / `reserved_clearing` / `revenue` /
`gateway_clearing` / `writeoff`, per (tenant, currency); `ledger_entries.account_id → ledger_accounts.id`).
The standing invariant job + integration test assert:

- **Per-transaction trial balance:** for every `txn_id`, `Σ(credit legs) − Σ(debit legs) = 0`.
- **Per-account projection integrity:** every `ledger_accounts.balance_minor = Σ credit − Σ debit` of its
  legs (customer, clearing, revenue alike).
- **Under concurrent send load** (walking-skeleton exit #9) + `ledger_accounts.version` optimistic-lock
  race: both invariants hold after **every** reserve/commit/refund.
- **Negative-balance guard (ratified ALLOW):** a negative `customer` balance is reachable **only** via an
  `adjustment` reconcile leg — the send/reserve path always gates `balance_minor >= cost` (S5) and
  **rejects rather than overdraws**. Explicit test pins this separation.

Runnable artifact staged: `team/qa-engineer/proposals/ledger-invariant.check.ts` (+ `.spec.ts`) — the SQL
assertions both the Vitest integration test and the standing CI job import. Target location in
`packages/db/test/` to be finalized with newton against his migration.

## 5. Billing / canonical status (B1) — target fixed by pascal's reconciliation §5

**Canonical status enum (fixed target):**
`queued → sending → accepted → sent → delivered | undelivered | failed`
(`accepted` = provider ack'd submission — the new state that resolves B1).

**Commit-point rule under test** (binds to newton's COMMIT leg, `reserved_clearing → revenue`):
> COMMIT fires on transition **into the first canonical status in the provider's `billableStatuses`
> set** (default `{accepted}`), guarded by the B6 SM + deterministic `commit:{msgId}`. A status in the
> F3.5 platform-fault exemption list → **REFUND** (`refund:{msgId}`), never commit. Sweeper refunds on TTL.

Tests (pure `@app/domain`, no I/O — the first tests to write):
- **Status mapping:** each first-provider raw status → exactly one canonical status; unmapped raw
  status → explicit error (never a silent default). Table-driven, exhaustive over the provider's set.
- **Commit-point transition:** entering `billableStatuses[0]` (default `accepted`) → emits a COMMIT
  decision with key `commit:{msgId}`; a platform-fault-exempt status → REFUND decision `refund:{msgId}`;
  a non-billable non-exempt status → no money movement. Assert **idempotent** (re-entering a billable
  status does not emit a second commit decision).
- **Billable-basis parity:** the customer is billed on the same basis the provider bills us
  (pass-through); never billed for a platform-caused failure (auto-refund) — table-driven per provider.

> **Dependency:** the commit-point *assertion* inherits from newton confirming his COMMIT leg fires
> exactly on `enter(billableStatuses[0])`. Spec frozen; I pin the transition test the moment he confirms
> (his reply to pascal's §5 question).

## 6. Coverage policy
Money/PII/tenant paths **require** tests (CONVENTIONS DoD) — enforced per-path (critical-path checklist),
**not** a blanket %. A behaviour change without a test fails review.

## 7. Iteration → gate-green map
- **Iter-2 (ledger_accounts):** §3 B4/B5/B8-CHECK + single-connection concurrent-spend + §4 invariant
  (trial-balance form) go green.
- **Iter-2/3 boundary (FakeProvider + engine):** B6 concurrent, DLR-reconcile, sweeper, and the
  **flagship** invariant-under-send-load gate become reachable.
- **Iter-3+:** B3 pool-leak once runtime tx-wrapper exists; billing tests once status enum canonical.
- **Iter-5:** full 9-step E2E.
