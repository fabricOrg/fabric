# Platform Architecture — Developer Infrastructure & API Platform

**Status:** Design v1 · **Date:** 2026-05-31
**Scope:** Whole-platform architecture, with the **SMS / CPaaS product as the first vertical**.

This document is the technical translation of the strategic vision: a dual-mode
(API-first + dashboard) communications platform, built so that future verticals
(Payments, Email, Notifications, Auth/Identity) reuse a shared core — *without*
paying the premature-abstraction tax of building that core before a second product
demands it.

---

## 0. Guiding principles

1. **Modular monolith first, extract later.** One deployable, hard module boundaries
   inside. Microservices are an *outcome* of scaling pressure, not a starting posture.
   Two systems are the **exceptions, centralized from day one** because they are inherently
   cross-product and cannot be cleanly retrofitted: **identity/SSO** (`IDENTITY-SSO.md`) and the
   **control plane / admin** (`CONTROL-PLANE-ADMIN.md`).
2. **The wallet/ledger is the product.** Money correctness under concurrency is the
   hardest and most valuable part. Everything else is comparatively easy.
3. **One engine, two interfaces.** Dashboard and API are thin clients over the *same*
   service layer. Neither talks to providers directly.
4. **Multi-tenant from line one.** Never a per-tenant assumption baked into code.
   Every business row carries a `tenant_id`.
5. **Idempotent and observable by default.** Every write that costs money or sends a
   message is idempotent; every request is traceable end-to-end.
6. **Earn the shared core.** Build clean seams now; extract `auth`/`wallet`/`billing`
   into shared packages/services only when product #2 forces the shape.
7. **Three planes, not one.** Separate the **control plane** (staff configure/monitor/govern
   all products — god-mode), the **self-service plane** (customers configure their own tenant
   within limits), and the **data plane** (serves traffic). The control plane is **never in the
   data plane's hot path** — the data plane reads cached last-known-good config and keeps
   serving if the control plane is down. See `CONTROL-PLANE-ADMIN.md`.

---

## 1. Stack recommendation (stack was undecided)

### Recommendation: **Node.js + TypeScript** (NestJS) with **PostgreSQL**

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | **TypeScript on Node 22 LTS** | Matches your team's stated background → fastest velocity and best SDK story (your first SDK is JS/TS anyway). |
| Framework | **NestJS** | Opinionated modular structure (modules/providers/DI) *enforces* the boundaries this design needs. Maps 1:1 to the module plan in §4. |
| HTTP layer | **Fastify adapter** under Nest | Higher throughput than Express for an API product. |
| DB | **PostgreSQL 16** | Transactional integrity for the ledger, `SELECT ... FOR UPDATE`, partial indexes, `JSONB` for provider payloads, partitioning for the messages table. |
| ORM/query | **Drizzle** (or Prisma) | Drizzle: SQL-first, no hidden magic on the money path — preferable for ledger work. Prisma if team prefers DX over control. |
| Queue/jobs | **BullMQ on Redis** | Retry logic, scheduled sends, DLR reconciliation, rate limiting. |
| Cache / rate limit | **Redis** | API-key rate limits, idempotency-key store, hot config. |
| Frontend (both UIs) | **Next.js + TypeScript** | Shared types with backend; one dashboard app, one docs/dev-portal app. |

### Trade-off vs. the alternative (Java / Spring Boot)

- **Choose Spring Boot if:** you expect to sell to enterprises/banks early, want
  battle-tested financial-grade transaction tooling, and have Java-strong staff.
  Cost: slower iteration, heavier ops, and your SDK story diverges from your runtime.
- **Choose Node/TS (recommended) if:** speed-to-market and a unified TS codebase
  (backend + SDK + both frontends + shared types) matter more than enterprise
  signaling. For a first-vertical CPaaS targeting developers and SMEs, this wins.

> **PostgreSQL is the recommendation regardless of language.** The ledger needs ACID.
> Do not start on a document DB for the money path.

---

## 2. Tenancy model — the decision you can't cheaply reverse

### Decision: **Shared database, shared schema, `tenant_id` on every business row** (row-level isolation)

```
accounts (tenants) ──< api_keys
                   ──< users
                   ──< wallets ──< ledger_entries
                   ──< messages
                   ──< contacts, campaigns, templates
```

**Why row-level (not schema-per-tenant / DB-per-tenant):**

- Usage-billed CPaaS has many small tenants → schema/DB-per-tenant is operationally
  ruinous (thousands of migrations, connection sprawl).
