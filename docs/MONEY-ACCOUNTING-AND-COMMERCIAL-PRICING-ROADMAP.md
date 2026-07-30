# Money accounting and commercial pricing roadmap

Status: **product-approved for phased implementation — finance, security, and live-launch gates remain**

Owner: Product and Engineering
Last updated: 2026-07-30

## Purpose

This document defines the development path from Fabric's current wallet and token accounting to a
reconcilable production money system. It also scopes a channel-agnostic commercial-pricing
capability that can sell fixed-price bundles, account-specific offers, and later volume incentives
without weakening each channel's natural-unit accounting.

This roadmap extends ADR-0010 through the accepted
[ADR 0012](./decisions/0012-channel-agnostic-commercial-offers.md). Finance and Security approval
remain explicit exit gates before live commercial use.

## Executive decision

Keep three concepts separate:

1. **Usage measurement** records the natural billable unit. SMS is measured in segments and email
   in messages.
2. **Entitlement** records how many compatible units a customer may consume. Sandbox allowance and
   purchased token lots are entitlements, not money.
3. **Commercial consideration** records what the customer agreed to pay. A pay-as-you-go rate may
   be per unit; a prepaid offer may instead be a fixed total for a fixed quantity.

The current admin form combines these concepts into one integer unit rate. That is sufficient for
pay-as-you-go but not for an offer such as "200 SMS segments for GHS 3.00". GHS 3.00 is 300 pesewas,
and `300 / 200` is 1.5 pesewas per segment. Fabric must not round that to 1 or 2, use a floating
point value, or charge an amount different from the published offer.

The recommended first commercial extension is therefore:

- preserve the existing unit-rate model for pay-as-you-go;
- add immutable, fixed-price prepaid bundle offers for every registered channel;
- allow a public/default catalog and workspace-specific catalog assignment;
- defer generic discounts, coupons, recurring plans, and arbitrary pricing formulae until the
  fixed-bundle model is proven.

## What exists today

The following is based on the running code as of `b4e79d8`, not on intended future behavior.

### Wallet and live pay-as-you-go

- Money is stored as branded `bigint` minor units.
- Wallet movements are append-only, double-entry, idempotent, and use reserve, commit, or refund
  around delivery.
- A live send resolves a per-unit sell rule, provider-cost rule, margin floor, and immutable pricing
  snapshot.
- The wallet fails closed when funds cannot be reserved.
- Paystack top-ups are credited after a verified, reconciled provider result.

### Sandbox

- Sandbox delivery consumes a per-workspace, per-channel, UTC-day allowance.
- SMS allowance is measured in segments; email allowance is measured in messages.
- Sandbox does not reserve or debit the live wallet.
- Allowances are control-plane configuration, not cash or accounting entries.

### Purchased tokens

- A token price book contains one positive integer `unit_price_minor` for each channel and currency.
- A purchase accepts a quantity, resolves the price server-side, and stores:
  `amount_minor = quantity × unit_price_minor_locked`.
- The database enforces that multiplication exactly.
- Cleared purchases create count-based token lots and post cash to token deferred revenue.
- Sends hold compatible token lots before wallet money, then commit or return those holds.
- Token consumption recognizes `held quantity × locked unit price` as revenue.
- SMS token usage is per segment. Email token purchase is currently unavailable.

### Current limitation

The existing model and admin form can represent:

- "each SMS segment costs 5 pesewas"; and
- "buy any integer number of segments at that rate."

They cannot faithfully represent:

- "100 SMS segments for GHS 3.00";
- "200 SMS segments for GHS 3.00" when the implied unit price is fractional;
- a named starter, growth, or enterprise pack;
- a published price that differs by pack size;
- a negotiated workspace catalog;
- a time-bound offer;
- paid units plus explicitly promotional units; or
- graduated usage tiers.

This is a cross-cutting money change. Adding more rate rows to the form would leave purchase,
database, token-lot, settlement, recognition, reporting, and reconciliation assumptions wrong.

## Target money model

### Accounting boundary

Fabric needs two related ledgers with distinct jobs:

- The existing tenant wallet subledger records customer balances, reservations, receipts,
  deferred token revenue, and channel revenue.
