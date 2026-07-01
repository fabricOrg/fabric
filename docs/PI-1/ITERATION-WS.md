# Iteration WS — Walking Skeleton: "money moves through a send"

**Goal:** a real API request, authenticated by an API key, **tops up a wallet → sends an SMS →
reserves → commits on `accepted` → reconciles a DLR → balance is provably correct**, end-to-end, on
`FakeProvider`, with tenant isolation enforced at runtime. This is the thin-thread spine (the 9-step
PI System Demo). Everything else in PI-1 hardens or broadens it.

**Builds on (merged + verified foundation):** `ledger-double-entry` (ledger_accounts/transactions/
entries, B6/B8/F4), RLS + `app_runtime` (0001/0002), identity (accounts/users/memberships), PII vault,
`@app/contracts` (F8.3 error envelope), `@app/db` migration journal + the live invariant + security
integration gates.

**Redlines unchanged:** no prod deploy, no real SMS/payment/spend, migrations to LOCAL docker only.
FakeProvider + `sk_test_` only. Human gate before anything external.

---

## Lanes (dependency-ordered)

### L1 — Runtime tenant-context seam ⭐ LINCHPIN — owner: **newton**
`services/api` scaffold (NestJS + Fastify adapter, config module, health route) **+ the
`withTenant(tenantId, fn)` transaction wrapper**: opens a tx on the **`app_runtime`** connection,
validates `tenantId` is a real uuid, `SET LOCAL app.tenant_id = $1` (never plain `SET`), runs the
work inside. This is the RUNTIME half of RLS — the DB half is verified; nothing has exercised the
per-request `SET LOCAL` yet. **Blocks L2/L3/L5.**
- **AC (adams B3, 3-case fail-closed):** (1) GUC unset → query returns **0 rows**, not an error;
  (2) empty/invalid `app.tenant_id` → wrapper **rejects before `SET LOCAL`** (validate uuid);
  (3) valid uuid, **second tenant interleaved on the same pooled connection** → sees **0 rows** of
  tenant A. Asserts `SET LOCAL` (transaction-scoped, pooling-safe).

### L2 — API-key auth (F2.3) — owner: **pascal** · dep: L1
`sk_test_`/`sk_live_` issuance (random, **hashed at rest** — store hash, never the key), an auth guard
that resolves the presented key → tenant → sets the request tenant context via L1. Key mgmt endpoints
(create/list/revoke). API-only (no portal — that's PI-2).
- **AC:** unknown/revoked key → 401 (F8.3 envelope); valid key → request runs tenant-scoped; the raw
  key is shown once at creation and never retrievable after.

### L3 — Wallet service (F3.1/F3.2/F8.2) — owner: **newton** · dep: L1
The domain service over newton's ledger primitives: `reserve`/`commit`/`refund`/`credit`, an
**idempotency store** (F8.2, keyed fingerprint), **optimistic concurrency** (`version`), and the
**balance gate** (reject rather than overdraw; negative only via `adjustment`).
- **AC:** the merged invariant gate now runs **through the service** (not raw SQL); B8 idempotency
  (byte-identical retry = no double-post; same key + different body = conflict); concurrent-spend
  can't double-spend one balance.

### L4 — `SmsSenderPlugin` contract + `FakeProvider` (F5.1) — owner: **pascal** (contract) + **adams** (fake) · dep: none — start now
The vendor-agnostic plugin interface (`send`/`parseDlr`/`verifyWebhook`/`supports`/`healthCheck`/
`billingBasis` + `billableStatuses[]` + `platformFaultExemptions[]`) and a **deterministic
`FakeProvider`**: accept · DLR-delivered · DLR-failed · no-DLR (sweeper path) · reject-at-submit ·
crash-after-accept-before-ref-persist (B2). Pure — no L1 dependency, so it runs in parallel.
- **AC:** each scenario is deterministically triggerable; `billingBasis`/`billableStatuses` drive
  the commit-point; contract has ONE real adapter stub + the fake.

### L5 — Send pipeline (F5.2/F5.3/F5.4) — owner: **newton** · dep: L1,L3,L4
normalize E.164 → **segment** (GSM-7 **153** / UCS-2 **67** concatenated) → rate → **reserve** (L3) →
send (L4 FakeProvider) → **commit on `enter(billableStatuses[0])`, default `accepted`** → DLR
ingest/reconcile (out-of-order tolerant) → **refund** on platform-fault (F3.5) or TTL sweeper (F3.3).
Status enum `queued→sending→accepted→sent→delivered|undelivered|failed`; unmapped raw status → error.
- **AC (adams):** commit-point transition test (commit fires once on `accepted`, idempotent);
  billable-basis parity (bill on provider basis, never on platform fault → auto-refund); B6
  commit-XOR-refund + no-double-commit through the pipeline.

---

## Sequence & parallelism (honest — the backend bench is thin)
```
newton:  L1 (linchpin) ─────────────▶ L3 (wallet svc) ─────────▶ L5 (send pipeline)
pascal:            └─▶ L2 (api-key auth)      L4 contract ┐
adams:   B3 gate ↑        gates each lane      FakeProvider ┘ (with pascal)  ▶ pipeline gates
```
- **Critical path = newton (L1→L3→L5).** L4 (pascal+adams) starts immediately in parallel (no deps).
  L2 (pascal) starts once L1's context seam lands.
- **edison + vivian:** PI-1 is API-only → their surfaces (admin-console, dev-portal, dashboard) are
  **PI-2**. On standby unless a lane needs the consumer/API-docs lens. `@app/ui` seam is already done.

## Process (unchanged — it worked)
Per-lane git worktree off `dev`; linear history; branch `<type>/<ticket>-<slug>` (e.g.
`feature/f2-3-api-key-auth` — prefix is `feature`, NOT `feat`, per the branch-name hook); commit small;
rebase onto `dev`; post "ready to merge @ sha" → PM reviews
the diff (money/tenant/security paths scrutinized) → ff-merge. QA gates green **with reproducible
evidence** before a lane closes — verify-don't-trust.

**Definition of done for the iteration:** the 9-step demo script runs green end-to-end on FakeProvider
against a freshly-migrated DB, with the invariant + tenant-isolation + commit-point gates passing.
