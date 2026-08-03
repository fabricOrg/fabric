-- Close the grant hole on `price_books` and `price_book_rates` — the tables that decide what a
-- customer is charged.
--
-- Third instalment of the class 0128 and 0129 addressed. A table here is protected by exactly one of
-- an RLS policy or an explicit REVOKE, because `ALTER DEFAULT PRIVILEGES` (0001) grants `app_runtime`
-- full DML on everything the migrator creates. These two had neither, verified live:
-- `app_runtime` held SELECT, INSERT, UPDATE, DELETE on both, with no policy on either.
--
-- WHY THESE TWO RANK ABOVE THE REST OF THE REMAINING SET. `price_book_rates.unit_price_minor` IS the
-- charge. It is read on the send path — `sms.service.ts` → `resolveLiveSmsPricing` →
-- `EffectivePricingService`, and the same service for email — so a writable rate table is not a
-- disclosure problem, it is a **pricing integrity** problem: the tenant-facing role could set its own
-- unit price to zero and send indefinitely for nothing, or alter another workspace's rates. Nothing in
-- the ledger would look unbalanced, because every movement would be internally consistent at the
-- fabricated price. That is the same shape as the Phase 2 offer defect: money that is wrong rather
-- than money that fails to add up.
--
-- 0107 already revoked `price_book_versions`, `pricing_sell_rules` and `provider_cost_rates` — the
-- neighbouring tables in this domain. These two were simply missed, which is why the asymmetry was the
-- tell when sweeping.
--
-- SAFE TO REVOKE — traced through the send path rather than grepped, because a mistake here breaks
-- live sending rather than merely a staff screen:
--   * every file referencing either table uses the PROVISIONING connection and none holds an `AppDb`:
--     `effective-pricing.service.ts`, `pricing.service.ts`, `price-book-admin.service.ts`,
--     `price-book-writes.ts`, `commercial-offer-{reads,writes}.ts`, `commercial-offer-purchase.ts`,
--     `token-catalog.service.ts`.
--   * `@app/sms-engine` and `services/api/src/sms` never touch the tables at all — SMS resolves a
--     price through `EffectivePricingService`, which reads on the provisioning connection behind a
--     short-TTL cache that serves last-known-good (the deliberate fail-open posture for price
--     RESOLUTION, as distinct from an entitlement check, which fails closed).
--
-- `app_provisioner` is granted explicitly for the same belt-and-braces reason as 0129: its real reach
-- comes from `prepareRoles()` in the cloud and from being a superuser locally, but stating it at the
-- table records the intent instead of depending on a deploy-time side effect. DELETE is included
-- because `price-book-writes.ts` deletes rate rows when a book is edited.
--
-- The REVOKE survives a redeploy — `prepareRoles()` re-grants to `app_provisioner` only, never to
-- `app_runtime` — and both tables join the `db:assert security` loop so drift is caught rather than
-- assumed away.
REVOKE ALL PRIVILEGES ON "price_books" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "price_books" TO app_provisioner;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON "price_book_rates" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "price_book_rates" TO app_provisioner;