- A corporate general ledger records company cash, payment-processor clearing, accounts
  receivable/payable, provider expense/accruals, tax, revenue, deferred revenue, fees, FX
  differences when introduced, and retained earnings.

The tenant ledger remains the operational source for "may this send proceed?" The corporate ledger
becomes the financial source for "what does Fabric own, owe, earn, and spend?" Integration between
them must be idempotent and reconcilable; neither should be reconstructed from mutable current
state.

### Posting events

Every financial event has a stable external or domain reference, currency, exact minor-unit amount,
event time, accounting time, and balanced posting:

| Event | Operational result | Required accounting result |
| --- | --- | --- |
| Wallet top-up clears | Customer wallet increases | Cash/processor clearing and customer liability increase |
| Wallet send reserved | Funds become unavailable | Liability is reclassified to a reservation state |
| Wallet send delivered | Reservation is consumed | Customer liability decreases; channel revenue increases |
| Wallet send fails | Reservation returns | Reservation is reversed to available customer liability |
| Bundle purchase clears | Token entitlement is granted | Clearing/cash increases; bundle deferred revenue increases |
| Bundle unit is delivered | Token is consumed | Exact allocated deferred revenue becomes channel revenue |
| Provider accepts/delivers usage | Cost obligation is created | Provider expense and payable/accrual increase |
| PSP/provider statement arrives | Expected and external records are compared | Exceptions are recorded; no silent balance rewriting |
| Settlement reaches the bank | Processor clearing is settled | Bank cash and clearing are reconciled |

No event may mutate or delete previously posted history to "make the numbers match." Corrections are
new reversing or adjusting entries.

### Currency

- All stored and transported amounts remain integer minor units.
- Every ledger transaction balances within one currency.
- A workspace has one billing currency for a purchase or send.
- No implicit FX conversion is allowed.
- If FX is introduced later, it requires an explicit quoted rate, source, timestamp, settlement
  currency, rounding policy, and gain/loss posting.

### Revenue recognition

Customer cash received is not automatically revenue:

- wallet funding is a customer liability until usage is delivered or another approved recognition
  event occurs;
- a prepaid bundle is deferred revenue until its promised units are delivered;
- recognition follows the immutable offer allocation, not the current catalog;
- breakage, expiry, refunds, and tax require explicit approved policies.

## Commercial pricing model

### 1. Pay-as-you-go rate

Keep the existing effective-pricing model for wallet sends. It prices the natural unit for the
specific route and protects the provider-cost margin floor.

This model should not be overloaded to represent a bundle.

### 2. Fixed-price prepaid bundle — first implementation

A bundle is a versioned offer with:

- stable offer code and display name;
- price-book/catalog membership;
- registry-backed channel and natural unit;
- currency;
- paid units;
- promotional units, initially zero;
- total deliverable units;
- fixed total price in minor units;
- compatible destination countries, traffic classes, and service class where relevant;
- minimum and maximum pack count per purchase;
- effective start and optional end;
- lifecycle: draft, published, retired;
- estimated provider cost and resulting margin at publish time; and
- customer-facing terms such as whether units expire or are refundable.

Examples:

| Offer | Deliverable quantity | Total price | Accounting behavior |
| --- | ---: | ---: | --- |
| Starter SMS | 100 segments | GHS 3.00 | Allocate 300 pesewas across 100 delivered segments |
| Growth SMS | 200 segments | GHS 3.00 | Allocate 300 pesewas exactly across 200 delivered segments |
| Nigeria SMS | 100 segments | NGN 500.00 | Only usable for the offer's compatible Nigeria route |
| Transactional email | 10,000 recipients | USD 12.00 | Allocate 1,200 cents across delivered recipients |
| Future voice | 3,600 seconds | GHS 25.00 | Uses the same allocation after voice is registered and live-ready |

The offer model is not an SMS subsystem. SMS, email, voice, WhatsApp, push, and later channels use
the same quantity-and-consideration structure while defining their own natural unit, eligibility,
provider-cost evidence, and runtime readiness.