- Cross-tenant billing rollups, fraud detection, and analytics are trivial in one schema.
- Isolation enforced in the **application layer + Postgres Row-Level Security (RLS)**
  as defense-in-depth: every query is scoped by `tenant_id`, and RLS policies reject
  anything that isn't.

**Escape hatch for later:** if a future enterprise client demands physical isolation,
the same codebase can run a **dedicated single-tenant deployment** pointed at its own DB.
You design for shared, allow dedicated as a deployment variant — not a code fork.

**Non-negotiable guardrails:**
- A `tenant_id` is resolved once per request (from API key or session) into request context.
- Repository layer *requires* tenant scope — no raw query bypasses it.
- Postgres RLS as the backstop, so an app-layer bug can't leak across tenants.

---

## 3. System context

```
        ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
        │ Developers   │     │ Business     │     │ Partners /   │
        │ (API + SDK)  │     │ users (Dash) │     │ Webhooks     │
        └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
               │ API key            │ session            │ signed
               ▼                    ▼                    ▼
        ┌───────────────────────────────────────────────────────┐
        │                  API Gateway / Edge                    │
        │   authN · rate limit · idempotency · request context   │
        └───────────────────────────┬───────────────────────────┘
                                     ▼
        ┌───────────────────────────────────────────────────────┐
        │              Application core (modular monolith)        │
        │  identity · tenancy · wallet/ledger · billing · sms     │
        └───────────────────────────┬───────────────────────────┘
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
            ┌───────────┐     ┌────────────┐    ┌──────────────┐
            │ Postgres  │     │   Redis    │    │ Provider     │
            │ (truth)   │     │ queue/cache│    │ adapters     │
            └───────────┘     └────────────┘    └──────┬───────┘
                                                        ▼
                                    Hubtel · Mnotify · Twilio · Termii ...
```

---

## 4. Module boundaries (modular monolith)

Each module owns its tables, exposes a service interface, and **never** reaches into
another module's tables directly. This is what makes later extraction mechanical.

> **As-built (2026-07-09).** The tree below is the *conceptual* boundary map. On disk the API is a
> flat NestJS layout — `services/api/src/{identity,api-keys,wallet,sms,payments,kill-switches,
> audit,proposals,impersonation,members,plugins,flows,maintenance,queue,rate-limit,idempotency,
> webhooks,http,db}` — with the shared domain split into packages (`@app/db`, `@app/wallet`,
> `@app/domain`, `@app/sms-engine`, `@app/integrations`, `@app/contracts`). The dependency rule
> below still holds; the folder names differ. The BullMQ queue + in-process worker (`queue/`,
> `sms/sms-send.worker.ts`), the scheduled sweeper + ledger-invariant + outbox-delivery jobs
> (`maintenance/`, `webhooks/`), rate limiting (`rate-limit/`), and client idempotency
> (`idempotency/`) all landed in the 2026-07 remediation.

```
src/
├─ platform/                  # SHARED CORE (extract-later candidates)
│  ├─ identity/               # accounts(tenants), users (by IdP sub), memberships, RBAC
│  ├─ api-keys/               # key issuance, hashing, scopes, rate-limit policy
│  ├─ wallet/                 # balances + double-entry ledger  ← crown jewel
│  ├─ billing/                # pricing, rating, usage records, invoices
│  ├─ idempotency/            # idempotency-key store + replay
│  ├─ webhooks/               # signed outbound event delivery + retries
│  ├─ events-bus/             # internal domain events (transactional outbox)
│  ├─ integrations/           # vendor-plugin framework (registry · routing · failover · health)
│  ├─ privacy/                # PII tokenization: data_subjects · pii_vault · DEK · DSR/erasure
│  └─ control-plane/          # ADMIN — day-one exception (see CONTROL-PLANE-ADMIN.md)
│     ├─ staff-iam/           # staff identity + admin RBAC + step-up (separate from customers)
│     ├─ config/              # config authoring, versioning, validation, propagation
│     ├─ audit/               # append-only, immutable platform-wide audit
│     ├─ entitlements/        # feature flags + plan/tenant entitlements
│     ├─ product-registry/    # ProductManifest registration (future products plug in here)
│     ├─ observability/       # aggregates metrics/events/health into operator views
│     └─ ops/                 # kill-switches · impersonation · money-ops (maker-checker)
│
├─ products/
│  └─ sms/                    # FIRST VERTICAL
│     ├─ engine/              # send orchestration, segmentation, encoding
│     ├─ providers/           # SMS plugin adapters + sender-IDs (under platform/integrations)
│     ├─ dlr/                 # delivery-report ingestion + reconciliation
│     ├─ campaigns/           # bulk, scheduling, contact lists, templates
│     └─ otp/                 # OTP generation + verification (phase 3)
│
└─ interfaces/
   ├─ public-api/             # REST for developers (versioned)            — data/self-service
   ├─ dashboard-api/          # BFF for the Next.js customer dashboard      — self-service plane
   ├─ admin-api + admin-console/  # ISOLATED deployable, separate auth+ingress — CONTROL PLANE
   └─ webhooks-ingress/       # provider DLR + payment callbacks in
```

