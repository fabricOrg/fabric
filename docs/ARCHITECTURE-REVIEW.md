# Architecture — Second-Pass Review

**Date:** 2026-06-02 · A critical re-read of all design docs looking for what to **change**,
**improve**, **reassess**, or **remove**. Findings are prioritized; file:line refs included.

> **Honest framing:** the design is internally strong and the decisions are individually
> well-reasoned. But reviewing the *whole* against the founding principle exposes one systemic
> drift and a handful of concrete defects. Nothing here is fatal; most are "tighten before code."

---

## ★ The one systemic theme: scope creep vs. Principle #1

`ARCHITECTURE.md` Principle #1 is *"modular monolith first, earn the shared core, don't
pre-abstract."* Yet over the sessions we accumulated a lot of **"from day one"**:

- WorkOS SSO centralized (justified — can't retrofit) ✅
- Control plane centralized (justified) — *but the generic product-registry is not* ⚠️
- A generic **plugin framework** for SMS **and** payments, with selection/failover/circuit-breaker ⚠️
- **Multi-currency** wallets + per-currency pricing ⚠️
- Three planes, audit system, staff IAM, entitlements ✅/⚠️

Several of these abstract over a **second instance that does not exist yet** (a 2nd SMS provider,
a 2nd payment provider, a 2nd product, a 2nd currency/market). That is precisely the premature
abstraction Principle #1 warns against. **The MVP has quietly become "build the platform," not
"prove the riskiest thing."**

**Recommendation — define a true *walking skeleton* first.** One thin vertical slice that proves
the three genuinely risky things, with the *minimum* framework:
1. **Money is correct** — wallet reserve→commit/refund + ledger invariant, single currency.
2. **An SMS actually leaves and a DLR comes back** — through **one** provider (no failover engine).
3. **A top-up actually funds the wallet** — through **one** payment provider (no plugin framework).

Wrap each vendor behind its **plugin *contract*** (cheap, prevents lock-in) but **defer the
generic registry/selection/failover/health machinery** until the 2nd provider justifies it.
That keeps the no-lock-in promise while honoring Principle #1.

---

## A. Consistency defects — fix before code (the docs now contradict each other)

| # | Defect | Where | Fix |
|---|---|---|---|
| A1 | **OTP phasing contradicts itself.** Features doc puts OTP in **P1/MVP**; Architecture & Module docs put it in **Phase 3**. | `SMS-FEATURES…md:79,§7` vs `MODULE-DECOMPOSITION.md:§4.6, build-order 14` & `ARCHITECTURE.md:§11 P3` | Decide OTP's phase (see B1) and make all three docs agree. |
| A2 | **`routing` + `providers` modules are stale.** Module doc still describes them as SMS modules with `routing_rules`/`provider_health`, but the Integrations doc says it *replaces* them. | `MODULE-DECOMPOSITION.md:265–296` vs `INTEGRATIONS…md:334` | Mark §4.2/§4.3 superseded; point to `platform/integrations`; the §2 dependency graph still shows `route`/`provs` nodes — update. |
| A3 | **SMS provider interface defined twice, differently.** `SmsProvider` (Architecture §6) vs `SmsSenderPlugin` (Integrations §3). | `ARCHITECTURE.md:281–308` vs `INTEGRATIONS…md:§3` | Keep one (the plugin contract); have Architecture §6 reference it, not redefine. |
| A4 | **Failover phasing tension.** Architecture says "failover/LCR is **Phase 3**, start with one provider" (the lean view); Integrations presents the full failover engine as *the* design. | `ARCHITECTURE.md:308` vs `INTEGRATIONS…md` | Reconcile to: contract now, failover engine in P2/P3 (matches the walking-skeleton recommendation). |

---

## B. Reassess — judgment calls worth revisiting

### B1. OTP should probably be a *first-class* P1 capability, not a Phase-3 feature
OTP/Verify is the **highest-margin, highest-demand CPaaS use case** (it's Termii's entire
business) and the fastest path to fintech revenue. Burying it in Phase 3 is a strategic
mismatch with `SMS-FEATURES…md §5` (which already treats it as a wedge). **Recommend: OTP send +
verify (SMS channel) in P1**, multi-channel fallback later. Then fix A1.

### B2. Currency → *control-plane configuration* ✅ RESOLVED (2026-06-02)
Resolution chosen: build the full multi-currency machinery (wallets keyed by `(tenant, currency)`,
per-currency pricing), but make the **set of enabled currencies + default a control-plane config
value**, not a hardcoded constant. The operator enables **one** currency at launch; adding more is
a **config change — no migration, no deploy**. This fits the control-plane philosophy (currency is
config) and avoids a future refactor, at barely more cost than single-currency since the schema is
already keyed by currency. FX remains deferred (single-currency per ledger txn).

### B3. Billing model — *mirror the upstream basis*; transparency is mandatory, not optional
*(Revised 2026-06-02 after pushback: "reporting only, bill on accepted" undercuts the wedge —
correct. Below is the principled model.)*

The only loss window is narrow: messages the **provider accepted and bills *you* for** that the
final DLR marks **undelivered** (pre-submission rejects already auto-refund via reserve/refund).
Whether that window exists depends on **how the provider bills you** — so encode it:

- Each **provider instance declares a billable-status set + a platform-fault exemption list**
  (refined 2026-06-02; the earlier binary `submission|delivered` was too clean — see `PI-1-BACKLOG.md`).
- **Bill the customer on the same basis the provider bills you** → pass-through, zero margin risk.
- **Always auto-refund failures the platform caused** (internal error, suspension, fraud/pumping
  block, geo-block) — and anything that fails before submission. Carrier-side failures the provider
  bills us for are mirrored transparently, not absorbed.
- **Always** show reconciled DLR + **cost-per-delivered**; never fake "delivered".
- **Premium tier (where economics close):** on submission-billed routes, optionally offer
  *guaranteed-delivered billing* — price ≥ `cost ÷ delivery_rate`, gated to trustworthy-DLR
  routes (quality scoring identifies them), with invalid-number/abuse controls. Opt-in, priced
  for it — **not** a blanket promise.

**Wedge (honest + safe):** *"We bill the way the network bills us, never charge you for a
message that failed, and show you the real delivered cost — no phantom 'delivered' charges."*
This already beats competitors who bill on submission **and** fake delivery status.

### B4. Wallet concurrency: `version` column + `FOR UPDATE` is belt-and-suspenders
`ARCHITECTURE.md §5` uses **both** pessimistic `SELECT … FOR UPDATE` *and* an optimistic
`version` column. For a single hot row per wallet, `FOR UPDATE` alone is correct and simpler.
Keep `version` only if you'll do app-layer optimistic checks elsewhere; otherwise **drop it** to
reduce confusion. Minor.

### B5. Generic `ProductManifest` registry — keep the *concept*, defer the *machinery*
`CONTROL-PLANE-ADMIN.md §6` designs a product-agnostic registration system for products that
don't exist yet. The §14 phasing already says "console minimal in P1" — good — but §6 reads as
core. **Recommend: control plane hardcodes SMS at first; build the generic registry when product
#2 is greenlit.** Same logic as deferring the plugin framework.

---

## C. Gaps — under-specified, should add

### C1. Bulk fan-out, throughput & provider TPS (real gap for a *bulk SMS* product)
We have BullMQ for sending but never address: provider **TPS/throughput caps**, **backpressure**,
fan-out of a **100k-recipient campaign** (batching, partial-failure, progress), or per-tenant
send-rate fairness. For a product literally sold as "bulk SMS," this is core, not optional.
**Add a "throughput & bulk fan-out" section.**

### C2. STOP / opt-out / consent — legally required, currently thin
Many regimes (Nigeria, Kenya, GDPR-like) **require** consent capture and honoring STOP/unsubscribe.
We list opt-out as a P2 dashboard feature, but the **engine doesn't model it**: an outbound send
should be **blocked** if the recipient opted out, and inbound "STOP" must auto-suppress. This is
compliance, not a nicety. **Elevate to P1 for the engine (suppression check on every send).**

### C3. Inbound / two-way SMS isn't modeled
`webhooks-ingress` handles DLR + payment callbacks, but **inbound messages** (replies, STOP
keywords, two-way) have no flow. Even if two-way is P2, STOP handling (C2) needs the inbound path.
**Add minimal inbound ingestion in P1** (at least for STOP).

### C4. "Stuck reservation" on ambiguous send — money-sensitive gap
We say: on timeout, "mark unknown, hold the reservation, reconcile via DLR." But **what if no DLR
ever arrives?** The customer's funds stay reserved indefinitely. **Need a sweeper policy**:
reservation TTL → auto-resolve (refund or commit) after N minutes with a defined default, audited.
Without it, customer money can be silently locked.

### C5. Testing strategy for the money + delivery paths
The ledger invariant CI check is great, but there's no broader strategy: **provider plugin contract
tests**, a **sandbox/fake provider** that simulates accepts + DLRs (for the `sk_test` mode we
promised), and idempotency/concurrency tests on the wallet. **Add a test-strategy note**; make a
`FakeProvider` part of the plugin contract.

### C6. Data residency / hosting region ✅ ELEVATED & ADDRESSED (2026-06-02)
Research confirmed this is **launch-gating**, not near-term: our fintech customers carry **CBN
local-storage** obligations that flow to us, plus NDPA sovereignty direction. Now designed in
`COMPLIANCE-AND-DATA-PROTECTION.md §8`: `data_region` on tenants + `integration_instances`,
in-region default hosting, per-tenant residency via the dedicated-deployment escape hatch.
**Remaining open:** pick the actual launch hosting region/provider (counsel-confirmed).

### C7. Concrete observability stack undecided
`ARCHITECTURE.md §10` names OpenTelemetry/metrics/logs but no actual tooling (Grafana stack?
Sentry? Datadog?). Fine for design phase, but it's a near-term pick that affects the control
plane's monitoring build.

---

## D. Defer / remove — reduce launch surface

| # | Item | Action | Why |
|---|---|---|---|
| D1 | Generic selection/failover/circuit-breaker engine | **Defer to P2** (keep plugin *contract*) | No 2nd SMS provider at launch |
| D2 | Payment **plugin framework** + initiation-only failover | **Defer**; integrate **one** payment provider directly behind a thin interface | No 2nd payment provider at launch |
| D3 | `fx_rates` table | **Don't create** until FX is built; document intent only | Unused table = noise |
| D4 | Generic `ProductManifest` registry machinery | **Defer to product #2** (keep concept) | One product today |
| D5 | Premium SMS / shortcodes, multi-channel OTP, white-label | Already P3 — **keep deferred** | Correct as-is |
| D6 | `version` column on wallets | **Consider removing** (B4) | Redundant with `FOR UPDATE` |

**Net effect:** the launch build shrinks from "the platform" to a **provable vertical slice**,
while every deferred piece keeps its seam so it's additive later — exactly Principle #1.

---

## E. What's solid (don't touch)
- Double-entry ledger + reserve/commit/refund + minor-unit bigint + CI invariant. **Keep.**
- Shared-DB row-level tenancy + RLS backstop. **Keep.**
- WorkOS SSO centralized day one + separate staff identity. **Keep.**
- Control plane ≠ data plane (never in hot path) + immutable audit. **Keep** (just trim the
  generic registry, D4).
- The plugin **contract** (anti-lock-in). **Keep** (defer only the failover *engine*, D1/D2).
- The competitive wedge (reliability + transparency). **Keep** (but fix the *billing* nuance, B3).

---

## Suggested action order
1. **Fix A1–A4** (consistency) — mechanical, do now; the docs should not contradict each other.
2. **Decide B1 (OTP phase), B2 (multi-currency scope), B3 (delivered billing vs reporting)** —
   these change the MVP definition.
3. **Add C2/C4 to P1** (opt-out suppression + reservation sweeper) — compliance + money safety
   are not deferrable.
4. **Apply D1–D4 deferrals** → write the walking-skeleton scope.
5. Then proceed to migrations/scaffold against the trimmed scope.