The customer buys one or more complete packs. The API accepts `offer_version_id` and `pack_count`;
it never accepts a client-supplied price or arbitrary amount. The server snapshots the exact
published version, calculates the total quantity and total consideration, and sends that amount to
the payment provider.

### 3. Catalog and negotiated pricing

Use price books as catalogs:

- a default public catalog is available to eligible workspaces;
- a workspace can be assigned a negotiated catalog;
- an offer belongs to a catalog and cannot leak across assignments;
- a purchase records the catalog and immutable offer version used;
- changing an assignment affects only future purchases.

This supports enterprise or partner prices without a one-off amount field or mutable customer
override at checkout.

### 4. Later commercial capabilities

These are valid extensions but are not part of the first bundle release:

- graduated or all-units volume tiers;
- coupon and campaign eligibility;
- recurring subscriptions and included monthly units;
- minimum-spend or committed-use contracts;
- bonus units on top-up;
- expiry-based lower prices;
- invoice terms and postpaid credit;
- multi-currency or FX offers.

A generic expression language or operator-authored formula is explicitly out of scope. It is hard
to validate, explain, audit, test, and reconcile.

## Exact allocation for indivisible bundle prices

Do not store a rounded bundle unit price as the financial truth. Store:

- `quantity_total`;
- `total_price_minor_locked`; and
- cumulative `quantity_consumed` and `revenue_recognized_minor`, or equivalent immutable
  consumption allocations.

For `n` cumulatively consumed units from a lot:

```text
recognized_through(n) = floor(total_price_minor_locked × n / quantity_total)

recognition_for_this_consumption =
  recognized_through(consumed_after) - recognized_through(consumed_before)
```

For 200 segments bought for 300 pesewas:

- some segment deliveries recognize 1 pesewa;
- some recognize 2 pesewas;
- after all 200 deliveries, recognized revenue is exactly 300 pesewas;
- no float, lossy rounding, or unallocated remainder exists.

The calculation must use integer arithmetic and serialize consumption per lot. A database
constraint or transaction guard must prevent recognized revenue from exceeding the lot's locked
total. The final unit consumes any remaining allocable amount by construction.

If one send spans multiple lots, recognition is calculated independently for each lot allocation.
Returned holds recognize nothing.

### Promotional units

Do not model a discount as a negative price. When promotional units are introduced, store
`paid_quantity`, `bonus_quantity`, `quantity_total`, and `total_price_minor_locked` explicitly.

Before shipping bonus units, Finance must choose and document whether consideration is allocated
across all promised units or whether the bonus is accounted for separately as promotional expense.
The first bundle release keeps `bonus_quantity = 0`.

## Proposed data boundaries

Names are indicative; the migration design is part of implementation review.

### Commercial catalog

`pricing_offers`

- stable identity: id, catalog/price-book id, code, name, description, channel;
- tenant-neutral control-plane data;
- cannot be purchased directly without a published version.

`pricing_offer_versions`

- immutable after publication;
- offer id, version number, status;
- currency, paid quantity, bonus quantity, total quantity, total price minor;
- compatibility dimensions;
- purchase pack limits;
- effective dates;
- cost and margin evidence captured at approval;
- creator, approver, and audit references.

Published versions are never edited. A change clones a draft version, validates it, then publishes
it while the previous version remains historical.

### Purchase and entitlement

Extend `token_purchases` to reference and snapshot the offer version:

- `offer_version_id`;
- `pack_count`;
- `quantity_total`;
- `total_price_minor_locked`;
- offer code/name and eligibility snapshot where required for durable evidence.

Replace the constraint `amount = quantity × unit price` with constraints that bind the purchase to
the offer snapshot and exact pack multiplication:

```text
purchase_quantity = offer_quantity × pack_count
purchase_amount_minor = offer_total_price_minor × pack_count
```

Extend `token_lots` with:

- `offer_version_id`;
- `total_price_minor_locked`;
- `quantity_consumed`;
- `revenue_recognized_minor`;
- immutable compatibility snapshot.

The existing `unit_price_minor_locked` cannot remain the source of truth for bundle lots. It may be
retained temporarily for legacy lots during a migration, with an explicit lot pricing model and
dual-path recognition until all old lots are exhausted.