**Dependency rule:** `products/*` may depend on `platform/*`. `platform/*` must **not**
depend on `products/*`. `control-plane/*` may *govern* (read/configure) platform + product
state, but products must **not** call the control plane at request time — they read **cached
config** (control plane is never in the hot path). Interfaces hold no business logic.

> **Note:** `products/sms/routing` and `providers` are now subsumed by the shared
> `platform/integrations` plugin framework (`INTEGRATIONS-PLUGIN-ARCHITECTURE.md`); SMS-specific
> bits (sender-IDs, DLR parsing) remain in the SMS domain as the SMS plugin contract.

---

## 5. The wallet & double-entry ledger (crown jewel)

### Principle
Never store a mutable `balance` you `UPDATE`. Store an **append-only ledger**; balance
is a derived (and cached) projection. Every movement is two entries that sum to zero.

### Core tables (sketch)

> **As-built (2026-07-09).** Shipped as a chart of accounts, not a `wallets` row: `ledger_accounts`
> `(id, tenant_id, currency, kind ∈ {customer, reserved_clearing, revenue, gateway_clearing}, `
> `balance_minor)` + append-only `ledger_entries` + `ledger_transactions`. `balance_minor` is
> maintained WRITE-TIME by the `ledger_apply_entry` trigger (so the cached projection can't drift
> from the legs), a per-txn balanced-legs constraint trigger enforces double-entry, and the
> reserve→commit/refund lifecycle uses `SELECT … FOR UPDATE` on the customer account. The `version`
> optimistic column below was **dropped** (review B4 — `FOR UPDATE` alone is correct and simpler).
> The invariant check (`SUM(credits) − SUM(debits) == balance_minor`, per-txn trial balance) runs
> as a scheduled job (`maintenance/`), not only in CI.

```sql
-- One wallet per (tenant, currency) — MULTI-CURRENCY from day one (resolved).
-- See INTEGRATIONS-PLUGIN-ARCHITECTURE.md §7. UNIQUE(tenant_id, currency).
wallets (
  id            uuid pk,
  tenant_id     uuid not null,
  currency      char(3) not null,             -- no single default; tenant may hold GHS/NGN/USD
  -- cached projection; source of truth is ledger_entries
  balance_minor bigint not null default 0,     -- store money in MINOR units (pesewas)
  version       bigint not null default 0,      -- optimistic concurrency
  created_at    timestamptz, updated_at timestamptz
);

-- Append-only. Never UPDATE or DELETE.
ledger_entries (
  id              uuid pk,
  tenant_id       uuid not null,
  wallet_id       uuid not null,
  txn_id          uuid not null,        -- groups the 2+ legs of one transaction
  direction       text not null,        -- 'credit' | 'debit'
  amount_minor    bigint not null check (amount_minor > 0),
  reason          text not null,        -- 'topup' | 'sms_reserve' | 'sms_commit'
                                         -- | 'sms_refund' | 'adjustment'
  reference_type  text,                 -- 'message' | 'payment' | ...
  reference_id    uuid,
  idempotency_key text,                 -- unique per tenant
  created_at      timestamptz not null default now()
);

-- money math is exact: bigint minor units everywhere. NEVER float.
```

### Reserve → commit/refund (the spend lifecycle)

Sending an SMS is **not** "subtract balance, then send". It is:

```
1. RESERVE   debit wallet by estimated cost   (atomic, FOR UPDATE / version check)
2. SEND      hand message to provider
3a. COMMIT   provider accepted → reservation becomes a real charge
3b. REFUND   provider rejected → credit the reservation back
4. RECONCILE final DLR adjusts cost if actual segments ≠ estimate
```

Atomicity pattern (pseudo):

```sql
BEGIN;
  SELECT balance_minor, version FROM wallets
    WHERE id = $wallet FOR UPDATE;          -- serialize concurrent spends
  -- assert balance_minor >= cost
  INSERT INTO ledger_entries (... direction='debit', reason='sms_reserve',
                              idempotency_key=$key);   -- unique index dedupes retries
  UPDATE wallets SET balance_minor = balance_minor - $cost,
                     version = version + 1
    WHERE id = $wallet;
COMMIT;
```

- **Idempotency key** has a `UNIQUE(tenant_id, idempotency_key)` constraint → a retried
  request that already debited cannot debit twice; you replay the stored result.
- **`FOR UPDATE`** (or the `version` optimistic check) prevents two concurrent sends
  from spending the same balance.
- **Reconciliation job** compares charged vs. actual segment count from the final DLR
  and posts an `adjustment` entry — you never silently lose or over-charge money.

> Invariant test (must exist in CI): for every wallet,
> `SUM(credits) - SUM(debits) == balance_minor`. Run it continuously.

---

## 6. SMS engine & provider layer

### Send pipeline

```
POST /v1/sms/messages
   │  authN (api key) · rate limit · idempotency
   ▼
Engine.normalize   → E.164 numbers, validate
   │
Engine.encode      → detect GSM-7 vs UCS-2, compute segment count
   │                 (this DETERMINES cost — a single emoji forces UCS-2 → 70 chars/segment)
   ▼
Billing.rate       → segments × per-segment price for destination → cost estimate
   │
Wallet.reserve     → atomic debit (see §5)
   ▼
Routing.select     → pick provider by destination/cost/health
   │
Queue(send)        → BullMQ; provider adapter call with retry/backoff
   ▼
Provider.accepted? ─yes→ Wallet.commit, status=sent, return message_id
   │
   └─no (after retries) → Routing.failover OR Wallet.refund + status=failed
```

### Delivery reports (async, separate path)

```
Provider → POST /webhooks/dlr/:provider  (verify signature)
   → map provider status → canonical status (queued|sent|delivered|undelivered|failed)
   → update message · reconcile cost · emit 'message.delivered' domain event
   → fan out to tenant's registered webhooks (signed, retried)
```

### Provider abstraction