### Usage and recognition

Token holds must return enough lot state to calculate deterministic cumulative recognition.
Settlement must post the exact per-lot allocated amount, not `quantity × unit price`.

An append-only recognition-allocation record should link:

- token lot;
- hold/delivery;
- quantity consumed;
- recognition amount;
- ledger transaction;
- idempotency key.

This is the reconciliation bridge between entitlement and money.

## API and user-interface scope

### Contracts and API

Add strict Zod contracts for:

- offer draft/create;
- offer version response;
- validate/preview;
- publish and retire;
- catalog listing;
- customer-eligible offer listing;
- purchase initiation by offer version and pack count.

Server-side validation must enforce:

- supported currency and natural unit;
- positive quantity, pack count, and price;
- no overlapping active version for the same offer/currency/eligibility;
- exact amount calculation;
- catalog assignment and offer eligibility;
- publish-time cost and margin floor;
- effective dates;
- published-version immutability;
- maker-checker approval once enabled.

### Admin console

Keep pay-as-you-go rates and prepaid offers on separate sections.

Replace raw minor-unit authoring for bundle offers with:

- currency amount input in normal display units, such as `GHS 3.00`;
- included SMS segments or email messages;
- an effective-unit-price preview clearly marked as informational;
- estimated provider cost and margin preview;
- destination and traffic eligibility;
- active period;
- purchase limits;
- draft, publish, clone, and retire actions;
- an audit/history view.

The backend still receives and stores exact minor-unit strings. A shared money parser/formatter must
convert the display amount without JavaScript floating-point arithmetic.

The UI must call units what they are. For SMS, show "segments" or "SMS credits (1 credit per
segment)", not an unconditional promise of "messages"; a long message can consume multiple
segments.

### Customer surfaces

The dashboard should show:

- eligible package cards;
- exact included units and total price;
- effective comparison rate and savings against the relevant pay-as-you-go offer;
- route restrictions and segment explanation;
- pack count and exact checkout total;
- remaining units by compatibility/currency;
- wallet only in live mode and allowance tokens only in sandbox, preserving the existing
  environment separation.

## Permissions and approval controls

Pricing authority is separate from product access:

- staff `operator`: read catalogs, costs, margins, and history;
- staff `admin`: create drafts and submit/publish according to the approved control matrix;
- customer `owner | admin`: purchase bundles;
- customer `member | developer`: read balances/offers only unless product explicitly grants more.

Before live commercial pricing, add maker-checker approval so the same staff actor cannot both
draft and publish a price-affecting change. Every create, edit, publish, retire, assignment, and
override action must be audited with old/new state and actor.

There is no "charge any amount" permission. Every checkout amount comes from an effective,
published, eligible version.

## Provider cost and margin safety

SMS cost varies by destination, route, traffic class, and provider. A generic "100 SMS" bundle is
unsafe if it can be consumed on routes whose cost exceeds the bundle assumptions.

Before publication:

1. resolve the cost basis for every compatible route;
2. calculate expected and worst-case total provider cost;
3. apply payment fees, tax posture, and a conservative cost buffer;
4. enforce the catalog's minimum margin;
5. block publication when any permitted route breaches the floor.

At consumption:

- enforce the offer's compatibility dimensions;
- snapshot actual/effective provider cost with the usage;
- create the provider expense/accrual event;
- alert on margin drift without retrospectively changing the customer's locked offer.

If a bundle is deliberately sold below cost, it requires an explicit promotional approval and
budget classification, not a weakened global margin floor.

## Development path

### Phase 0 — ratify policy and postings

Required before changing token money semantics:

- approve this proposal through an ADR amendment;
- approve chart of accounts and posting matrix;
- decide tax-inclusive versus tax-exclusive customer prices;
- confirm non-refundable/no-expiry policy for the first bundle release;
- approve cumulative integer allocation;
- define provider-cost evidence and margin approval;
- define staff maker-checker roles;
- define accounting period, close ownership, and correction policy.

Exit gate: Product, Finance, Security, and Engineering sign off the invariants and examples.

### Phase 1 — establish the corporate accounting boundary