The SMS provider interface is the **`SmsSenderPlugin` contract** defined canonically in
`INTEGRATIONS-PLUGIN-ARCHITECTURE.md §3` (don't redefine it here). It belongs to the shared
`platform/integrations` framework, not an SMS-specific module.

**Phasing (reconciled — see `ARCHITECTURE-REVIEW.md`):** build the **plugin *contract*** from
day one (it's the anti-lock-in seam, and it's cheap), and ship Phase 1 with **one** provider
instance. The **generic selection / failover / least-cost / circuit-breaker *engine*** is
deferred to **Phase 2/3**, when a second provider exists to justify it. Contract now, engine
later — consistent with Principle #1.

### CPaaS gotchas baked into the design
- **Encoding/segmentation** drives price — compute it server-side, never trust client.
- **Sender ID registration** (Ghana/Nigeria regimes) — model `sender_ids` with an
  approval state per tenant; reject sends with unapproved sender IDs.
- **Charge on `accepted`, adjust on final DLR** — don't wait for delivery to charge,
  don't forget to reconcile.

---

## 7. Public API design (developer product)

- **Versioned from v1:** `/v1/...`. Version in the path. Never break v1.
- **Auth:** `Authorization: Bearer sk_live_…` / `sk_test_…`. Keys are **hashed at rest**
  (only a prefix shown in the dashboard). Scopes per key (`sms:send`, `wallet:read`).
- **Idempotency:** `Idempotency-Key` header honored on all POSTs that move money/send.
- **Test mode:** `sk_test_` keys hit a sandbox that never charges or sends.

```
POST /v1/sms/messages           # single or bulk
GET  /v1/sms/:id            # status + DLR
GET  /v1/messages           # list/filter
GET  /v1/wallet             # balance + recent ledger
POST /v1/wallet/topups      # initiate top-up (→ payment provider)
POST /v1/webhooks           # register/manage webhook endpoints
GET  /v1/sender-ids         # registered sender IDs + approval state
```

Standard envelope, cursor pagination, `request_id` on every response, RFC-style errors
(`type`, `code`, `message`, `param`).

---

## 8. Dashboard product (business users) — *self-service plane*

Thin Next.js app over `dashboard-api` (a BFF). Reuses the **same** engine/wallet/billing.
This is the **customer self-service plane** — tenant-scoped, distinct from the internal
**control plane / admin console** (`CONTROL-PLANE-ADMIN.md`). Customers configure only their own
tenant, within the entitlement bounds the control plane sets.
- Auth: WorkOS SSO session via BFF + tenant RBAC (owner/admin/member).
- Features by phase: see §11.
- The dashboard's "Send campaign" ultimately calls the **same** `SmsEngine.send` the API
  uses — no second send path.

---

## 9. Security

- **API keys** hashed (Argon2/bcrypt or HMAC-with-pepper); prefix-indexed for lookup.
- **Tenant isolation:** app-layer scoping + Postgres **RLS** backstop.
- **Webhooks:** outbound signed (HMAC + timestamp, replay window); inbound DLRs
  signature-verified per provider.
- **Secrets:** provider credentials in a secrets manager, never in DB plaintext.
- **Rate limiting:** per API key + per tenant, Redis token bucket.
- **Audit log:** every money movement and every control-plane action is append-only,
  immutable, and platform-wide — a first-class **system**, not a side-table
  (see `CONTROL-PLANE-ADMIN.md §8`).
- **Staff access:** internal operators use a **separate identity** (staff IdP), MFA-all, admin
  RBAC, step-up auth, and maker-checker for money — never customer accounts (`IDENTITY-SSO.md`,
  `CONTROL-PLANE-ADMIN.md §7`).
- **PII:** phone numbers + message bodies are sensitive personal data. Raw PII lives **only** in an
  encrypted **`pii_vault`** (module `platform/privacy`); all other tables reference a stable
  **`subject_id`** surrogate. **Right-to-erasure = crypto-shred the per-subject DEK** (financial/
  audit records stay intact). Retention purge + per-tenant/per-message redaction on top. Full
  model, controller/processor split, DSR, residency, and DPA in `COMPLIANCE-AND-DATA-PROTECTION.md`.

---

## 10. Observability & ops

> **As-built (2026-07-09).** **Logs** are live: pino JSON, a `request_id` on every request
> (honors inbound `x-request-id`, else mints one, echoed in the response header), `tenant_id`
> bound once the api-key guard resolves it, secret headers redacted. The **ledger-invariant** +
> **reservation-sweeper** run as scheduled jobs (`maintenance/`, advisory-locked); a drift is an
> error-level log today (alarm wiring is the remaining piece — no pager yet). **OpenTelemetry
> tracing** and the metrics feed are still TODO.

- **Tracing:** OpenTelemetry; one `trace_id` from API edge → engine → provider → DLR.
- **Metrics:** send throughput, accept/deliver/fail rates per provider, queue depth,
  wallet reservation latency, reconciliation drift.
- **Logs:** structured JSON, `tenant_id` + `request_id` on every line.
- **Alerts:** provider error-rate spike, ledger invariant violation, queue backlog,
  failed DLR reconciliation.
- **The ledger invariant check (§5) runs as a scheduled job and pages on drift.**
- **Operator surface:** the **control plane** consumes these signals (metrics + outbox events +
  health checks) into a unified admin console — it *consumes*, never blocks the data plane
  (`CONTROL-PLANE-ADMIN.md §10`).

---

## 11. Phased build plan

### Phase 1 — Engine + API (validate the core) ★ MVP
- Accounts/tenants, users, RBAC
- API key issuance + auth + rate limit + idempotency
- **Wallet + double-entry ledger** (reserve/commit/refund)
- Billing: rating (segments × price), usage records
- SMS engine: normalize, encode/segment, send via **one** provider (behind the plugin contract;
  the generic failover/selection engine is deferred to Phase 2/3 — see `ARCHITECTURE-REVIEW.md`)
- **OTP / Verify (SMS channel)** — generate + verify, attempt limits, auto-redacted bodies
- **Opt-out / STOP suppression** — block sends to opted-out recipients (compliance, not optional)
- DLR ingestion + reconciliation + **reservation-TTL sweeper** (resolve "stuck" reservations)
- `POST /v1/sms/messages`, `GET /v1/sms/:id`, `GET /v1/wallet`, OTP send/verify endpoints
- Minimal dev portal: key management, usage logs, docs
- **Exit criteria:** a developer can sign up, get a key, fund a (test) wallet, send,
  run an OTP verify, and see accurate billing + DLR — with the ledger invariant green under load.

### Phase 2 — Business dashboard
- Next.js dashboard: contacts (CSV upload), campaigns, templates, reports
- Wallet top-up flow wired to a payment provider (Paystack/Flutterwave/Hubtel)
- Campaign analytics (delivery rate, cost, failures, history)

### Phase 3 — Advanced platform
- Multi-provider routing + failover + least-cost routing (the generic integrations engine)
- Multi-channel OTP fallback (SMS→voice→WhatsApp), scheduling, white-label/reseller sub-accounts
- SDKs (start with **TypeScript**), automation workflows

### Phase 4 — Earn the shared core
- When product #2 (Payments or Email) is greenlit, **extract** `identity`, `api-keys`,
  `wallet`, `billing`, `webhooks` from `platform/` into shared packages (or services if
  scale demands). The seams from §4 make this mechanical, not a rewrite.

---

## 12. Key decisions log (ADR seeds)

| # | Decision | Rationale | Reversible? |
|---|---|---|---|
| 1 | Modular monolith, not microservices | Small team, one product today | Yes (extract later) |
| 2 | Shared-DB row-level tenancy + RLS | Many small tenants, easy billing/analytics | Hard — decide now |
| 3 | Double-entry append-only ledger, minor-unit bigint | Money correctness, auditability | Hard — decide now |
| 4 | **CONFIRMED (2026-06-02): Node/TS + NestJS (Fastify) + PostgreSQL 16 + Drizzle + Redis/BullMQ** | Team fit, unified TS stack, ACID, SQL-first money path | Medium |
| 5 | Charge on `accepted`, reconcile on final DLR | Industry-correct revenue capture | Medium |
| 6 | Build shared core in-place, extract on product #2 | Avoid premature abstraction | By design |
| 7 | Identity/SSO centralized day one — WorkOS AuthKit | Cross-product SSO can't be retrofitted | Hard |
| 8 | Vendor-agnostic plugin framework (share mechanism, not contract) | No lock-in across SMS/payments/future | By design |
| 9 | Per-capability failover: SMS `TRANSPARENT_RETRY`, payment `INITIATION_ONLY` | Prevents double-charge | Hard |
| 10 | Multi-currency from day one; single-currency per ledger txn; FX deferred | Team requirement; additive for FX | Hard |
| 11 | Store message bodies by default, encrypted, opt-in redaction, time-bound retention | Matches Twilio/Plivo/Bird; preserves support | Medium |
| 12 | **Control plane / admin centralized day one; never in data-plane hot path** | Cross-product governance can't be retrofitted; availability isolation | Hard |
| 13 | Separate staff identity + immutable platform-wide audit + maker-checker for money | Blast-radius isolation, compliance | Hard |
| 14 | Processor (recipients) / controller (tenant-users); DPA auto-incorporated | GDPR/NDPA/Ghana-DPA dual role | Hard |
| 15 | **PII tokenization: `subject_id` surrogate + encrypted `pii_vault`; erasure = crypto-shred DEK** | Right-to-erasure vs immutable ledger/audit; matches Bird | Hard — decide pre-migration |
| 16 | Data residency is launch-gating (CBN/NDPA flows via fintech customers); `data_region` on tenants + instances | Sector localization | Hard |
| 17 | Design to be ISO 27001 / SOC 2 *certifiable*; certify on enterprise demand | Sales table-stakes; African rivals lack it | Medium |

---

## Open questions

**Resolved** (see `INTEGRATIONS-PLUGIN-ARCHITECTURE.md` + `CONTROL-PLANE-ADMIN.md`):
- ~~Persist message bodies?~~ → store by default, encrypted, opt-in redaction, time-bound retention.
- ~~Single vs multi-currency?~~ → multi-currency **machinery**; **enabled-currency set is
  control-plane config** (operator enables one at launch; adding more = config change, no migration).
- ~~Provider lock-in?~~ → **plugin framework**; vendors are pluggable instances, not code choices.
- ~~Confirm stack?~~ → **CONFIRMED: Node/TS + NestJS (Fastify) + PostgreSQL 16 + Drizzle + Redis/BullMQ.**
- ~~Cost-per-delivered billing?~~ → bill on the provider's `billingBasis`; never charge for failures;
  delivered-billing is an opt-in premium tier (decision #B3).

**Still open (gate Phase 1 code):**
1. **Launch market → first plugin *instances* to build** (Ghana Hubtel/mNotify? Nigeria Termii?
   + matching payment adapter). No longer a code decision — just which adapter to write first.
2. **Control-plane decisions** — `CONTROL-PLANE-ADMIN.md §16` (staff IdP shape, maker-checker
   scope, impersonation-at-launch).