Ratified as [ADR 0013](./decisions/0013-corporate-accounting-boundary.md) and delivered in three
slices, because the boundary, the wiring, and the reconciliation each carry different risk.

- define corporate ledger accounts and dimensions;
- add idempotent posting contracts from wallet/token domain events;
- preserve transactional-outbox delivery;
- implement reversal/adjustment entries;
- produce tenant-subledger-to-corporate-control-account reconciliation.

| Slice | Scope | Status |
| --- | --- | --- |
| 1a | GL schema, write-time enforcement, privilege boundary, seeded chart of accounts, pure posting rules, invariant module | **done** — nothing posts to it yet, so the slice carries no runtime risk |
| 1b | The posting airlock (`INSERT`-only from the tenant transaction), its drain worker and production caller, wired to the wallet and token primitives | not started |
| 1c | Subledger-to-control-account reconciliation, reversal/adjustment service, the standing invariant in the gate | not started |

Exit gate: every supported wallet event produces balanced, replay-safe postings and reconciles.
Reached at the end of 1c, not 1a.

### Phase 2 — fixed bundle offer foundation

- add offer and immutable version schema;
- add validation/publish service and strict contracts;
- add admin draft, preview, publish, clone, retire, and history UI;
- add catalog/workspace eligibility;
- protect publication with cost/margin validation and audit.

Exit gate: staff can publish a valid offer, but no customer can yet buy it.

### Phase 3 — purchase and exact entitlement accounting

- purchase by offer version and pack count;
- persist the immutable purchase snapshot before payment;
- reconcile Paystack amount/currency/reference to that snapshot;
- grant a compatible token lot exactly once;
- post exact purchase consideration to deferred revenue;
- implement cumulative integer recognition and allocation records;
- migrate or support legacy unit-priced lots safely.

Exit gate: real-Postgres tests prove no replay can double-grant, no rounding remainder exists, and
full lot consumption recognizes exactly the purchase total.

### Phase 4 — usage eligibility and customer experience

- enforce offer compatibility in token selection;
- retain tokens-first, wallet-second, fail-closed behavior;
- add customer catalog, checkout, receipt, and balance views;
- explain SMS segmentation before purchase and send;
- cover error, loading, empty, ineligible, retired, and price-changed states.

Exit gate: an eligible test workspace can buy, consume, return, exhaust, and reconcile a bundle
end to end.

### Phase 5 — provider cost and accounts payable

- capture provider-rated usage and cost;
- ingest provider invoices/statements;
- accrue expense/payable where invoice timing lags usage;
- match provider line items to Fabric usage;
- route mismatches to an exception queue.

Exit gate: channel gross margin is reproducible from customer revenue and provider cost.

### Phase 6 — payment and bank reconciliation

- ingest Paystack transaction and settlement reports;
- reconcile intent, webhook, charge, fee, refund, settlement, and bank deposit;
- track processor clearing balances and aged exceptions;
- prevent manual status edits from bypassing accounting events.

Exit gate: every cleared purchase is settled, outstanding, refunded, or an owned exception.

### Phase 7 — operational reconciliation and reporting

- continuous ledger-balance invariant;
- wallet liability versus customer balance reconciliation;
- token deferred revenue versus unrecognized lot value reconciliation;
- entitlement counter versus lots/holds reconciliation;
- provider usage/cost and PSP settlement dashboards;
- revenue, deferred revenue, gross margin, breakage, fees, and tax reports by tenant/channel/currency.

Exit gate: Finance can explain every control-account balance from detailed records.

### Phase 8 — close, controls, and controlled launch

- accounting periods and close locks;
- approval workflow and segregation of duties;
- audit evidence export;
- backup/restore and disaster-recovery rehearsal;
- shadow accounting against test transactions;
- controlled testing launch with synthetic and low-value scenarios;
- explicit human gate before live SMS, email, payment, staging, or production changes.

Exit gate: signed release-readiness record with zero unresolved money invariant or reconciliation
defect.

## Initial implementation backlog

### Money-accounting foundation

- `FIN-001` Ratify accounting policies, terms, and posting matrix. — **engineering half done** in
  ADR-0013 (the posting matrix is now executable, pinned by a unit test). The policy half stays open:
  tax presentation, breakage, period length, and the named Finance approver.
- `FIN-002` Define the corporate chart of accounts and dimensions. — **done** (migration 0112 seeds
  the six accounts Phase 1 posts to; later phases add their own).
- `FIN-003` Implement idempotent corporate posting and reversal contracts. — **contracts and pure
  derivation done**; the airlock and drain worker that call them are slice 1b.
- `FIN-004` Reconcile tenant wallet liabilities to corporate control accounts. — slice 1c. The
  control-account mapping it compares is in place and pinned to the database.
- `FIN-005` Capture billable usage and customer charge snapshots.
- `FIN-006` Capture provider-rated cost and payable accruals.
- `FIN-007` Ingest and reconcile provider invoices/statements.
- `FIN-008` Ingest and reconcile Paystack transactions, fees, and settlements.
- `FIN-009` Reconcile processor clearing to bank deposits.
- `FIN-010` Build owned exception queues with aging and resolution evidence.
- `FIN-011` Build revenue, liability, cost, and gross-margin reports.
- `FIN-012` Add accounting periods, close locks, and adjusting entries.
- `FIN-013` Add maker-checker controls and audit exports.
- `FIN-014` Prove backup, restore, and financial-data recovery.
- `FIN-015` Run shadow accounting and controlled launch certification.

### Fixed bundle capability

- `COM-001` Amend ADR-0010 with fixed-total bundle semantics.
- `COM-002` Add offer/version contracts, schema, constraints, and migration strategy.
- `COM-003` Implement offer validation, version lifecycle, audit, and margin preview.
- `COM-004` Build the admin offer-authoring and history experience.
- `COM-005` Initiate purchase from a published offer snapshot.
- `COM-006` Reconcile payment and grant an offer-backed lot exactly once.
- `COM-007` Implement cumulative integer revenue allocation.
- `COM-008` Enforce destination/traffic/service compatibility during token holds.
- `COM-009` Build eligible customer catalog, checkout, receipt, and balance surfaces.
- `COM-010` Reconcile bundle deferred revenue, consumption, and remaining entitlement.
- `COM-011` Add workspace-specific catalog assignment.
- `COM-012` Add volume tiers or promotional units only after a separate approved scope.

## Required tests and evidence

At minimum:

- property tests over many totals, quantities, and consumption partitions proving allocated
  recognition is monotonic, never negative, never exceeds the total, and ends exactly at the total;
- real-Postgres integration tests for constraints, concurrent holds, RLS, idempotency, webhook
  replay, payment mismatch, publish races, and ledger balance;
- end-to-end tests for admin publish, customer purchase, successful delivery, multi-segment
  consumption, failure return, partial lot use, multi-lot use, and retired offers;
- reconciliation tests that intentionally inject missing, duplicate, delayed, and conflicting
  provider records;
- migration tests for existing unit-priced token lots;
- permission tests at every staff and customer role boundary;
- accessibility and currency-formatting tests for admin and customer forms.

## Non-goals for the first bundle release

- arbitrary discount expressions;
- client-supplied prices;
- postpaid credit or invoicing;
- FX conversion;
- coupons;
- recurring subscriptions;
- token expiry;
- partial refunds;
- bonus units;
- cross-currency token consumption;
- live provider enablement or deployment.

## Ratified direction and remaining gates

Product ratified the following on 2026-07-30:

- fixed-price, fixed-quantity bundles are the first pricing extension;
- offers apply to all registered channels, not only SMS;
- cumulative integer allocation governs indivisible prices;
- the initial release has no bonus units, expiry, partial refunds, or generic discounts;
- eligibility constrains any channel where provider cost differs by route or service;
- customer `owner | admin` may purchase while other customer roles remain read-only; and
- implementation may proceed behind a disabled feature flag while accounting and reconciliation
  foundations progress.

Before live commercial use, name the Finance approver and ratify posting policy, tax presentation,
provider-cost evidence, close controls, and the Phase 5–8 launch record. No offer is available for
live purchase until those gates pass.
